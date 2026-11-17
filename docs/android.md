# 本机 Android 调试包

服务器调试包已补充，见本文末尾“服务器连接”；本机包的构建和验收方式继续保留。

当前 Android 工程使用 Tauri 2，应用名 Reso，包名 `app.reso.local`。目标是本机 AVD 验收；不包含生产签名或可脱离开发电脑运行的服务端。

## 构建与安装

需要 Android SDK、NDK、JDK，以及 Rust 的 `aarch64-linux-android` 目标。构建脚本优先读取 ANDROID_HOME／ANDROID_SDK_ROOT、NDK_HOME、JAVA_HOME；macOS 默认使用用户目录的 Android SDK 和已安装的 JDK 17。

```sh
npm install
npm run db:up
npm run db:migrate
npm run dev
```

启动本机 ARM64 AVD 后，在另一个终端运行：

```sh
npm run android:build
npm run android:install -- emulator-5554
```

APK 固定复制到 `.data/android/Reso-local-debug.apk`。安装脚本仅选择运行中的 emulator 设备，建立 `adb reverse tcp:5173 tcp:5173`，保留安装并启动 Reso。AVD 重启后需重新运行安装命令建立转发；`adb reverse` 不是永久网络配置。

Android 工程已经生成并随源码保留，普通构建不需重复初始化。`npm run android:init` 用于首次生成工程；重新生成时脚本保留已有 MainActivity，并恢复录音权限和 adjustResize；其他手工原生调整仍需保留。应用图标由现有 `public/favicon.svg` 生成，构建时同步到 Android 资源。

## 运行方式与边界

本机包通过 `src-tauri/tauri.local.conf.json` 将前端入口设为 `http://localhost:5173`。前端由开发电脑上的 Vite 提供，`/api` 继续代理到本机 Fastify。这样登录 Cookie、SSE、邀请和现有鉴权保持同源，不需要把密钥或管理员连接打进 APK，也没有扩大后端 CORS 范围。

这个调试 APK **不内置 Web 前端**；Vite、API、Worker 和 PostgreSQL 停止或 ADB 转发失效后，应用不能继续正常使用。默认 Tauri 配置仍保留 `../dist` 的静态构建路径，后续生产打包需要另外确定服务地址、认证方式和签名，不能直接把本机配置当作生产发布。

Android 的调试构建允许本地 HTTP；正式构建不启用这个明文网络例外。Manifest 声明网络与录音所需权限，录音仍需用户在系统提示中同意。当前没有申请 Tauri 文件、Shell 或远程原生命令权限。

调试构建去除 Rust 调试符号以缩小 APK，保留 WebView 调试能力。当前 Gradle 模板仍提示旧变体 API 和 Java 8 目标的弃用警告，构建通过；未配置正式发布签名。

## 本机验收（2026-11-13）

- Pixel9_API35／Android 15／ARM64，设备 `emulator-5554`；安装 `app.reso.local` 0.1.0 并正常启动。
- ADB 操作已验证登录、新建私人事件、强制关闭后恢复会话和事件、退出账号。未发送模型消息或调用语音供应商。
- 登录页已移除开发测试勾选、数据使用说明、版本文字及对应业务前置校验，登录不自动生成同意记录；具体分享授权保留。
- 验收账号和事件已删除，原有 24 张认证／业务表的行数及全字段摘要一致。模拟器停留在空白登录表单，开发服务保持运行。
- 16 项单元／组件测试、16 项 PostgreSQL 集成场景、类型检查和 Web 构建通过。

原生构建日志、UI XML、截图和数据比对结果位于 `.data/android/`，其中 `auth-clean.png` 为最终登录页，`restart-ui.xml`／`restart.png` 为重启恢复证据，`data-verification.json` 为原数据保留结果。尚未验收真机、录音、系统深链接或正式发布。

## 使用体验修复

