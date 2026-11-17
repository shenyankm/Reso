# 文案、适配与性能验收

2026-11-14。按 Impeccable clarify / adapt / optimize 执行，沿用原品牌、角色、蓝粉渐变与「柔和回应」。本轮修改限于客户端文案、响应布局和前后台更新连接生命周期，无新增依赖或缓存层。

## 文案

- 登录和创建账号各自显示真实操作名称，不再统一写“正在处理”。
- 创建事件按钮改为“创建并开始私聊”，与点击后的结果一致。
- 使用“房间聊天”“房间成员”，避免“公开”被理解为对所有人开放；分享范围、固定版本与私聊隔离说明仍保留。
- “公共 Agent 上下文”改为“房间里的 AI 回复”；服务状态使用“AI 回复（DeepSeek）”“语音转文字（豆包）”，继续明确配置状态不代表上游实际可用。
- 语音未配置时给出改用文字的下一步；退出草稿确认的取消项改为“返回当前页面”，避免暗示会自动保存。
- 超时提示明确“结果尚未确认”，不将超时误报为写入失败。
- 弹窗内发生错误时，仅在弹窗展示一次，避免页面和弹窗重复播报。

## Android 适配

- 修复非聊天页在横屏或较低窗口中全局导航消失的问题，改用紧凑横向导航；编辑中的紧凑任务页仍可收起导航腾出空间。聊天页始终没有底部导航。
- 低高度弹窗保持关闭按钮可见，内容独立滚动。可用高度降至 117px 的横屏键盘场景下，滚动到底部后主按钮完整可见，实际点击区仍为 48px；完整弹窗标题保留在无障碍名称中。
- 320px、200% 系统字体下，隐私标签保持单行；长事件名省略显示，完整名称仍在操作的无障碍名称及菜单中。未发现页面横向溢出。
- 检查了 412px 常规手机窗口、924×364 横屏、117px 键盘剩余高度，以及 768px 较大窗口。较大窗口沿用当前手机产品的单列阅读宽度；本轮没有增加平板双栏或折叠屏交互。
- 系统夜间模式切换后，保留约定的浅色品牌界面，文本和系统栏可读；未新增暗色主题。

## 性能证据

聚焦空闲状态的前后台同步。Android 15 ARM64 Pixel9_API35 模拟器、调试 WebView、ADB Home/返回前台、CDP Network 记录；不是桌面浏览器模拟。原页面加载的稳定基线在后台 18 秒内仍产生 `/api/events` 和 `/api/people` 两次同步请求。

修改后，页面隐藏时关闭 EventSource 并停止 15 秒定时器；回到前台后重连并刷新。重新加载最新代码后，两轮 18 秒空闲后台窗口均为零同步请求。最终一轮还在后台通过隔离账号更改事件名称，返回前台后确认新名称出现，并记录到重新建立的 stream 和两次列表读取。热更新后有一轮仍出现请求，因此对最新源码完整重载，再进行上述两轮测量；记录保留了重载后的结果。

![后台空闲同步对比](../.data/clarify-adapt-optimize/background-comparison.svg)

- 基线：`background-before-stable.json`。
- 修改后：`background-after-reload.json`、`background-after.json`；最终文件包含前台恢复请求和恢复断言。
- 隐藏时实际调用连接关闭：`visibility-trace.json`。
- 已发出的保存不取消：对摘要保存注入 6 秒延迟，提交后立即退到桌面，隔离数据库确认 `PendingDraft` 已保存；返回后页面恢复正常。见 `inflight-save.json`。
- 初始 JS gzip 从 97,131 bytes 到 97,245 bytes，增加 114 bytes（约 0.12%）；UI 演示仍保持独立懒加载。本轮收益为减少空闲后台请求，没有缩包或前台响应加速的结论。

## 验证与证据

`npm test` 25/25、Web 构建、Android 构建和安装通过。API 超时测试覆盖“结果尚未确认”的提示。原生自动断言见 `checks.json`，截图全部来自 ADB。

证据位于 `../.data/clarify-adapt-optimize/`：

| 文件 | 证明内容 |
|---|---|
| `04-landscape-before.png`、`06-landscape.png` | 横屏导航修复前后 |
| `16-short-dialog-bottom.png`、`short-dialog-action.json` | 键盘剩余 117px 时，关闭与主操作可见；主操作完整 48px |
| `22-auth-loading.png` | 登录状态及禁用控件 |
| `28-summary-error.png` | 单一错误提示，输入保留 |
| `29-resumed-save.png`、`inflight-save.json` | 保存中退到后台，保存继续完成 |
| `31-narrow-chat.png`、`32-narrow-menu.png`、`narrow-text.json` | 窄屏、大字体、长事件名与完整无障碍名称 |
| `33-expanded-night.png` | 较大窗口与系统夜间模式 |
| `tests.log`、`build.log`、`android-build.log`、`android-install.log` | 测试、构建和安装结果 |

## 恢复与限制

业务交互在独立数据库与账号执行，验收进程没有上游模型或语音凭据。原数据库 24 张业务表的摘要保持一致。隔离库、账号角色、5183/8788 端口与临时调试连接已清理；原会话、草稿、本地存储和设备设置的最终结果见 `data-verification.json`、`session-verification.json`、`cleanup-verification.json`、`environment-verification.json`。

未测实体机功耗、帧率、TalkBack、折叠屏姿态，也未重跑真实付费模型和语音链路。模拟器中请求减少不等于已经测得电量收益。现有调试 APK 仍依赖本机 5173 服务与 adb reverse。
