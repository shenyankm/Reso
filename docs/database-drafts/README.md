# Wang 数据库扩展草案

2026-11-17。这里只放可审阅的 SQL 和范围清单，不在 `server/migrations`，API/Worker 不会加载。**没有执行迁移、建表、回填或切换应用读写。** 完整目标见 [V2.3 设计](../database-design-v2.md)。

## 当前累计 M4：研究资料和决策评测

[M4 完整累计 SQL](wang-m4.sql)及[范围/约束清单](wang-m4.json)覆盖四阶段的全部目标扩展结构：**55 张新表、17 张既有表增加 148 列**，共 913 个列定义、288 个外键（120 个复合）、102 条显式查询/部分唯一索引和 2 条预约排他约束。没有剩余的跨阶段悬空列/FK。完整字段模型有 76 张目标表、919 条字段条目、268 处引用注解；其余 4 张旧表仍按原退役/历史保留计划处理，不删除原数据。

M4 相对 M3 增加 research_participants、research_sessions、corpus_assets、corpus_asset_sources、decision_cases、decision_case_sources、dataset_versions、dataset_assignments、dataset_items、evaluation_runs、evaluation_results、evaluation_reviews 、research_session_participants、corpus_asset_participants 共 14 张表、132 列，并补入此前延后的 5 个研究主体/访谈/请求字段。M1a/M1/M2/M3/M4 是同一 0001–0007 基线的**五份替代审阅草案，不能连续执行**。

这次复查还补齐 7 个业务字段：外部研究请求者独立引用、素材/案例的完整来源摘要、数据集真实批准时间、评测及模型评审的实际供应商、评测汇总的独立版本。新增 5 个复合关系：研究同意与本人访谈、反事实父案同分组、案例审核人/评测专家与本人凭据、素材与确切文件摘要。原说明中的脱敏状态 `approved` 已统一为实际枚举 `reviewed`。

研究主体与应用账号分开；当前外部研究授权仅支持经核验文件，不把一个 app 账号的点击当成匿名受访对象同意。`requester_participant_id` 表示外部请求者，`participant_id/corpus_asset_id` 表示目标，两者分别核权。素材与案例须锁根和完整来源图后冻结摘要；父案的所有资料也纳入授权、脱敏和分组闭包。来源撤回、后来发现家庭/复访关联都会使相关发布独立性失效，不能靠旧 manifest 哈希继续使用。

每个 dataset 的同一 group 只有一个 split；评测结果只能引用该 run 的 dataset 成员。rule/model/expert 身份分开，模型评审保留供应商，不冒充独立专家；评审修订通过含 NULL 身份的唯一约束追加，已标安全失败不能记为 pass。评测汇总 v2 按 rule/model/expert、供应商、模型和 rubric 分桶，仅取最新有效评审修订；case 与执行 sample 分开计数，未评分不补零，根平均分固定 NULL，安全失败单列。旧汇总 v1 冻结只读。新增 `agent_policy_rules.skill_codes`、`evaluation_reviews.scores_schema_version/authorization_failure`，规则及路由新写使用 schema 2，评分对象保留原始量纲和权重；汇总按 score_scale 再分桶，安全和授权硬性失败分别记录，不能被高分抵消。所有 55 张新表继续强制 RLS、没有放行策略；评测工具隔离、真实授权/审核、图遍历/发布冻结、撤回传播及原生 API/Worker 尚未接通。

**没有导入录音/书籍/个案、没有创建批准政策或专家记录，没有执行任何 SQL、安装扩展或运行这些原生表的模型评测。** 表结构支持记录“时长未知/材料声称/媒体核验”的区别，不据附件数量认证“20 小时”。

## 累计 M3：人物、专业支持、预约和通知

[M3 累计 SQL](wang-m3.sql)及[范围/约束清单](wang-m3.json)以原 0001–0007 为基线，包含 M1/M2。五份草案均为**替代审阅版本，不能连续执行**；没有纳入正式迁移、安装扩展或切换读写。

