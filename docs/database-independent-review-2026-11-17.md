# 数据库设计独立审查

日期：2026-11-17（Asia/Singapore）。范围：当前工作区的数据库目标设计 V2.2、字段模型／字典、JSON 契约、完整 M4 SQL 审阅草案及其基线与检查器。设计尚未迁移，不把草案问题描述为已经发生的线上故障。

> 后续状态：原 9 项已进入 [V2.3 修复台账](database-nine-fixes-2026-11-17.md)。下文保持发现时的 V2.2 观察和行号；本地 reproduce.py 是修前证据，不作为修复后的通过脚本。当前验证使用正式正反例和检查器。

## 结论

三名独立子 agent 分别审查关系规范、字段／JSON 契约和 PRD／Wang 业务覆盖，主 agent 交叉复核。确认 **9 项问题：3 项 P1、6 项 P2**。主要业务域已有数据落点，但仍存在合法业务被草案拒绝、正式契约互相冲突及关键历史关系缺失，不能认定字段已齐全或可以直接实施。

本次结论修正上一轮对“基础补全完成”的完整性判断：现有设计检查通过，并不能证明设计没有遗漏。未将已声明推迟的迁移、运行层、RLS 放行或专业审批本身算作设计缺陷。

## 必须优先修复

### 1．[P1] 完整草案仍只允许保存 understanding 版本

