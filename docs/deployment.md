# 服务器部署

2026-11-17 已同步到 https://openwook.cloud，当前聊天体验版本与验收见[线上发布记录](chat-release-acceptance.md)。服务器为 `ubuntu@122.51.255.108`，Ubuntu 26.04、Node.js 22.22.1、PostgreSQL 18.6、Caddy 2.11.9。SSH 主机指纹已由用户通过控制台核对；登录密码没有进入源码、配置或操作文档。

## 服务与文件

- `/opt/reso/releases/20261117T145042Z-chat-response`：当前代码与 Web 构建；`/opt/reso/current` 指向该版本。原 `20261115T155803Z-ui-fixes`、首次发布 `20261117T143745Z-chat-response` 及更早版本仍保留。
- `/opt/reso/downloads/Reso-server-debug.apk`：Android ARM64 服务器调试包，公开路径为 `/downloads/Reso-server-debug.apk`。
- `/etc/reso/runtime.env`：受限数据库连接、会话密钥、公开地址和模型／语音配置。
- `/etc/reso/migration.env`：额外包含迁移连接，只在迁移时由管理员读取。
- `/etc/systemd/system/reso@.service`：`reso@api` 和 `reso@worker` 均已开启自动重启和开机自启，运行用户为 `reso`。
- `/etc/caddy/Caddyfile`：HTTPS、网页、API 与 APK 下载。Caddy 自动获取和续期证书；SSE 按 `text/event-stream` 即时转发。
- `/var/backups/reso/reso-after-deploy-20261115.dump`：部署后数据库备份。目录为 root 0700，备份及两份凭据文件为 root 0600。

数据库 `reso` 使用新凭据；`reso_runtime` 已通过应用的受限权限检查。运行服务不读取迁移连接，代码目录不保留 `.env`。本机数据没有上传，服务器需要新建账号；原有模型／语音配置只通过 SSH 传入私有配置，未放入 APK 或 Web 构建。

公网只开放 SSH 22、HTTP 80、HTTPS 443（TCP/UDP）。PostgreSQL 5432、API 8787、Caddy 管理接口 2019 只监听回环地址；UFW 已启用。API 仅信任 `127.0.0.1` 代理的客户端地址，实际客户端限流仍然有效。当前只信任 `https://openwook.cloud` 业务来源。

## 检查与重启

```sh
sudo systemctl status reso@api reso@worker caddy postgresql
sudo journalctl -u reso@api -u reso@worker --since '10 minutes ago'
curl --fail https://openwook.cloud/api/status
sudo systemctl restart reso@api reso@worker
```

健康接口检查数据库和通知连接，配置标志不等于供应商已连通。Worker 需同时检查服务状态与真实任务结果。修改 `/etc/reso/runtime.env` 后重启两个服务；不要复制本机 `.env` 覆盖服务器配置。

## 更新代码

先在本机构建并验证，打包时明确列出源码目录，避免上传 `.env`、`.data` 或本机依赖：

```sh
npm test
npm run test:integration
npm run build
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/reso-release.tar.gz \
  package.json package-lock.json tsconfig.json vite.config.ts index.html \
  server shared src public scripts e2e deploy dist README.md PRODUCT.md DESIGN.md docs
scp /tmp/reso-release.tar.gz ubuntu@122.51.255.108:/home/ubuntu/reso-release.tar.gz
```

在服务器执行以下更新流程。新的代码先安装依赖，再备份和停止旧服务；迁移时临时链接管理员配置，结束后清理。凭据不随版本替换。

```sh
set -euo pipefail
release_dir=/opt/reso/releases/$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -o reso -g reso -m 755 "$release_dir"
sudo tar -xzf /home/ubuntu/reso-release.tar.gz -C "$release_dir" --no-same-owner
sudo chown -R reso:reso "$release_dir"
cd "$release_dir"
sudo -u reso npm ci --include=dev --no-audit --no-fund --cache /var/cache/reso/npm
sudo chown -R root:root "$release_dir"
sudo caddy validate --config deploy/Caddyfile --adapter caddyfile
sudo bash -c 'umask 077; sudo -u postgres pg_dump --format=custom reso > /var/backups/reso/reso-before-update-$(date -u +%Y%m%dT%H%M%SZ).dump'
sudo systemctl stop reso@api reso@worker
trap 'sudo rm -f "$release_dir/.env"; sudo systemctl start reso@api reso@worker' EXIT
sudo ln -s /etc/reso/migration.env .env
sudo /usr/bin/node --env-file=.env --import tsx scripts/migrate.ts
sudo rm .env
sudo ln -sfn "$release_dir" /opt/reso/current
sudo install -m 644 deploy/reso@.service /etc/systemd/system/reso@.service
sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl start reso@api reso@worker
sudo systemctl reload caddy
curl --fail --retry 10 --retry-connrefused --retry-delay 1 https://openwook.cloud/api/status
rm /home/ubuntu/reso-release.tar.gz
```