相对 M2，增加 people、person_events、saved_items、service_slots、appointments、appointment_proposals、notification_outbox、notification_attempts、notification_receipts、retention_holds 共 10 张新表、134 列；consultants/applications/consultation_notes 增 21 列，并补 understandings.subject_person_id 和 record_versions.note_application_id。累计为 **41 张新表、17 张既有表 148 个新增列**，共 776 个列定义、249 个外键（108 个复合）、83 条显式查询/部分唯一索引，以及 2 条预约排他约束。完整目标模型现为 76 张表、919 条字段条目，现有 120 个结构化复合关系；此 M3 版本剩余 5 个研究字段/外键留待 M4。

此次补齐 10 个复合关系：人物归属、申请来源的事件与本人、专业纪要与申请会话、接管通知的会话/资源/实际接收人、资料请求通知上下文，以及回执的供应商/派发/请求键和消息键。matched 回执才关联 attempt，至少一个通道键有值；若两个键都有值，两个复合 FK 均须指向同一真实派发。pending/rejected 不关联派发、不参与送达聚合。

预约提议保留各自的决定人、时间、原因和版本；每预约最多一个 pending，决定者不能接受自己提出的时间。咨询方和申请人的已确认 `[start,end)` 区间分别排他，已完成/no_show 的历史事实继续占据原区间，取消不抹历史。草案仅声明 [PostgreSQL 17 btree_gist](https://www.postgresql.org/docs/17/btree-gist.html) 依赖和排他语法，没有安装或验证扩展。未核清的旧时间仍不能被包装成“新表无冲突就可预约”。

旧目录的新版核验/地区/语言、旧纪要签署状态、旧申请最后更新时间均保持未知；费用文字不转换成猜测币种，旧 verified_at 不等于新版资质审核。修正原目标语言数组的 SQL 默认值写法，并检查数组默认值不得包含列标识符。旧列、约束、内容和已知时间原样保留；仍未做回填、预约事务、通知发送/验签、专业审核或真实接管。所有 41 张新表继续强制 RLS 且无放行策略。

## 累计 M2：方法、测评、交互和练习结构

[M2 累计 SQL](wang-m2.sql)及[范围、过渡差异和行约束清单](wang-m2.json)以原 0001–0007 为同一基线，包含 M1。M1a、M1、M2 是逐步完善的**替代审阅版本，不能连续执行**；它们都不是应用可加载的迁移。

| 本次相对 M1 的补全 | 内容 |
| --- | --- |
| 11 张新表 | message_cards、interaction_events、assessment_versions、assessment_sessions、assessment_submissions、agent_method_refs、knowledge_sources、method_versions、method_sources、knowledge_releases、knowledge_release_items，共 155 列 |
| 4 张既有表扩展 | agent_actions、exercises、invites、followups 增加 41 列；M1 的 messages.exercise_id 和 agent_runs.knowledge_release_id 同时补入 |
| 解开 8 处 M1 延后依赖 | 练习父版本／消息、答卷来源、最近交互、工具确认、资料请求和知识发布的原生引用配对；其中 6 列属于 M1 新表 |
| 11 个新增复合关系 | 练习/回访的事件及 owner、回访练习、答卷主体/替代答卷/发现、消息练习、建议保存版本、方法审核人与资质主体 |
| 方法完整来源冻结 | method_versions.sources_sha256 记录批准时的完整 method_sources 清单摘要；正文与来源清单分别冻结，不能批准后换来源；当前许可仍须实时复验 |

累计 M2 为 **31 张新表、14 张既有表增加 126 列**，共 619 个列定义、204 个外键（90 个复合）、61 个查询/部分唯一索引。完整目标模型现为 76 张表、919 条字段条目和 120 个结构化复合关系；此 M2 版本的 7 个跨期字段/外键成对延后。所有 31 张新表均启用并强制 RLS，没有放行策略或角色授权。

卡片按类型使用真实互斥目标；交互只指向卡片、运行、练习、答卷之一。已采用方法限于 eligible，检索命中不等于采用；已应用的方法建议必须关联真实开始的练习和交互，不能写成已保存正文；记录建议则关联实际保存版本。SQL 只约束当前行和归属，实际本人操作、安全/意愿复验、JSON 完整 schema、方法/来源资格及原子写入仍待事务实现。

旧数据不凭默认值猜测：旧 proposal 的原生 schema_version、旧练习 ID/类型/状态/创建时间/时间来源、旧邀请送达状态都先 NULL，具体列见 `expand_nullable/expand_default_overrides`。保留旧 exercises 的 event_id 主键、旧动作状态和 slot 约束；在回填、旧调用方适配及主键切换前，**仍不能使用同事件多实例练习**。新原生记录必须显式提供完整字段，不能借过渡 NULL 绕过校验。新字段的计数/版本默认值只表示新计数器，不伪装历史业务事实。

审核角色、原生事务、来源撤权/擦除传播、发布冻结、回填/切换、应用读写及专业审核仍未完成。没有导入问卷、方法正文、Wang 的规则编号、批准材料或真实服务资源种子。

## M1：身份、分域、安全和决策结构

[完整 M1 结构草案](wang-m1.sql)和[范围/延后清单](wang-m1.json)在原 0001–0007 上累计覆盖 M1 的结构。它包括前一版 M1a，**两份是替代审阅版本，不是可连续执行的迁移**。正式实施仍须拆成小步骤，不能把本文件当一条大迁移直接上生产。

| 范围 | 对象 | 承担什么 |
| --- | --- | --- |
| 20 张新表 | policy_versions、guardian_links、consent_grants、conversations、record_versions、record_sources、agent_policy_rules、conversation_states、agent_decisions、agent_decision_rule_matches、agent_tool_calls、professional_credentials、safety_cases、support_handoffs、support_resources、staff_assignments、audit_events、data_requests、data_request_items、file_objects | 身份/同意、独立会话、真实来源、规则/状态/工具、持续风险和处理职责、资料请求 |
| 10 张既有表增列 | profiles、events、members、messages、understandings、understanding_confirmations、share_snapshots、share_grants、agent_runs、revisions，共 79 列 | 增加归属、版本、代次、授权及来源指针，保持旧调用兼容 |
| 补完整父唯一键 | applications 的 `(id,event_id,applicant_id)` 及各原生复合 FK 的父键 | 单列 ID 合法不能代替同申请人/会话/版本的配对 |
| 延后 15 列及外键 | 练习、答卷、交互、知识发布、人物、专业纪要、研究对象的后续依赖 | 目标表或其原生归属未建成，不先留下无完整约束的 UUID |
| 延后旧列/约束改动 | owner 删除策略、domain 与理解来源的 NOT NULL/唯一约束 | 原生鉴权、来源和擦除流程未接通前，不先解除旧边界 |

新表 330 列，加上既有表新增 79 列，共 409 个列定义；123 个外键中有 47 个复合外键，另有 37 个查询/部分唯一索引。目标模型现共 76 张表、919 条字段条目和 120 个结构化复合关系；本草案只覆盖其中 M1 的当前可建立结构。

## 这次复查补实的关系

- 审核/处理角色的资质属于同一人；监护同意的主体、关系和实际决定人配对。监护关系有效性、资质类型及期限仍须按政策复验。
- 安全案件的原始消息/决策、接管的案件属于同一会话；披露快照及授权对应具体接收人。
- 接收、接受、关闭分别保存真实审计 FK。审计必须同会话、同 `support_handoff` 资源、正确状态/版本及实际接收者；`service` 的通知回执不能冒充真人确认。外部接收者仍需真实通道认证，未接通不宣称已接管。
- 记录、具体版本、理解确认、分享快照与资料请求的对象/事件/会话配对；成员历史起点至少锁定同一事件，room 类型、当前成员和历史边界继续由事务复验。

整体模型及字段字典已同步这些关系；SQL 的父唯一键来自真实列，不引用仅在部分索引中唯一的集合。循环回指中的 run.final_decision、state.last_decision、understanding.current_version 使用可延后到提交的外键，其余相应关系立即检查。

## 新旧结构与未开放能力

新表均启用并强制 RLS，未定义放行策略或授予应用角色权限。目标是先拒绝原生读写；这不是已经交付角色策略、可信事务上下文或连接池复位验证。新的审计表也未向普通运行角色开放 UPDATE/DELETE。

旧表仅增加列，不 UPDATE 原记录、不删除原列/约束。未回填的 conversation_id、permissions 保持 NULL；旧消息是否为假设、旧理解属于何种 kind 也不凭默认值推断。它们与最终字段模型的差异以清单中的 `expand_nullable`、`expand_default_overrides` 明确列出。旧接口、旧 JSON、旧 domain 与旧分享授权继续由兼容层解释；新原生记录不能借这些过渡 NULL 绕过完整校验。

本批限制原生同意为 account/event；记录版本只接理解，来源只接消息/已保存版本/快照，资料请求只处理本期真实存在的用户业务目标。研究、练习、答卷、专业纪要等依赖不能因完整目标字典已有 kind 就提前开放。完整专业会话与申请关系已预留，但不因此开通专业服务。

不生成批准政策、R 编号、专业凭据、地区联系人或风险阈值种子。以下仍须实现和验证：

1. 政策/规则 JCS 摘要与审核身份一致性已有[离线校验及确切投影约定](../wang-database-foundation-2026-11-16.md)，尚未接入原生数据库事务。审核权限、锁定完整子集、批准后冻结、恰好一个 selected 规则及路由/普通列/命中记录一致仍待落实。
2. 当前同意、来源资格、安全案件分配/解除、双版本 CAS、撤权和擦除传播、JSON 完整版本/大小校验。
3. 接管审计的操作者/资源/动作/版本和外部身份认证；只填时间或收到投递回执不足以改变接管事实。
4. 角色最小表权限、RLS 放行策略及连接池上下文；协调删除、回填映射与原文/状态核对。
5. API/Worker/客户端的原生读写、分页/SSE、删除/导出及 M2 方法/发布/交互子集。未完成前不切流。

## 离线检查及验证边界

```sh
uv run scripts/check-database-design.py
uv run scripts/check-database-draft.py --self-test
```

两份检查脚本共享严格 JSON 读取，拒绝重复原始键、NaN/Infinity 和溢出浮点数，不静默覆盖字段；该输入边界有正反自检。

第二个脚本使用固定版 PostgreSQL 17 语法解析器 `pglast`，同时检查五份审阅版本。它不读取 `.env`、不导入应用、不启动容器、不连接数据库、不执行 SQL；该依赖仅用于检查脚本，没有加入应用 package.json。

检查按原迁移和字段模型重建静态列/候选键目录，验证覆盖范围、类型/默认值、JSON 容器、回填前可空性、完整父唯一键、同域/同政策外键、延后关系和新表默认拒绝。M1a/M1/M2/M3/M4 分别拒绝 19/28/48/62/86 个故意破坏版本。M2/M3/M4 还比对清单中的关键行约束及邀请幂等谓词，覆盖错误主体/资质/会话、旧值伪装 native v2/active/sent、混合交互目标、禁用卡片互斥、采用被阻止的方法和缺失来源摘要等。

M3 额外核对扩展白名单、预约排他表达式/区间边界、pending 唯一、双键回执及旧目录默认值；包含一次错误模型默认值的破坏检查。

M4 再检查全部目标列、研究同意/请求者/文件/凭据/分组配对、评测成员资格、模型/专家区分、安全失败和含 NULL 的评审修订唯一性。所有正反例都是合成设计例，不是实际授权、专家批准或模型效果。

这些检查不证明锁等待、现有数据能通过约束、回填正确、SQL CHECK 的运行效果、RLS 实际隔离、真实接收者或专业有效性；没有执行升级、回退、并发或实体机验收。执行用户明确允许的迁移前，应完成后续职责/事务实现与隔离库验证，再把经审核的小步骤纳入正式迁移目录。

## M1a：保留的首批审阅版本

[M1a SQL](wang-m1a.sql)及[范围清单](wang-m1a.json)保留前一轮 8 张新表、2 张既有表 18 个新增列的审阅范围。它与累计 M1 使用相同基线，不是 M1 的前置执行文件，不重复应用。


## V2.3 九项审查修订

[修复台账](../database-nine-fixes-2026-11-17.md)按原审查 1–9 编号记录字段、契约和反例。当前草案统一记录正文/请求范围；M1/M2/M3/M4 分别核验 7/12/13/15 个合法阶段分支，并拒绝任何再次相交收窄的旧 CHECK。签署事实按版本、研究通话按全部实际主体、回访按确切行动/获准快照绑定。新增 action_followup 用途只允许同事件、经共同确认的房间行动约定→获准本人的 private，不改变 personal_context 的长期记忆边界。

M2+ 新写使用答案/推荐卡 schema 2，资料请求在 M1+ 使用 payload schema 2；旧 V1 明确只读，不改历史。所有不可变来源、资质/服务核权、全体确认、撤回失效传播仍须未来事务落实，SQL CHECK 不冒充这些运行保障。