**是什么：**理解、练习和专业纪要共用不可变 `record_versions`。[设计允许多类正文](database-design-v2.md#L107)，M4 也已有练习和纪要的父分支。

**问题：**[M4:138](database-drafts/wang-m4.sql#L138) 仍保留 `content->>'type' = 'understanding'`。一份符合 RecordContent 契约的 NVC 结果，`type=nvc`，必然不满足此谓词；narrative、roleplay、professional_note 同样被挡住。文件没有后续替换此约束。这里是完整草案中遗留的 M1 限制，不是尚未实施的事务问题。

**最小修正：**替换早期类型限制，允许完整阶段的类型范围，并继续校验正文类型与真实父 kind 配对；同时检查 M2/M3 的同类限制。

**不修的影响：**按当前完整草案实施后，多类核心记录无法保存；JSON 校验和事务核权无法绕过数据库 CHECK。

### 2．[P1] 四类新增资料请求被旧范围白名单拒绝

**是什么：**资料请求应覆盖测评、练习及研究主体／素材的导出、擦除等操作。

**问题：**[M4:490](database-drafts/wang-m4.sql#L490) 只允许 account/event/conversation/understanding/record_version/message；[同表扩展分支](database-drafts/wang-m4.sql#L495) 和 manifest 却已支持 assessment_session/exercise/research_participant/corpus_asset。这四种 scope 即使其他字段全部有效，仍必然被前一个 CHECK 拒绝。

**最小修正：**统一完整阶段的范围定义，去掉或扩充过期白名单，增加四类请求的联动正例。

**不修的影响：**承诺的测评／练习／研究资料请求不能正常创建，影响资料处理与撤回闭环。

### 3．[P1] 同一研究通话只能登记一个主体，授权追溯缺少其他参与者

**是什么：**一次真实通话可能包含多位实际参与者，通话数、时长、参与者人数和素材数量需要分别记录。

**问题：**[research_sessions](database-field-dictionary-v2.md#L2043) 只有一个必填 participant_id，素材沿此 session 追溯主体；素材来源边也没有参与者关系。SourceLocator 只有段落／时码／哈希，CaseScenario.actor 仅表示当前决策主体，均不能列出原始素材的全部主体。[Wang V3 第 9 页的离线文本](source-materials.md#离线附件) 明确同一 F1 通话由母亲、孩子、母亲先后交流。以孩子登记后，母亲的 session 范围同意不能挂到该 session；她撤回后，现有来源图也无法精确发现该原始素材涉及她。

**最小修正：**保留一次通话根与真实时长，增加 session 与实际参与者的关联；授权和撤回闭包核对全部相关主体。若需要片段级使用，再将定位与主体关联。

**不修的影响：**多主体素材的授权、撤回和统计不能同时准确表达。拆成多次通话会失去共同通话标识；把整个 leakage_group 停用只能粗粒度兜底，不能证明具体素材已获齐授权。

## 其余确认问题

### 4．[P2] 真实反馈动作与支持历史契约不一致

**是什么：**用户反馈需要进入 `prior_support.reported_effect`，供下一轮支持调整使用。

**问题：**[设计要求 action_code=payload.type](database-design-v2.md#L160)。合法反馈 payload 为 `{"type":"feedback","rating":"helpful"}`，但[支持历史自检](../scripts/check-database-design.py#L211) 只接受 action_code=helpful/unhelpful。把现有正例改为真实 feedback 动作后，JSON 通过、语义自检失败；使用 `type=helpful` 又不符合任何 InteractionPayload 分支。

**最小修正：**统一使用 feedback 动作，并从 rating 明确定义 reported_effect 的映射；正反例直接携带正式 payload，避免另造动作码。

**不修的影响：**合法反馈无法同时满足正式写入契约与状态自检，当前正例不能证明真实反馈链路可表达。

### 5．[P2] 合法题目 ID 无法作为答案键保存

**是什么：**题本、草稿、正式答案及更正必须使用同一套稳定题号。

**问题：**[AssessmentItems.item_id](database-json-contracts-v2.json#L1523) 使用允许 `.`、`:` 的 Code；[DraftAnswers](database-json-contracts-v2.json#L1631) 和 [SubmittedAnswers](database-json-contracts-v2.json#L1648) 的键却禁止这些字符。`item_id=screening.q1` 的题本合法，`{"screening.q1":"yes"}` 的答案在两份契约中均被拒绝。

**最小修正：**统一题号与答案键的命名规则，并添加题本到作答／提交／更正的联动用例。

**不修的影响：**存在可定义、却无法按契约作答的题本；不是增加事务校验能够解决的问题。

### 6．[P2] 重复排练角色 ID 会覆盖角色并绕过台词性质检查

**是什么：**排练需要唯一识别本人和对方，模型生成的对方台词必须标为假设。

**问题：**[roles 契约](database-json-contracts-v2.json#L2010) 没有限制 role_id 唯一，[自检](../scripts/check-database-design.py#L394) 直接转成字典。两个角色同为 `same`，先写家长 `is_user=false`、再写本人 `is_user=true`；模型台词引用 same 且 hypothetical=false，完整 RecordContent 和语义自检都通过。后一个角色覆盖前一个，保存内容无法唯一还原说话人。

**最小修正：**转换前拒绝重复 role_id，保留对 line_id、引用及台词性质的检查，增加该反例。历史读取不擅自改写原文。

**不修的影响：**角色归属不可靠，“对方台词只是假设”的检查存在可绕过情况。

### 7．[P2] 专业纪要缺少绑定确切版本的签署事实

**是什么：**[设计承诺开放与签署按具体版本记录](database-design-v2.md#L113)。

**问题：**[record_state/signed_at](database-model-v2.json#L5690) 只在可变 consultation_notes 根；record_versions 和封闭 professional_note 正文没有签署者、签署时间或签署状态。v1 在 T1 创建、T2 签署，随后 v2 修正并在 T4 再签署，根的状态和 signed_at 更新后，v1 只剩创建事实，不能按正式字段还原 T2 的签署。现有 AuditMetadata 也未定义按确切版本记录签署的事件契约；通用审计文本定位不应被假定为已经定义好的签署历史。

**最小修正：**将签署事实绑定 record_version_id，或正式定义可重建该事实的版本签署事件；根状态仅投影当前版本。

**不修的影响：**专业纪要修订后，旧版何时由谁签署缺少规范的数据依据。此项是版本事实的字段／契约缺口，不代表当前服务已经发生签署丢失。

### 8．[P2] 咨询师推荐卡存不下当时展示的服务资料快照

**是什么：**[PRD F4](prd.md#L69) 要展示资质、方式及费用等；[目标设计](database-design-v2.md#L221) 承诺推荐卡和申请都保留当时公开资料。

**问题：**[professional 候选](database-json-contracts-v2.json#L1170) 只有 consultant_id/name/reason，拒绝额外字段。申请已有 profile_version/service_profile_snapshot，但推荐时可以尚无申请，也没有历史目录实体可回查。推荐时为公益、50 分钟，目录后来变成收费、30 分钟；旧卡若取当前目录会漂移，若只读 payload 又缺少原资料。

**最小修正：**每位推荐候选保存当时 profile_version，并复用已有 ServiceProfileSnapshot 保存实际展示字段。点击申请仍复验当前可用性，无需重建目录系统。

**不修的影响：**推荐到申请之前的展示事实不能可靠重放，用户当时看到的服务信息无法核对。

### 9．[P2] 回访只关联练习根，没有冻结所回访的确切行动版本

**是什么：**回访应知道用户实际尝试的是哪一版练习／约定，[设计也明确要求确切版本](database-design-v2.md#L115)。

**问题：**[followups](database-field-dictionary-v2.md#L1539) 只有 exercise_id，指向可变根；FollowupOutcome 和 PriorSupport.followup_id 也没有原行动版本。record_sources 的目标只允许记录版本或决策，不能把该来源边直接挂到 followup。对 NVC v1 安排回访后，用户修改为 v2，再报告“按上次那句话试过了”，正式关系无法确定反馈针对 v1；共同 action_agreement 也没有可用的 exercise 根。保存一段描述文字不能替代确切版本关系。

**最小修正：**回访冻结可空的源记录版本，配对会话、主体及练习归属；获准共同约定的私人回访则引用相应授权快照。

**不修的影响：**行动效果与版本可能错配，回访、复盘及来源擦除依赖缺少精确关系。

## 已有覆盖与未计入缺陷的事项

用户／监护／用途同意、四类会话隔离、SCQA 分量表及独立筛查、事件与人物、多实例练习与确认、分享撤回、七维状态及反证、方法发布、预约／接管、异步通知、资料请求与保留例外，都有具体表或结构化字段落点。上述结论表示主干已表达，不表示每条生命周期都正确，9 个问题仍需修正。

邀请卡拒绝状态的投影、非紧急专业复核如何复用工作流、连续多次专业服务的产品边界暂不计为确定缺陷。旧图中的 Your turn／同时在线、未确认的支付／RTC／录音归档也不作为必补范围。

## 验证与边界

- 本次重跑既有设计检查：269 个 JSON 例、318 个关系／状态例，共 587 项通过。
- 五份 SQL 草案离线检查仍通过，分别拒绝 19／24／38／52／71 个既有破坏版本；这没有捕获上述 1、2 两项阶段范围冲突。
- 契约子 agent 重跑政策哈希测试 8/8 通过，未发现该模块的确定缺陷。
- 主 agent 交叉复验了 1、2 的草案谓词冲突，以及 4、5、6、8 的 JSON／语义反例。3、7、9 通过业务依据、字段完整列表和历史状态路径审查确认，不冒充数据库运行测试。
- [本地复现脚本](../.data/database-independent-review-2026-11-17/reproduce.py) 仅加载 JSON、读取草案文字并调用纯语义函数；不导入应用或环境配置，不连接数据库，不执行 SQL。可运行：`uv run .data/database-independent-review-2026-11-17/reproduce.py`。

本轮只新增审查报告和本地复现材料，没有修改正式设计、字段字典、SQL、业务代码或正式测试，也没有执行迁移。未检查真实数据、并发锁、查询执行计划、RLS 实际隔离、原生运行层或专业有效性；完整微信历史仍未导出，本轮未打开微信。

审查意见：先修 1–3，再将 4–9 对应关系和真实契约反例补入设计及联动检查；不能仅增加更多自洽示例便认为缺口已经消失。