有数据库迁移时，旧程序能否回滚取决于迁移兼容性；保留旧版本和对应备份，不能只切换符号链接就假定数据库已回退。当前未配置异地或定时数据库备份，已有备份只在本服务器。

更新 Web 会同步影响已安装的服务器 APK。修改原生桥或服务器入口时，在本机执行 `npm run android:build:server`，将新 APK 安装到 AVD 并验收，再更新 `/opt/reso/downloads/Reso-server-debug.apk`。运行本机 E2E 时先切回本机调试包，见 [Android 说明](android.md)。

## 本次验证

- 本机 41 项单元测试、类型检查、Web 构建及 Android 服务器 APK 构建通过。
- Ubuntu／PostgreSQL 18 上 23 项隔离集成测试通过，测试未读取真实模型／语音凭据，临时数据库和角色已清理。
- 公网 HTTPS、HTTP 自动跳转、安全会话 Cookie、未登录拒绝、昵称保存、SSE 首帧、真实 DeepSeek→队列→Worker→保存回复及四类记录汇总通过。
- AVD 在没有 ADB 转发的情况下验证 HTTPS 登录、“我的”、记录列表、原生文件导出和退出；已读取实际 JSON 核对。原生桥仅开放确切服务来源。
- 仅删除本次创建的临时验收账号、事件与对应队列任务；重启两个业务服务后再次检查健康。

语音后续复测已通过：替换有效 API Key 后，真实普通话转写返回 200，AVD 录制→公网转写→保留原草稿回填及不自动发送通过。授权失败提示已修复并同步当前版本，详见 [供应商联调](provider-check.md)。42 项单元测试及 Ubuntu 上 24 项隔离集成测试通过，现有服务器 APK 无需重新安装。

同日再次在服务器 APK 上完成 18 项隔离 Android 回归及 9 组直连线上流程，覆盖注册、真实回复、问卷练习、资料、分享、咨询状态、真实语音、原生导出、撤权删除与退出。没有新增业务代码故障，测试工具的空值输入修复及服务器包回归入口已同步；临时账号、测试咨询资料和对应任务已清理，原设备存储已恢复。详见 [完整复验](e2e-acceptance.md)。

实体机及正式发布签名尚未验收。APK 仍为调试包；现有未成年人政策、量表与专业服务边界没有因部署而改变。

## UI 流程修复同步发布（2026-11-15）

前端、API 和 Worker 已一起切换到 `20261115T040956Z-ui-fixes`。本次使用用户此前授权的 SSH 账号密码认证；没有要求配置密钥。密码未回显、未写入发布包，临时凭据文件已删除，临时 SSH 复用连接在收尾时关闭。

- 发布包 SHA-256：`b9e5c018e2b1ecb1750793d27418ea4c684e19465807cb560abc51c2f5ebbec4`；源码与构建清单在服务器安装后校验通过。
- 安装新版本依赖后，在服务器运行 24 项隔离集成测试，全部通过；测试进程移除了真实供应商配置。迁移目录与上一版本一致，本次没有数据库迁移。
- 切换前备份为 `/var/backups/reso/reso-before-20261115T040956Z-ui-fixes.dump`。保留上一版本，发布脚本在切换后的健康或资源校验失败时自动切回。此次未触发回滚。
- 公网首页与本机发布构建的哈希一致；AVD 又逐字节校验线上入口引用的 JS/CSS，与本次构建相同。API、Worker、Caddy 和 PostgreSQL 均正常。
- 重新启动 Pixel9_API35，并安装已有服务器调试 APK。AVD 直连 `https://openwook.cloud`，不使用 ADB reverse 或本机测试 API。五组线上流程通过：登录与真实 DeepSeek 队列回复；草稿进入练习并保存故事后返回；邀请页直接编辑摘要且默认不勾选分享；接受前邀请人及已有成员说明；固定版本与再次确认后的分享更新。
- 匿名邀请预览仍只有基础字段，匿名详情请求被拒绝；受邀房间不能读取私人聊天、问卷和故事。
- 删除了本次验收及启动同步重试创建的临时账号、临时事件与对应队列任务；原 AVD Cookie、localStorage 和 sessionStorage 已恢复。

线上 AVD 证据：`.data/release-ui-fixes/online-android/results.json`、`restoration.json`、`cleanup.json` 和截图。设备仍运行服务器 App。此次没有重建原生包，未复测真实语音、实体机或 TalkBack。

## 导航与练习入口同步发布（2026-11-15）

