# 柔和回应：视觉与动效验收

2026-11-14。方向为用户确认的「柔和回应」，保留 Reso UI V2.1 角色、原插图、蓝粉渐变与单列 Android 界面。实现使用现有 CSS、SVG、Lucide，无新增依赖。

## 交付内容

| 功能 | 本轮结果 |
|---|---|
| animate | 欢迎角色一次 640ms 轻招呼；章节位置线条 220ms 过渡；弹窗短暂进入，关闭立即执行 |
| colorize | 蓝色操作、紫色叙事与表达、绿色已保存；同时保留文字和图标，避免仅靠颜色区分 |
| typeset | 卡片正文统一 14px；关键来源、确认、练习说明为左对齐 13px；窄屏说明与双按钮不再缩到 11px |
| layout | 压缩事件栏多余留白；工具分组加重；专业端刷新收入标题行；修复窄屏大字体隐私标签断行 |
| delight | 保存成功显示勾选；草稿和保存失败不显示成功效果；章节切换不再反复弹“已保存” |
| overdrive | 把角色招呼、章节位置与保存反馈组成同一套轻量回应；不增加循环装饰、声音或新配色 |

章节线表示当前位置，五个按钮可直接跳转，不把前面的章节标记为已完成。聊天消息保持静态，聊天页继续隐藏底部导航。系统减少动画时，角色、当前位置、保存勾选和弹窗内容均保留静态可见状态。

## 验证

- `npm test`：25/25 通过，包括新加的保存反馈、章节位置语义测试。
- `npm run build`、`npm run android:build` 通过；更新后的调试 APK 已安装到 emulator-5554。
- Pixel9_API35、Android 15 ARM64 模拟器真实 WebView，ADB 操作、UI 树和屏幕截图；常规宽度 412 CSS px，以及 320 CSS px + 200% 系统字体。
- 实际点击第三幕和第五幕，当前标记、线条端点正确，48px 点击区保留；没有跳过章节已完成的提示。
- 输入故事并保存，返回记录页显示实际保存内容；非暴力沟通练习经历草稿、注入 PUT 503、重试成功，数据库读取确认内容已写入隔离库。
- 保存失败保留输入与草稿提示，绿色勾选仅在成功后出现。见 `native-checks.json`、`save-verification.json`。
- 在同一原生 WebView CDP 会话内启用 prefers-reduced-motion，检查欢迎角色、章节 SVG、保存图标及打开的弹窗：均为完整静态可见状态。
- 弹窗进入的首帧触发关闭，能够立即移除，无待结束动画阻塞。
- 窄屏大字体发现并修复“仅自己可见”末字换行；最终聊天页和练习页检查无横向溢出、标签保持单行。见 `large-font-verification.json`。

## 证据

证据目录：`../.data/soft-response/`。

- `39-welcome.png`：欢迎页；`welcome.mp4`：ADB 原生录屏。
- `06-third-act.png`、`38-large-exercise.png`：章节位置与大字体；`progress.mp4`：章节切换录屏。
- `22-nvc-draft.png`、`23-save-failed.png`、`28-save-success.png`：草稿、保存失败、重试成功。
- `35-large-chat-fixed.png`：320px + 200% 字体修复结果。
- `47-final-chat.png`：重启验证并恢复原账号后的聊天页。
- `tests.log`、`build.log`、`android-build.log`、`android-install.log`：构建及测试日志。

## 数据与环境恢复

业务验收在单独数据库和运行账号下执行，上游模型与语音凭据从验收进程移除，没有调用真实付费提供方。原数据库 24 张业务表摘要一致。隔离库及角色已删除，5183/8788 已停止。原会话 cookie、localStorage、sessionStorage 已恢复；设备恢复 1080×2424、420dpi、font_scale 1.0，端口映射回原服务 5173。最终重启结果见 `session-verification.json` 与 `restart-app.json`。

## 限制

未验证实体低端 Android 设备的帧率、耗电和 TalkBack，也未重新运行付费模型/语音端到端流程。录屏证明模拟器中的可见行为，不代表实体机性能结论。专业端刷新位置只经过构建与样式检查，本轮没有重跑完整专业咨询业务。调试 APK 仍依赖本机 5173 服务和 adb reverse，不是独立离线发行包。
