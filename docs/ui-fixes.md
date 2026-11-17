# Android 使用体验修复验收

2026-11-13。依据 Impeccable 对 `src/MvpApp.tsx` 的 Android 流程审查，修复全部五项优先问题及次要流程问题。保留 Reso UI V2.1 的角色、配色、插图和分享授权规则；未新增数据库表或迁移。

## 修复与证据

证据位于本机 `.data/ui-fixes/`，包含 AVD 原始截图、UI XML、构建日志与数据摘要。

| 问题 | 当前行为 | AVD 证据 |
| --- | --- | --- |
| 键盘与系统返回 | 原生容器处理系统栏、缺口和 IME；键盘打开时可直接发送。系统返回先关闭弹窗、返回任务，再在根页面退到后台，保留原生任务。横屏输入保留事件名和可见范围。 | `10-keyboard-open.png`、`12-sent-with-keyboard.xml`、`19-native-back-to-chat.xml`、`46-discard-guard.xml`、`132-landscape-input-final.png` |
| 默认表单控件 | 业务输入和多行框统一为标签在上、内容占满宽度，保存期间禁用编辑，使用原有边框和焦点样式。 | `28-nvc-save-area.png`、`107-followup-fields.png` |
| 草稿丢失及保存反馈 | 聊天、故事、初步了解的改写、沟通练习和回访草稿按账号/事件/用途保存在设备中；已保存状态明确。版本冲突先展示最新内容，由用户核对后保存。退出前提示清理未保存草稿；会话失效、删除及撤权清理对应缓存。 | `27-restart-draft-restored.xml`、`29-nvc-saved.xml`、`71-draft-conflict.xml`、`75-conflict-resolved.xml`、`79-logout-draft-warning.xml`、`88-guest-room-no-draft.xml`、`96-owner-draft-cleared.xml`、`104-story-restored.xml`、`109-followup-saved.xml`、`140-finding-restored.xml` |
| 分享版本不明确 | 按接收人显示实际可见正文、版本和授权时间；私人新版与已共享旧版分开。更新需要再次确认；撤回保留房间资格。历史邀请内容另有说明，不冒充当前授权。 | `61-shared-old-version.png`、`63-share-confirm.xml`、`64-shared-current-version.xml`、`65-withdrawn.xml` |
| 登录错误关闭表单 | 普通认证失败保留表单和邮箱，显示中文提示并可直接重试；已登录业务会话失效仍清理受保护界面。 | `85-login-error-retained.png`、`87-guest-logged-in.xml`、`147-business-session-expired.xml` |

## 次要流程

- 首次注册/登录且无事件时直接进入私人聊天，稍后可改名；保留显式命名的新建入口。`09-first-chat.xml`。
- 工具按了解自己、整理表达、一起沟通与支持逐组展开；账户菜单不再混入上一次事件的操作，事件菜单显示明确名称。`15-tools-grouped.png`、`50-event-menu.png`。
- 未完成问卷定位首道未答题；完成后先展示发现，并可查看已填写答案。前两题由 AVD 作答；结果分支剩余答案通过认证 API 准备。`39-resume-third-question.xml`、`136-complete-result.xml`、`141-view-saved-answers.xml`。
- 叙事引导只作输入提示，不再预填成用户正文，未填写时不能保存。`98-story-empty-editor.xml`。
- 真人支持空目录说明当前没有人选，并提供回到对话与查看其他支持方式。`114-support-empty-recovery.xml`。
- 本机链接明确标注设备范围；服务配置不再冒充供应商连通验证。PRODUCT.md、DESIGN.md 与 Android 说明同步当前状态。

## 自动检查与原生检查

21 项单元/组件测试、16 项 PostgreSQL 隔离集成场景、类型检查、Web 构建及 Android APK 构建通过。新增回归覆盖草稿命名空间、损坏存储、清理范围、认证错误来源与中文文案、问卷续答，以及分享正文/版本/时间和接收人隔离。

本机 Pixel9_API35（Android 15、ARM64、emulator-5554）实际验证了输入发送、页面和系统返回、弹窗放弃保护、草稿跨页面及强制重启恢复、冲突核对、保存反馈、两账号切换、分享更新和撤回、问卷续答与发现改写。受邀成员资格通过认证 API 准备，随后在 App 检查接收方；不计作原生邀请链接接收端到端验收。完成一轮真实 DeepSeek 回复，未调用 ASR。

最后的根页面返回复核发现 Tauri Activity 销毁时有原生 mutex 崩溃；根返回已改为 `moveTaskToBack(true)`，保留任务并回到桌面。AVD 已验证返回桌面后 PID 不变、该进程无新增崩溃、再次打开保留登录及事件，证据为 `160-root-fixed-background.xml`、`161-final-restored.xml` 和 `root-back-crash.log`。

检查了系统字体 130% 和 200%、夜间模式切换、横竖屏及横屏键盘；保持既有浅色视觉，设备设置已恢复。没有覆盖所有字体/设备组合或完整辅助技术操作。

## 数据保护与交付边界

两个临时账号及一个事件已清理。原有 23 张认证/业务表的行数及全字段摘要一致，私有配置校验和一致；正常变化的登录会话及队列运行元数据不计入该比对。结果在 `.data/ui-fixes/data-verification.json`。已恢复 `demo@reso.test` 登录和“我的关系”页面，恢复后再次比对全部原表摘要一致；临时凭据副本已删除，XML 密码字段已脱敏。代码备份为 `.data/ui-fixes/before-fixes.tar.gz`。

APK 为 `.data/android/Reso-local-debug.apk`，包名 `app.reso.local`。它仍通过 ADB 转发加载本机 Web/API，依赖 PostgreSQL 和 Worker；未交付独立生产服务、生产签名或跨设备链接。草稿位于当前设备，不是服务器备份，也不会自动进入模型上下文、分享或导出。

真机、TalkBack、真实语音转写、跨设备邀请、正式咨询师运营及生产发布未在本轮验收。