MainActivity 现在统一处理系统栏、显示缺口和 IME 边距，向 WebView 传递已归零的对应边距，避免重复留白。采用 AndroidX 返回回调通知 React 当前页面，弹窗和子页面优先处理，根页面将任务移到后台，避免销毁 Tauri Activity 时触发原生 mutex 崩溃。WebView 读取系统字体缩放。实现依据 [Android WebView 边距说明](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets) 、[Activity 任务后台 API](https://developer.android.com/reference/android/app/Activity#moveTaskToBack(boolean)) 和 [系统返回指南](https://developer.android.com/guide/navigation/custom-back)。

共享界面修复了业务表单、私人草稿、保存反馈、登录错误、分享版本与菜单结构；后续验收结果见 [ui-fixes.md](ui-fixes.md)。草稿保存在当前设备的应用 WebView/Web 存储中，按账号、事件和编辑用途隔离；退出或失效清理，未提交的草稿不会进入 Agent、公开聊天或导出。

## 原生导出与功能 E2E（2026-11-14）

事件导出改用 Android 系统文件创建器。用户选择位置后写入 JSON，实际完成才提示已保存；取消单独提示。桥只接受指定来源的主框架消息，校验事件 UUID，最多 8 MiB UTF-8 数据，不申请通用存储权限。超限时提示改在电脑端导出，旧 APK 缺少桥时提示更新。普通 Web 保持浏览器下载。

实现使用 [AndroidX WebView 消息监听](https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener(android.webkit.WebView,java.lang.String,java.util.Set,androidx.webkit.WebViewCompat.WebMessageListener)) 和 [CreateDocument](https://developer.android.com/reference/androidx/activity/result/contract/ActivityResultContracts.CreateDocument)。本机调试 APK 已重新构建安装，实际保存、取消及重新读取文件通过；完整业务覆盖与外部阻断见 [功能验收](e2e-acceptance.md)，执行方式见 [E2E 说明](../e2e/README.md)。

## 我的页面（2026-11-15）

业务底栏新增“我的”，集中提供昵称修改、登录邮箱、已保存故事／表达练习／情境排练／回访、成长回访、隐私与数据、帮助及退出。记录分页读取本人创建事件中的私人内容，打开时回到原事件；本机草稿不列入已保存记录。隐私与数据可按事件调用原生 JSON 导出，无需数据库迁移或重建 APK。

本机 Pixel9_API35 验收通过：41 项单元测试、23 项 PostgreSQL 集成测试、类型检查及构建、18 项 Android E2E 检查。另在系统字体 1.3 倍、系统深色模式下通过“我的”专项，维持现有浅色产品界面；文字可换行，触控目标至少 48px。原字体和主题、账号会话、设备存储均已恢复。专项证据在 `.data/e2e-profile/2026-11-15T00-08-17-730Z/` 和 `.data/e2e-profile/2026-11-15T00-09-10-516Z/`。未扩展邮箱修改、密码管理或云端草稿备份，未验收实体机。

## 服务器连接（2026-11-15）

```sh
npm run android:build:server
npm run android:install:server -- emulator-5554
```

服务器包使用 `tauri.server.conf.json`，入口为 `https://openwook.cloud`，输出 `.data/android/Reso-server-debug.apk`；安装不添加 ADB 转发。原生导出桥只新增这个确切 HTTPS 来源，原本的本机及 debug E2E 来源继续保留。APK 可从 [服务器下载](https://openwook.cloud/downloads/Reso-server-debug.apk)。

两种包均为 `app.reso.local`，安装会替换当前包。按来源隔离的原本机账号会话和草稿仍保留；服务器数据库独立，需要创建账号。服务器包依赖服务器在线；仍是 ARM64 调试包，不代表正式签名发布。

Pixel9_API35 已移除 ADB 转发，实际验证服务器 HTTPS、安全连接、登录、“我的”、四类已保存记录、Android 系统文件保存及退出。导出的 JSON 已重新读取核对。验收账号、事件及对应任务已清理，AVD 留在服务器版欢迎页；证据在 `.data/android/server-review/`。真实模型→队列→Worker→回复通过；后续语音验收见下节。运行原本机 E2E 前请用 `android:install` 切回本机包。

## 真实语音转写（2026-11-15）

旧凭据的握手 401 已由有效语音 API Key 替换，公网转写返回 200。AVD 实际通过录音权限并启动、停止 MediaRecorder；合成普通话经过真实录制、PCM 转换、公网接口与豆包识别，回填为可编辑草稿。原本输入的文字保留，事件消息数保持 0，未自动发送。

本次关闭模拟器的宿主机麦克风输入，没有采集私人录音；系统权限／录制检查与合成音频识别分开完成，不代表实体机或复杂环境识别已经验收。证据在 `.data/asr-server-check/android/`，详见 [供应商联调](provider-check.md)。
