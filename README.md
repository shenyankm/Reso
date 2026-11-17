# Reso

React＋TypeScript 共享移动端界面及 Tauri 2 Android 本机调试包，沿用 Reso UI V2.1。Fastify API、独立 Agent Worker、PostgreSQL 已实现；数据会跨刷新及服务重启保存。

## 公开仓库与首版发布

源码：[shenyankm/Reso](https://github.com/shenyankm/Reso) · [v0.1.0 开发预发布](https://github.com/shenyankm/Reso/releases/tag/v0.1.0)。Release 提供 Web 构建产物、Android ARM64 服务器调试包和 SHA-256 校验文件；源码包由 GitHub 按 tag 提供。

Web 构建包需要配合 API/Worker/PostgreSQL 使用，不能只打开 index.html 便获得完整服务。Android 调试包连接现有 HTTPS 服务；本次源码发布没有部署该服务，线上页面/数据库版本不保证与 tag 同步，也不是商店签名安装包。

数据库默认运行基线仍为 `0001–0007`。V2.3 设计的 M1a/M1 已拆成显式选择的增量文件，并在一次性 PostgreSQL 集群验证迁移、合成旧数据回填、备份恢复与受限只读权限；见 [M1a/M1 方案](docs/database-m1-implementation-plan.md)与[隔离验收](docs/database-m1-isolated-acceptance.md)。**现有业务库及线上服务未迁移，原生 API/Worker 未切流。** 公开发布未包含 `.env`、业务库、用户聊天/附件或本地备份；资料范围见 [来源说明](docs/source-materials.md)。

## 服务器版

访问 [openwook.cloud](https://openwook.cloud)，或下载 [Android 服务器调试包](https://openwook.cloud/downloads/Reso-server-debug.apk)。本机 AVD 已安装该包，直接连接 HTTPS 服务，不依赖电脑上的 Vite／API／Worker 或 ADB 转发。服务器使用新数据库，需要创建账号；本机已有账号、记录和草稿仍保留在本机环境，没有迁移。

服务器采用 Caddy、systemd、Node.js 和 PostgreSQL；部署位置、更新步骤、备份与验收见 [服务器部署](docs/deployment.md)。本机开发方式继续保留。

## 启动

需要 Node.js 受支持 LTS（本机使用 Node 22.23.2）和正在运行的 Docker Desktop。

```sh
npm install
npm run setup
npm run db:up
npm run db:migrate
npm run dev
```

访问 http://localhost:5173。手机与电脑同一网络时，使用 Vite 输出的 Network 地址。首次在页面创建测试账号，密码至少 10 位。没有预设账号。

`setup` 仅在 `.env` 不存在时生成数据库密码和会话密钥；已有文件会保留。数据库容器只绑定本机 `55436`，API 只绑定本机 `8787`，Web 通过代理访问 API。数据库使用 Docker 命名卷，停止容器不会删除记录。不要把 `.env` 提交到仓库。

升级旧版本时，先停止 Web、API 和 Worker，备份数据库及私有 `.env`，然后执行 `npm run db:migrate`，完成后统一 `npm run dev`。迁移使用 `MIGRATION_DATABASE_URL`；运行时使用受限的 `DATABASE_URL`。旧版只有一个管理员连接时，迁移命令会创建独立运行账号并更新这两个配置，其余凭据保留。API 和 Worker 启动只验证角色、版本和校验和，不执行建表；缺少迁移时启动失败并提示先迁移。

迁移位于 `server/migrations/`，有执行记录、校验和、事务及并发锁；已执行的文件不能修改，后续变化新增迁移。旧版分享内容和邀请会转换到新结构；旧同意记录保留为历史记录。当前已移除开发测试说明的强制确认，登录不会自动写入同意记录；摘要和纪要分享仍需用户明确操作。细节见 [数据库与后端结构](docs/database.md) 和 [权限矩阵](docs/permissions.md)。

## 本机 Android

已生成 Tauri 2 Android 工程，调试 APK 包名为 `app.reso.local`。保持 `npm run dev` 运行并启动本机 ARM64 AVD 后：

```sh
npm run android:build
npm run android:install -- emulator-5554
```

连接服务器则使用 `npm run android:build:server` 和 `npm run android:install:server -- emulator-5554`，输出 `.data/android/Reso-server-debug.apk`。两种调试包使用相同包名，安装时互相替换；不同来源的会话和设备存储相互隔离。运行本机 E2E 前请切回本机调试包。

APK 位于 `.data/android/Reso-local-debug.apk`。该包通过 ADB 转发连接本机 Web/API，需要开发电脑服务持续运行。构建、验收结果和发布边界见 [Android 说明](docs/android.md)。

## 配置模型和语音

在项目 `.env` 填写：

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
DOUBAO_ASR_API_KEY=
DOUBAO_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
```

如果豆包控制台显示的是 APP ID、Access Token、Secret Key，使用以下旧版鉴权配置（无需 Secret Key）：

```dotenv
DOUBAO_ASR_API_KEY=
DOUBAO_ASR_APP_ID=你的APP_ID
DOUBAO_ASR_ACCESS_TOKEN=你的Access_Token
DOUBAO_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
```

API Key 和 APP ID＋Access Token 二选一；同时配置时优先使用 API Key。旧版凭据必须两项齐全，页面才会启用语音入口。这里使用普通语音服务接口，不适用于方舟 Agent Plan 专属 Key。[官方鉴权说明](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=zh)

DeepSeek 与豆包 ASR 使用各自平台的凭据；具体模型和语音资源需在账号中开通。修改后重启 API 和 Worker（统一启动时 Ctrl+C 后重新 `npm run dev`）。密钥只由服务端读取。

未配置 DeepSeek 时，消息照常保存，并明确提示无法生成回复；没有演示回复兜底。未配置豆包时录音转写不可用。配置后，最长 60 秒录音在浏览器转为 16kHz 单声道 PCM，经服务端调用豆包，转写文字放入草稿，用户确认后才发送；音频不写入数据库。

手机局域网 HTTP 可以验收文字功能，麦克风需要 HTTPS；电脑可使用 localhost。网络地址变化时，把新的 Web 地址加入 `TRUSTED_ORIGINS` 并重启 API；从局域网地址注册/登录即使用对应地址的会话。

## 本版可验收

- 主导航“Reso／聊过的事／我的”：Reso 固定进入私人聊天，事件及人物用于查找聊过的事。“我的”汇总已保存记录、待回访、隐私与数据及导出；已保存记录与本机草稿分开，已回看的回访继续保留在记录中。
- 注册、登录；独立账号与事件。
- 私人聊天、后台任务、SSE 更新、失败重试、历史消息分页。
- SCQA 24 题逐题保存、八个独立均分；发现可接受、拒绝或修改，后续 Agent 只读取确认摘要。
- 五幕叙事练习、逐幕修改、暂停恢复、私人故事保存；非暴力沟通与情境排练表单，保存内容供后续私聊使用。
- 事件名称与摘要编辑、版本冲突提示、完整事件资料导出与删除；私人回访、计划回看时间及待回访列表。
- 邀请链接、独立接受/拒绝、公开房间聊天；按人授权固定版本的摘要、撤回分享、撤销成员访问及退出房间。
- 双视角分别填写和确认；原话／AI 推测／修正分开记录，按人按版本核对；重要人物详情只列共同事件。
- 私聊与房间稳定直达链接；链接保留原有访问控制，不能代替邀请或授权。
- 咨询目录最多三条，按明确方向给出简单匹配理由；默认无真实人员，本地测试资料单独标识。
- 咨询申请、取消、接单、拒绝说明、咨询师提议时间与申请人确认、完成状态；专业端按申请隔离。
- 版本化咨询纪要与草稿；申请人可单独向当前成员分享固定版本、撤回，成员退出同时撤权。
- LangGraph 安全检查、理解与策略、回复及校验；显式即时危险在私聊显示求助卡并暂停练习；房间静默有旁听提示。

邀请会公开当时确认的事件名称；之后私人改名不会同步公开。受邀者接受后可读取房间已有公开历史，不能读取私人聊天、原始问卷和私人练习。分享撤回阻止后续读取，无法收回对方已经看到或复制的内容。公共 Agent 只使用所有当前成员均获授权的相同摘要，避免通过公开回复泄露仅对个别人授权的内容。

“邀请与分享管理”中可单独撤回摘要，对方仍能留在房间聊天；也可核对当前摘要后重新分享，或移出成员并撤回授权。内容快照与授权历史分开保存，不随私人编辑覆盖；历史公开消息不会因撤回摘要而自动删除。

升级至 `0004_prd_workflows.sql` 时，旧版单方排定的未完成预约会改为“时间提议”，需申请人确认；已完成记录保留。

咨询师目录默认空。需要测试专业人员流程时，先在页面注册另一个测试账号，然后执行：

```sh
npm run counselor -- registered-test-email@example.com
```

该账号重新登录即可使用专业支持工作台；目录明确标注为本地测试资料，不冒充真实咨询师。原纯 UI 演示保留在 `/?preview=1`，其中示例不属于正式业务数据。

## 检查与边界

```sh
npm test
npm run test:integration
npm run build
npm run test:m1:isolated
npm run test:chat:isolated
```

集成测试在同一 PostgreSQL 实例创建随机命名的隔离数据库，验证多账号权限、分享范围、Agent 上下文、队列事务与连接中断恢复，结束后删除对应测试库。故障注入只针对隔离库。

`test:m1:isolated` 另起 PostgreSQL 17 临时容器，使用 tmpfs、随机本机端口和随机身份；需要 Docker、uv 及 Node.js。它不加载 `.env`、不接受任意目标 URL、不启动现有数据库容器。验证后只清理本轮临时库、角色和容器，私有报告和加密的合成数据备份留在 `.data/m1-verification/`。`db:migrate` 仍只安装 `0001–0007`；不要手工把累计草案依次执行。

聊天体验支持短回复、真实阶段状态、校验后的正文渐进显示及每轮可展开摘要，见[验收记录](docs/chat-response-acceptance.md)。`test:chat:isolated` 复用同一临时集群保护；加 `-- --app` 验证已启动模拟器中的本机调试包，加 `-- --app --live` 另验证真实 DeepSeek（只读取并传入模型凭据，发送合成对话）。这些命令不连接现有业务库，也不部署线上服务。

测试建库使用迁移连接，业务请求及回复处理使用独立受限账号。测试会清理本次创建的库和角色，不修改正式账号。`npm run dev` 的 API/Worker 启动器会剔除迁移连接和管理员密码；生产部署应只向运行容器提供运行凭据，不挂载含管理员凭据的开发 `.env`。pg-boss 在运行时保留任务监督和重试，关闭自动迁移、建队列、统计分区创建和自动重建索引；队列初始化由迁移命令完成。

当前逐项覆盖与未完成项见 [PRD 实现对照](docs/prd-implementation.md)，不代表原 PRD 已全部验收。

本版用于本地开发验收。SCQA 原稿和使用限制见 [docs/scqa-source.html](docs/scqa-source.html)，尚非经过授权及效度验证的正式中文版；均分没有临床阈值。安全规则是初始规则，不能替代人工危机支持。正式未成年人政策、邮件验证/密码找回、真实咨询师资质与服务流程、模型效果和手机录音兼容性仍需后续验收。

Redis 为按需启用项，本版以 PostgreSQL LISTEN/NOTIFY 和 15 秒对账更新页面，pg-boss 处理任务；未部署 Redis、附件存储或视频服务；Tauri Android 本机调试包已在 AVD 安装验收。当前 Agent 具备策略选择和受限上下文，不包含完整专业方法库或临床效果评估。

需求见 [docs/prd.md](docs/prd.md)，选型见 [docs/tech-stack.md](docs/tech-stack.md)，验收记录见 [docs/mvp-acceptance.md](docs/mvp-acceptance.md)，素材来源见 [public/assets/README.md](public/assets/README.md)。

## 工程稳定性

默认运行迁移为 `0001–0007`，包含读取索引及 Agent checkpoint/建议记录。`server/migrations/m1/` 的 `0008/0009` 由隔离演练显式选择，API/Worker 不会自动加载；把旧服务指向已升级 M1 的库会因版本不匹配拒绝启动。工程审查、修复证据、隔离查询测量与未验收边界见 [engineering-stability.md](docs/engineering-stability.md)。

消息与回复任务同事务提交；通知中断自动重连，推送不可用时页面继续通过定期刷新恢复。`/api/status` 实际探测数据库，故障返回 503，`notificationsConnected` 单独显示通知连接状态；不表示 Worker、模型或转写供应商已就绪。

普通 Web 业务请求 15 秒超时，语音转写客户端 100 秒；超时不会自动重复提交。业务数据库连接等待最多 5 秒，其查询和空闲事务为 15 秒，新回复任务活动期限为 180 秒。异常退出后重新启动 Worker，过期任务按队列重试规则恢复；不可把本地 `npm run dev` 当作生产进程托管。

`PUBLIC_ORIGIN` 使用 HTTPS 时启用 Secure 会话 Cookie；本地默认 HTTP 保持可登录。切换部署地址时同步修改受信来源，配置实际 HTTPS 终止和运行凭据后再单独验收，不将开发 `.env` 交给公开运行环境。

## 性能验证

已增加详情读取索引、消息轻量分页和演示代码按需加载。正常入口的演示代码不随首屏加载；历史消息页继续逐次检查当前权限。Agent 最新真实回复性能测量见 [性能验收](docs/performance-agent.md)；数据库和构建历史基线见 [performance.md](docs/performance.md)。

```sh
npm run benchmark:bundle
npm run benchmark:performance -- paired
```

接口基准使用随机隔离库；需要 `.env` 中的本地迁移凭据，并在结束时清理合成数据。该命令会临时移除和恢复隔离库的三处索引，不改变本地用户业务库，不调用模型或语音供应商。

## 使用体验修复

Android 键盘避让和系统返回、统一表单、账号/事件隔离的本机草稿、保存反馈、中文登录错误、固定分享版本预览和问卷续答已实现。首次登录可直接聊天；账户菜单和事件操作分开。修复范围、验证证据与边界见 [UI 修复验收](docs/ui-fixes.md)。

## 完整功能 E2E

```sh
npm run test:e2e
E2E_LIVE=1 npm run test:e2e:live
```

Android E2E 串起真实页面、HTTP、隔离数据库、队列回复和多角色流程，并核对系统保存后的实际 JSON 文件。默认命令使用供应商替身，不产生模型或转写调用；真实供应商通过第二条命令独立验收，失败不会被算作已通过。前置环境、覆盖与恢复约定见 [E2E 说明](e2e/README.md)。

2026-11-14 的覆盖矩阵、修复和供应商阻断见 [功能验收报告](docs/e2e-acceptance.md)。

## Agent 能力与验证

可以在私人聊天中要求“按原话整理私人摘要，先让我核对”“帮我整理表达练习”或“整理一条回访”。Reso 可按需查当前域的历史与保存记录，输出有原话来源的可编辑建议；确认后才写入实际业务。失败可恢复，旧建议不能覆盖新记录。设计、权限、恢复和验收边界见 [Agent 说明](docs/agent-design.md)。

```sh
EVAL_LIVE=1 npm run eval:agent
```

这条命令会调用收费 DeepSeek，以合成事件检查实际工具与多轮行为，不读取原用户内容。默认 `npm run test:e2e` 包含 Android 建议确认专项，但使用模型替身，不能代替真实评测。
