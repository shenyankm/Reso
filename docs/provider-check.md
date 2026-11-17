# 真实服务联调记录

## DeepSeek 自然多轮对话联调（2026-11-15）

v7 提示已上线，新增倾诉、拒绝、纠正、改写、明确练习请求和结束话题的连续示例。AVD 使用未出现在提示中的小组作业情境，九轮真实线上调用均完成；前七轮不生成练习卡，第八轮明确请求才读取指南并生成一份表达草稿，第九轮简短结束。九轮均没有追加问题，思考字段持久化及原生展开通过，未保存业务记录或分享内容。

13 类本机真实供应商行为检查保留了失败记录，修复后补测通过；同模型审核不是独立专家验收。完整结果和限制见 [自然多轮验收](natural-dialogue-acceptance.md)。

## DeepSeek high 思考联调通过（2026-11-15）

已上线显式 `thinking: {type: 'enabled'}`、`reasoning_effort: 'high'` 和 16,384 tokens 预算。AVD 通过线上 API、队列、Worker、LangGraph 与 `deepseek-flash` 跑了六轮新生成的模拟亲子对话，无替身、无直接写入助手消息。六次运行均 complete，实际返回并存储 `reasoning_content`；三轮调用了受限练习工具。单次任务耗时 1.935–7.836 秒，仅代表本次样本，不是性能基准。详见 [验收记录](high-thinking-acceptance.md)。

## 最新结果：语音转写通过（2026-11-15）

旧 App ID／Token 的服务器请求仍返回 401，提示找不到资源授权记录；本机和服务器配置一致。复核请求编号为 `20261115083254F61C4B8D5A7039067797`。

用户提供新的语音 API Key 后，使用相同接口及 `volc.seedasr.sauc.duration` 识别成功。本机与服务器私有配置已同步，Key 未进入源码、APK 或本记录。

- 合成样本：“今天我想练习表达我的感受。”；16kHz、单声道、16 位 PCM。
- 供应商直连识别为同一句，单次约 3.34 秒；公网 `/api/asr` 返回 200、同一句，单次约 3.40 秒。这不是性能或准确率基准。
- AVD 实际通过 Android 录音权限并启动、停止 MediaRecorder；合成普通话流经过真实录制、解码、重采样、公网 multipart 和真实豆包识别。
- 回填保留“我先写下：”草稿前缀，事件消息数仍为 0，未自动发送。临时账号、事件及草稿已清理。
- 授权失败改为明确的 503 服务错误，保留录音及用户登录；日志只记状态和跟踪编号，不记录凭据或上游响应正文。42 项单元测试、Ubuntu 上 24 项隔离集成测试通过。

证据在 `.data/asr-server-check/server-result.json`、`.data/asr-server-check/android/results.json` 及同目录截图。未采集私人录音；实体机麦克风、不同口音及噪声效果未验收。以下保留旧版联调记录。

日期：2026-11-13（Asia/Singapore）。Web、API、Worker 已重启并读取当前 `.env`；未变更数据库数据及其他项目服务。

## DeepSeek：通过

修正 `.env` 中 API Key 末尾一个多余的非 ASCII 字符后，官方接口 `https://api.deepseek.com/chat/completions` 直连成功。

随后使用独立“供应商联调测试”账号，走实际注册、同意、创建事件、消息写库、pg-boss、Worker、LangGraph、DeepSeek 和回复保存全链路；模型 `deepseek-flash`，轮询观察到完整回复约 2.05 秒。

测试输入：“这是功能测试。今天我有一点紧张，希望有人听我说。请用一两句话回应。”

实际回复：“你说今天有点紧张，希望能有人听你说——我在这里听着。
不用急着解释紧张从哪里来，你想说多少都可以，也可以先停一停。”

## 豆包 ASR：未通过

按用户截图配置 APP ID＋Access Token，Secret Key 未使用。配置识别与认证 API 已启用，但向上游 WebSocket 发起的真实请求在鉴权阶段被拒绝，音频识别尚未开始。

- 应用接口：HTTP 502（统一服务错误提示）。
- 上游接口：HTTP 401。
- 返回：`load grant: requested grant not found in SaaS storage`。
- 请求编号：`202611130828595111419494F99461C40E`。
- 当前资源：`volc.seedasr.sauc.duration`；诊断另一小时版资源也未通过，未改动最终资源配置。

已核对文档中的旧版鉴权字段，并对截图 OCR 的大小写候选做过核验；仍无法确认凭据与该语音资源的有效授权。需在控制台核对应用、Token 与流式识别资源的对应关系，重新复制有效 Token 后复测。请勿把密钥写进本记录。

测试样本是本机合成语音：“你好，这是语音转写测试。今天我想慢慢说清楚自己的感受。”已转换为 16kHz、单声道、16 位 PCM；没有使用用户私人录音。由于鉴权未通过，不能据此声明转写准确率、延迟或手机录音已验证。

脱敏机器记录：`.data/provider-check/report.json`。临时会话 cookie 与 OCR 凭据副本已清理；密钥仅保存在忽略提交的 `.env` 中。


## 按官方文档复核

对照 [大模型流式语音识别 API](https://docs.volcengine.com/docs/doubao-voice/large-model-streaming-automatic-speech-recognition-api-1?lang=zh) 的鉴权和协议章节复核：APP ID 对应 `X-Api-App-Key`，Access Token 对应 `X-Api-Access-Key`；2.0 小时版资源为 `volc.seedasr.sauc.duration`，`model_name` 固定 `bigmodel`。现有 16kHz、16 位单声道 PCM、200ms 分包、Gzip 与最后一包标记符合本文说明。

已补齐正式代码中的 `X-Api-Sequence: -1` 和连接跟踪 ID。7 项测试和构建通过。补齐后的实际请求仍在握手阶段失败；诊断上游返回 HTTP 401，错误文本未变，请求编号 `20261113083307DCBD00B5C1CC565FAEC3`。

这说明尚未匹配有效鉴权，不足以仅凭此错误确定是未开通资源。截图中 Token 的识别精确度、凭据是否已更新、应用与资源的授权匹配均仍需排查；不是已经证实的 PCM 编码或二进制消息错误。