四项信息架构调整已发布到 https://openwook.cloud，前端、API 和 Worker 统一使用 `20261115T103247Z-ui-fixes`；原服务器 Android 调试包继续使用，无需重建原生包。行为说明见 [导航调整验收](navigation-ia-acceptance.md)。

- 发布包 SHA-256：`599c9980ab433af3c6367c2a1baf4373b6a8110fcaa0ac0895f210921bdfcd5f`。安装后源码与构建清单校验通过，迁移目录与上一版本相同，没有数据库迁移或新增依赖。
- 本机 43 项单元测试、类型检查及生产构建通过；服务器 24 项隔离集成测试通过。
- 切换前备份：`/var/backups/reso/reso-before-20261115T103247Z-ui-fixes.dump`；上一版本保留。原子切换及自动回滚检查通过，本次未触发回滚。API、Worker、Caddy 和 PostgreSQL 正常，两个业务服务均无异常自动重启。
- AVD 在没有 ADB reverse 的情况下直连线上，校验入口 JS/CSS 与本机构建哈希一致。八组线上流程通过：HTTPS 登录与真实 DeepSeek 队列回复；三种新练习入口及保存、私人草稿保留；邀请页编辑摘要与默认不分享；邀请身份与已有成员说明；固定版本分享和明确更新；发起人房间回私人聊天及事件／人物导航；待回访完成后仍保留原记录；受邀房间创建独立私人事件并分别保留两边草稿。
- 原 AVD Cookie、localStorage 和 sessionStorage 已恢复。仅清理本次三个临时账号、两个临时事件及其队列任务，之后公网健康复查通过。临时认证文件和本地账号凭据已删除。

证据在 `.data/release-navigation/online-android/` 的 `results.json`、`restoration.json`、`cleanup.json` 及原生截图；发布日志与包清单在 `.data/release-navigation/`。本次未复测真实语音、实体机或 TalkBack。

## 账户入口与重复入口整理发布（2026-11-15）

前端、API 和 Worker 已统一切换至 `20261115T111557Z-ui-fixes`。维持 UI V2.1；非聊天页不再提供重复账户菜单，聊天页改为按钮旁的精简菜单，并合并两处重复工具／记录入口。详细范围及保留入口的理由见 [账户入口整理验收](account-entry-acceptance.md)。

- 发布包 SHA-256：`d118faaf1b670c496ff78966b60e5fd552051489a2822d660a96a7428828b29f`。清单及公网构建资源哈希匹配，没有新增依赖或数据库迁移。
- 43 项单元测试、生产构建、本地 Android 14 场景及资料专项通过；服务器 24 项集成测试通过；AVD 直连线上九组业务流程通过，包含菜单横竖屏定位。
- 切换前备份：`/var/backups/reso/reso-before-20261115T111557Z-ui-fixes.dump`，上一版本 `20261115T103247Z-ui-fixes` 保留；本次未触发回滚。API、Worker、Caddy 和 PostgreSQL 正常，两个业务服务无异常自动重启。
- 线上临时账号、事件及队列任务已清理，原体验账号与设备存储、旋转设置已恢复，AVD 保持登录并停在“聊过的事”。首次存储恢复断言失败后按原备份完成恢复并复核，详见验收记录。

证据在 `.data/release-account-menu/`。没有重建原生 APK；本次未复测实体机、TalkBack 或真实语音。

## 重要理解核对入口发布（2026-11-15）

已发布 `20261115T114721Z-ui-fixes`，仅在 Agent 标记的重要总结或推测旁显示“这符合你的意思吗？”。普通聊天、用户消息、旧的未标记消息、安全／错误提示及已有核对表单的建议卡不显示，UI V2.1 样式保持。

- 发布包 SHA-256：`ce9fe9af93036e48d2d996bf5f4d2ffea23706f2d942444479f682d28ed31942`；源码清单及线上构建资源哈希匹配。
- 45 项单元测试、生产构建、本地 Android 14 场景及 Agent 专项通过；服务器 25 项集成测试通过；AVD 直连线上五组真实模型与交互检查通过。
- 运行版本为 `reso-agent-v5-2026-11-15`。新标记使用已有运行记录 JSON，消息详情和分页按事件与域读取；没有新增依赖或数据库迁移。
- 发布前备份：`/var/backups/reso/reso-before-20261115T114721Z-ui-fixes.dump`，旧版本 `20261115T111557Z-ui-fixes` 保留，未触发回滚。API、Worker、Caddy 和 PostgreSQL 正常，无异常自动重启。
- 仅清理本次一个临时账号、一个事件和对应任务，原体验账号、设备存储和六轮模拟会话保留；清理后公网健康检查通过。

完整范围、证据与历史消息行为见 [重要理解核对验收](understanding-prompt-acceptance.md)。本次未复测实体机、TalkBack 或真实语音。


## High 思考与逐条展示发布（2026-11-15）

前端、API 和 Worker 已统一发布 `20261115T151536Z-ui-fixes`，运行提示版本 `reso-agent-v6-2026-11-15`。请求启用 thinking，强度为 high，输出预算 16,384 tokens。每条带有实际模型思考的新回复提供“思考过程”展开区域，沿用 UI V2.1。

- 包 SHA-256：`bfa7fd02922043530fb7b101b68800f6226bb3965191630c98b79d7916a01a2c`；源码与公网入口构建校验一致，无依赖或数据库迁移。
- 本机 48 项单元测试、生产构建、5 项 Agent 后端集成测试通过；Android 14 组功能场景及 Agent 建议专项通过（测试报告共 16 项）；服务器 25 项隔离集成测试通过。
- 切换前备份：`/var/backups/reso/reso-before-20261115T151536Z-ui-fixes.dump`，上一版本保留。重启切换时出现短暂 502，重试后健康检查通过，未触发回滚。API、Worker、Caddy、PostgreSQL 均正常，两个业务服务异常重启数为 0。
- AVD 无 ADB reverse，直连 HTTPS 线上，六轮真实 DeepSeek 对话逐条取得思考并验证最终正文分离；刷新后仍存在，原生触摸可展开，长文本区域限高并可滚动。保留体验账号及“亲子沟通模拟·高强度思考”会话供用户查看，没有代用户保存练习或分享。

详见 [High 思考验收](high-thinking-acceptance.md)。现有服务器 APK 继续读取线上更新，未重建原生包；未复测实体机、TalkBack 或真实语音。


## 自然多轮对话提示发布（2026-11-15）

已发布 `20261115T153144Z-ui-fixes`，提示版本 `reso-agent-v7-2026-11-15`。加入两段日常多轮示例，减少固定共情开场、追问与结尾推销下一步；用户讲计划不再被视为生成练习的授权。high 与逐条思考展示继续启用，UI V2.1、原生 APK、权限和确认保存流程保持原实现。

- 包 SHA-256：`4c0dbb990a996e1f0c7b1eadce6dcd55ecf65c5f2568762dd16f0741a3f85fa3`，源码清单与公网入口校验通过，无数据库迁移或新增依赖。
- 48 项单测及生产构建通过；服务器全部 25 项隔离集成测试通过。
- 真实模型检查覆盖 13 类行为；最后完整轮次为 12 类通过、摘要一类失败，收紧摘要来源规则后该项补测通过。表达指南也修复了感受不明时把用户要求代拟的请求一起留空的问题。审核使用同一供应商的独立调用，不是独立专家评估。
- AVD 无 reverse 直连线上，新建九轮小组作业会话。九条回复均 complete、无重试或追加问题；前七轮无建议卡，第八轮明确要求后生成一份待核对表达草稿，结束时不再安排下一步。思考刷新后保留、原生触摸可展开；无自动保存或分享。
- 发布前备份 `/var/backups/reso/reso-before-20261115T153144Z-ui-fixes.dump`，前一版本保留；切换时短暂 502，重试后健康检查通过，未触发回滚。API、Worker、Caddy、PostgreSQL 正常，两个业务服务异常重启数为 0。

验收范围、原始失败与补测、九轮记录和截图见 [自然多轮对话验收](natural-dialogue-acceptance.md)。未重建 APK，未复测实体机、TalkBack、真实语音或长期对话稳定性。


## 重要的人布局发布（2026-11-15）

已发布 `20261115T155803Z-ui-fixes`。重要的人采用参考图布局：顶部搜索／邀请、最近联系人、轻话题横幅、分组列表与私人专业支持卡；保持 UI V2.1 和三项主导航。人物和分组示例名称去掉“（测试）”，支持卡提示改为“体验资料”。

- SHA-256：`a68dbf76e208545df33bcf5fc2a4802813884f848bbf566742aedc99022d2146`；源码清单与公网入口构建哈希一致。无新增依赖或迁移，原服务器 APK 继续使用。
- 49 项单测、生产构建及账号集成专项通过；服务器全部 25 项隔离集成测试通过。本地 AVD 原有 14 组流程通过，三人布局专项修正后通过，线上 AVD 空状态、话题卡及邀请入口检查通过。
- 发布前备份 `/var/backups/reso/reso-before-20261115T155803Z-ui-fixes.dump`，上一版本保留，未触发回滚。切换期间短暂 502，重试后健康检查通过，API、Worker、Caddy 与 PostgreSQL 正常，异常重启为 0。
- 恢复原体验账号与设备存储，线上 AVD 保持登录并停在重要的人页面；没有写入联系人、邀请、消息或申请。

详见 [重要的人布局验收](people-layout-acceptance.md)。未复测实体机或 TalkBack。
