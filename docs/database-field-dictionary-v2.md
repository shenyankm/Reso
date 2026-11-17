# Reso V2.3 数据库字段字典（目标设计）

初稿：2026-11-16；更新：2026-11-17。配套[数据库目标设计](database-design-v2.md)与[JSON 契约](database-json-contracts-v2.json)。**未执行迁移。**

由 [database-model-v2.json](database-model-v2.json) 生成；修改模型后运行 `uv run scripts/check-database-design.py --write`，再去掉 `--write` 复查。

字段表列新增／改变／显式保留契约的列；其余沿用 0001–0007，不是最终总列数。可空性指目标状态；回填期可空另见主设计。新增表列出完整业务字段。

类型使用 PostgreSQL；默认值为设计值，SQL 实现时需加正确引号和类型。所有 JSONB 绑定 schema；SQL NULL 与 JSON null 不等同。表内“约束”同时列出数据库约束和必须在事务内复验的业务规则，不把跨表检查写作 CHECK。

M1＝分域／身份／版本／安全与 Agent；M2＝测评／卡片／练习／方法；M3＝人物／服务／通知；M4＝研究评测。后期目标 FK 延迟到该阶段上线。

## 目标清单

| 表 | 处理 | 阶段 | 用途 |
| --- | --- | --- | --- |
| [profiles](#profiles) | 扩展 | M1 | 账户附加资料与授权失效版本；不以这里的展示角色授予专业权限。 |
| [policy_versions](#policy_versions) | 新增 | M1 | 保存已审政策、筛查规则、阶段／路由配置和留存规则的不可变版本。 |
| [guardian_links](#guardian_links) | 新增 | M1 | 监护或协助关系的验证记录；关系本身不授予读取私人内容的权限。 |
| [consent_grants](#consent_grants) | 新增 | M1 | 每次明确同意独立成一条，撤回后重新同意新增一条；与业务分享授权分开。 |
| [events](#events) | 扩展 | M1 | 事件只承载共同主题与生命周期；私人摘要、测评和各人状态迁往自己的会话。 |
| [conversations](#conversations) | 新增 | M1 | 同一事件下分别建立 intake、private、room、professional 会话，隔离输入、更新版本和模型上下文。 |
| [members](#members) | 扩展 | M1 | 沿用事件受邀成员关系；原所有者仍由 events.owner_id 表示，不重复插入 owner 行。 |
| [people](#people) | 新增 | M3 | 每个人自己的关系人记录，可关联已注册账号，也可只记录提及但未加入的人。 |
| [person_events](#person_events) | 新增 | M3 | 私人关系人和可见事件关联，用于人物详情及按人查找。 |
| [saved_items](#saved_items) | 新增 | M3 | 私人收藏理解或外部音乐；纸条复用 private_note 理解记录，不新增发信系统。 |
| [messages](#messages) | 扩展 | M1 | 原消息 ID 和内容保留；conversation_id 成为新的权限与分页主键。 |
| [message_cards](#message_cards) | 新增 | M2 | 统一聊天卡片实例，保存展示快照和状态；业务表仍是执行事实来源。 |
| [interaction_events](#interaction_events) | 新增 | M2 | 用户真实操作、拒绝和评价的提交记录；不把模型建议当本人操作。 |
| [agent_actions](#agent_actions) | 扩展 | M2 | Agent 的待确认建议：推荐练习与保存记录分别执行；建议、实际交互、练习及正文版本不混为一条事实。 |
| [assessment_versions](#assessment_versions) | 新增 | M2 | 题本、选项、领域映射、算法和正式可用性共同封版；初期不把每道固定题单独建表。 |
| [assessment_sessions](#assessment_sessions) | 新增 | M2 | 一次独立作答，支持多次测评，草稿与正式提交分开。 |
| [assessment_submissions](#assessment_submissions) | 新增 | M2 | 完整提交的不可变题文／答案／计分快照与分析状态；避免升级后旧结果漂移。 |
| [understandings](#understandings) | 扩展 | M1 | 复用为事实／感受／需要／推测／摘要／小发现／共识差异／私人纸条的记录根。 |
| [exercises](#exercises) | 重构 | M2 | 把事件一份练习改为多实例；叙事、表达、排练共用实例与版本机制。 |
| [record_versions](#record_versions) | 新增 | M1 | 统一理解、练习和专业纪要的不可变正文版本；有限三个父类型，均有真实外键。 |
| [record_sources](#record_sources) | 新增 | M1 | 记录精确来源，既用于解释和纠错，也用于撤回／删除后定位受影响派生物。 |
| [understanding_confirmations](#understanding_confirmations) | 扩展 | M1 | 继续逐人、逐版本记录认可或反对，不存可漂移的共同确认布尔值。 |
| [share_snapshots](#share_snapshots) | 重构 | M1 | 统一固定版本的摘要、练习成果和已开放纪要快照，替代各处复制正文。 |
| [share_grants](#share_grants) | 扩展 | M1 | 授权绑定接收人、目标会话、用途、权限和成员代次；仍使用固定快照。 |
| [invites](#invites) | 扩展 | M2 | 邀请只授予受邀房间资格，摘要授权另在接受事务生成。 |
| [agent_policy_rules](#agent_policy_rules) | 新增 | M1 | Wang 情境规则的冻结条目：判断条件、Skill、工具许可、禁止行为和回复要求；不把路由、方法与产品能力混为一类。 |
| [conversation_states](#conversation_states) | 新增 | M1 | 语义阶段及可回退长期状态，与 Worker 执行 checkpoint 分开。 |
| [agent_runs](#agent_runs) | 扩展 | M1 | 保留实际执行尝试、checkpoint 和旧 assessment；增加可复现的上下文和版本依据。 |
| [agent_decisions](#agent_decisions) | 新增 | M1 | 一次运行中的不可变判断与路由快照，可多步，不为每种 Prompt 建独立 Agent 表。 |
| [agent_decision_rule_matches](#agent_decision_rule_matches) | 新增 | M1 | 实际评估及命中规则的记录，区分匹配、选中、硬闸阻断与被更高优先级抑制。 |
| [agent_tool_calls](#agent_tool_calls) | 新增 | M1 | 工具执行及来源最少快照，区别提议、尝试和成功。 |
| [agent_method_refs](#agent_method_refs) | 新增 | M2 | 记录检索到和实际采用的方法版本，支持知识依据审查。 |
| [knowledge_sources](#knowledge_sources) | 新增 | M2 | 每行对应一个确切来源版本及许可状态，不把书单当已入库内容。 |
| [method_versions](#method_versions) | 新增 | M2 | 方法稳定 key 与不可变版本合一；覆盖 11 组方法／规范，不另建 11 套表。 |
| [method_sources](#method_sources) | 新增 | M2 | 方法卡到确切资料版本的引用依据。 |
| [knowledge_releases](#knowledge_releases) | 新增 | M2 | 一次可用方法集合的封版；用于复现当时能检索到什么。 |
| [knowledge_release_items](#knowledge_release_items) | 新增 | M2 | 知识发布的实际方法清单，保留外键完整性。 |
| [consultants](#consultants) | 扩展 | M3 | 服务目录继续使用当前表；展示资料、核验凭证与具体预约分开。 |
| [professional_credentials](#professional_credentials) | 新增 | M1 | 独立的专业／审核资质凭证；既可用于咨询人员，也可用于方法和案例审核人员。 |
| [service_slots](#service_slots) | 新增 | M3 | 服务方明确开放的可预约时段；非已确认预约。 |
| [appointments](#appointments) | 新增 | M3 | 一次申请的真实时间约定，保留现有双方确认流程并增加冲突约束。 |
| [appointment_proposals](#appointment_proposals) | 新增 | M3 | 每次时间提议、决定者及结论单列保留，拒绝／再次提议不覆盖历史。 |
| [applications](#applications) | 扩展 | M3 | 申请仍是服务关系根；不让房间成员资格自动变成咨询资料授权。 |
| [consultation_notes](#consultation_notes) | 扩展 | M3 | 保留每申请一个纪要根，正文和可见性按 record_versions 冻结。 |
| [followups](#followups) | 扩展 | M2 | 延用私人回访，补足实际行动结果与自愿提醒条件。 |
| [notification_outbox](#notification_outbox) | 新增 | M3 | 事务性通知请求，投递交给现有 pg-boss；不是又建一个队列系统。 |
| [notification_attempts](#notification_attempts) | 新增 | M3 | 每次真实通道派发及幂等键、供应商、结果；传输重试复用同一次派发。 |
| [notification_receipts](#notification_receipts) | 新增 | M3 | 每个经验签回执单独保存；提前、重复、乱序回执可关联与去重。 |
| [safety_cases](#safety_cases) | 新增 | M1 | 持久风险处理状态；软件优先级不是临床诊断，阈值由经审政策决定。 |
| [support_handoffs](#support_handoffs) | 新增 | M1 | 真实转介每次尝试及接收确认，与普通咨询申请分开。 |
| [support_resources](#support_resources) | 新增 | M1 | 核验过的地区支持资源版本；不预填未经本轮确认的电话号码或承诺。 |
| [staff_assignments](#staff_assignments) | 新增 | M1 | 有限职责授予，不建设通用权限表达式或角色继承平台。 |
| [audit_events](#audit_events) | 新增 | M1 | 跨事件的去内容操作审计，覆盖敏感读取、授权、审核、接管、配置和状态变更。 |
| [data_requests](#data_requests) | 新增 | M1 | 本人／合法代表的导出、纠正和删除请求及可核验处理结果。 |
| [data_request_items](#data_request_items) | 新增 | M1 | 追踪数据库、文件、供应商和备份各处的实际清理／导出结果。 |
| [retention_holds](#retention_holds) | 新增 | M3 | 仅登记有具体政策依据的受控保留例外，不在事件正文上做无限期软删除。 |
| [file_objects](#file_objects) | 新增 | M1 | 文件内容留在受控对象存储，数据库存元数据、用途、摘要和清理状态。 |
| [research_participants](#research_participants) | 新增 | M4 | 独立研究参与者及防泄漏分组；不要求有产品账号，也不保存真实姓名／电话。 |
| [research_sessions](#research_sessions) | 新增 | M4 | 一次真实访谈，与参与者人数、文件份数和时长分开计数。 |
| [research_session_participants](#research_session_participants) | 新增 | M4 | 一次研究通话的完整实际主体清单；授权与撤回按全部主体核对，通话根和时长不重复。 |
| [corpus_assets](#corpus_assets) | 新增 | M4 | 一次访谈的原文件／转写／脱敏版本及生成来源。 |
| [corpus_asset_participants](#corpus_asset_participants) | 新增 | M4 | 每个确切 session 素材版本的冻结主体/角色/主对象清单；重建历史摘要和反向撤回不依赖通话当前清单。 |
| [corpus_asset_sources](#corpus_asset_sources) | 新增 | M4 | 素材的多对多来源边，支持跨访谈汇编和反向撤回。 |
| [decision_cases](#decision_cases) | 新增 | M4 | 不可变的场景题版本，区分真实观察、改写、反事实和纯合成。 |
| [decision_case_sources](#decision_case_sources) | 新增 | M4 | 案例版本的全部原始／脱敏资料定位，不再选一个主来源隐藏其他来源。 |
| [dataset_versions](#dataset_versions) | 新增 | M4 | 确定用途和版本的数据集发布，不将同意评测等同训练或公开展示。 |
| [dataset_assignments](#dataset_assignments) | 新增 | M4 | 每个版本中一个防泄漏组只分配到一个 split，防复访和改写漏进留出集。 |
| [dataset_items](#dataset_items) | 新增 | M4 | 数据集绑定确切案例版本和既定分组，不重复复制题目。 |
| [evaluation_runs](#evaluation_runs) | 新增 | M4 | 一次可复现离线评测任务，记录版本和运行限制。 |
| [evaluation_results](#evaluation_results) | 新增 | M4 | 每样本每次实际输出及硬检查；重跑不覆盖早先失败。 |
| [evaluation_reviews](#evaluation_reviews) | 新增 | M4 | 规则、模型评审和人工专家分别登记，不以同供应商自评代替专家。 |
| [revisions](#revisions) | 扩展 | M1 | 保留事件内正文修订和状态变化，不承担通用敏感访问审计。 |
| [questionnaires](#questionnaires) | 只读退役 | M2 | 迁往 assessment_sessions＋assessment_submissions；旧发现迁 intake 的 insight 记录，旧确认摘要仍只投影给原所有者。 |
| [perspectives](#perspectives) | 只读退役 | M1 | 迁 room 内 kind=feeling/need 的 understandings＋record_versions＋本人确认；不改变原说话人。 |
| [note_shares](#note_shares) | 只读退役 | M3 | 迁 source_record_version 为已开放纪要的 share_snapshots＋share_grants，保留旧固定正文与授权／撤回时间。 |
| [consent_records](#consent_records) | 历史保留 | M1 | 仅保留历史 local_test／legacy_import 台账，不转换为新正式同意，不再作为新准入事实。 |

## 01 身份、政策与同意

### profiles

**扩展 · M1。** 账户附加资料与授权失效版本；不以这里的展示角色授予专业权限。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `age_band_code` | `text` | 是 | 无 | 由年龄政策定义，unknown 不默认为成人 |
| `age_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `age_basis` | `text` | 是 | 无 | self_declared / verified，未知可空 |
| `age_checked_at` | `timestamptz` | 是 | 无 |  |
| `age_valid_until` | `timestamptz` | 是 | 无 |  |
| `country_code` | `char(2)` | 是 | 无 |  |
| `region_code` | `text` | 是 | 无 |  |
| `timezone` | `text` | 是 | 无 | 本人确认的 IANA 时区；未知不据此安排站外提醒 |
| `communication_preferences` | `jsonb` | 否 | {} | 语言、长短、希望倾听或建议等本人可改偏好，禁止诊断标签 JSON：`Preferences`（v1）。 |
| `preferences_schema_version` | `integer` | 否 | 1 |  |
| `consent_epoch` | `bigint` | 否 | 0 | 同意撤回、年龄资格变化时递增 |
| `account_state` | `text` | 否 | active | active / disabled / erasure_pending |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：沿用 user_id PK → user.id；age_policy_version 必须为年龄规则；consent_epoch≥0。

索引：account_state 按实际运营查询再加索引；不索引原始出生信息。

权限：仅本人；授权服务检查有效政策和 consent_epoch。

删除／留存：账户清理时删除；偏好与年龄信息不进入公共房间。

### policy_versions

**新增 · M1。** 保存已审政策、筛查规则、阶段／路由配置和留存规则的不可变版本。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `policy_key` | `text` | 否 | 无 |  |
| `version` | `integer` | 否 | 无 |  |
| `category` | `text` | 否 | 无 | terms/privacy/age/processing/screening/safety/agent/retention/research |
| `locale` | `text` | 否 | zh-CN |  |
| `region_scope` | `jsonb` | 否 | 无 |  JSON：`Regions`（v1）。 |
| `content` | `jsonb` | 否 | 无 | 经版本校验的文本、规则或代码清单；不保存凭据 JSON：`PolicyContent`（v1）。 |
| `content_sha256` | `char(64)` | 否 | 无 | 仅 content JSON 的 JCS UTF-8 SHA-256 小写十六进制；不含状态/审核字段，不代替政策根和子规则的事务冻结 |
| `schema_version` | `integer` | 否 | 1 |  |
| `status` | `text` | 否 | draft | draft / approved / published / retired |
| `effective_at` | `timestamptz` | 是 | 无 |  |
| `expires_at` | `timestamptz` | 是 | 无 |  |
| `reviewed_by` | `text` | 是 | 无 | → `user.id`。 |
| `reviewed_at` | `timestamptz` | 是 | 无 |  |
| `review_evidence_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `created_by` | `text` | 否 | 无 | → `user.id`。 |
| `created_at` | `timestamptz` | 否 | now() |  |
| `rules_sha256` | `char(64)` | 是 | 无 | native agent 政策批准/发布时必填；完整真实子行按 rule_code 的 UTF-16 顺序排序，再对 [{id,content_sha256}] 的 JCS UTF-8 求 SHA-256；非 agent 政策为空 |

约束：PK(id)；UNIQUE(policy_key,version)；version>0；expires_at>effective_at；发布须已审且内容哈希一致；已发布内容不得原地修改；agent 政策批准/发布时 rules_sha256 必须匹配完整子规则清单；锁政策根与全部规则，同事务冻结；已批准后子规则不可增删改；非 agent 政策不挂 agent_policy_rules。

索引：(policy_key,status,effective_at DESC)。

权限：普通服务只读可用政策；发布和审核限分配的审核人员。

删除／留存：被业务版本引用时 RESTRICT；退役不抹去历史，按不含私人正文的政策留存。

### guardian_links

**新增 · M1。** 监护或协助关系的验证记录；关系本身不授予读取私人内容的权限。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `subject_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `guardian_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `relationship_code` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | pending | pending / verified / rejected / revoked / expired |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `evidence_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `verified_by` | `text` | 是 | 无 | → `user.id`。 |
| `verified_at` | `timestamptz` | 是 | 无 |  |
| `expires_at` | `timestamptz` | 是 | 无 |  |
| `revoked_by` | `text` | 是 | 无 | → `user.id`。 |
| `revoked_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；subject≠guardian；验证人与关系当事人分开；verified 状态须有验证依据；同一对关系最多一个未关闭记录（部分唯一索引）。

索引：(subject_user_id,status)；(guardian_user_id,status)。

复合关系使用的完整唯一键：UNIQUE(subject_user_id,id)；UNIQUE(subject_user_id,guardian_user_id,id)。

权限：仅关系当事人的必要摘要及有验证职责者；不向房间输出证明文件。

删除／留存：撤回立即使依赖此关系的未来同意／操作失效并更新 consent_epoch；验证文件按期限清理。

### consent_grants

**新增 · M1。** 每次明确同意独立成一条，撤回后重新同意新增一条；与业务分享授权分开。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `subject_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `participant_id` | `uuid` | 是 | 无 | → `research_participants.id`。 |
| `purpose_code` | `text` | 否 | 无 | processing/model/asr/screening/research/evaluation/training/showcase 等经政策登记用途 |
| `scope_kind` | `text` | 否 | 无 | account / event / participant / research_session |
| `scope_event_id` | `uuid` | 是 | 无 | → `events.id`。 |
| `scope_research_session_id` | `uuid` | 是 | 无 | → `research_session_participants.research_session_id`。与 participant_id 复合引用实际通话主体关联；通话根由关联表真实 FK 保证，非仅匹配主要对象 |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `decision_source` | `text` | 否 | 无 | in_app / verified_document |
| `decided_by_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `recorded_by_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `guardian_link_id` | `uuid` | 是 | 无 | → `guardian_links.id`。 |
| `evidence_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `verification_status` | `text` | 否 | recorded | recorded / verified / rejected |
| `verified_by_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `verified_at` | `timestamptz` | 是 | 无 |  |
| `granted_at` | `timestamptz` | 否 | 无 |  |
| `expires_at` | `timestamptz` | 是 | 无 |  |
| `withdrawn_at` | `timestamptz` | 是 | 无 |  |
| `withdrawn_by_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `withdrawal_reason_code` | `text` | 是 | 无 |  |
| `supersedes_grant_id` | `uuid` | 是 | 无 | → `consent_grants.id`。 |
| `superseded_at` | `timestamptz` | 是 | 无 | 新版决定替代与本人主动撤回分开 |
| `request_id` | `uuid` | 否 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；subject_user_id、participant_id 恰一非空；scope_kind 与目标和主体类型匹配；研究 session 须属于该 participant；UNIQUE(recorded_by_user_id,request_id)；到期晚于授予；撤回时间与操作者配套；in_app 创建时必须有真实决策人，资料登记人不冒充同意人；外部文件未核验不得生效；研究用途逐主体核验当前政策/代表权限/期限；允许 participant 全局或该 research_session 范围。若已有该主体/用途/政策的 session 专门决定，优先采用未被同范围新决定取代的专门决定，撤回/过期/未核验不回退全局；session 失效优先阻断。恢复须新的明确 session 决定，不用旧宽范围覆盖局部撤回。。

索引：(subject_user_id,purpose_code,policy_version_id,scope_event_id,granted_at DESC)；(participant_id,purpose_code,scope_research_session_id)；WHERE withdrawn_at IS NULL 的候选索引，读取仍检查 expires_at。

组合外键 `fk_consent_guardian_subject`：(subject_user_id,guardian_link_id) → guardian_links(subject_user_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_consent_guardian_decider`：(subject_user_id,decided_by_user_id,guardian_link_id) → guardian_links(subject_user_id,guardian_user_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_consent_research_session`：(participant_id,scope_research_session_id) → research_session_participants(participant_id,research_session_id)；ON DELETE RESTRICT；即时检查。

权限：本人／有效代表；研究资料授权限相应工作人员。服务端每次按用途检查，不把任一同意当全用途许可。

删除／留存：撤回使依赖的处理／数据集发布失效，阻断新任务；历史决定仅按已审留存政策保留最少证据。


## 02 事件、会话与人物

### events

**扩展 · M1。** 事件只承载共同主题与生命周期；私人摘要、测评和各人状态迁往自己的会话。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `lifecycle_status` | `text` | 否 | active | active / paused / closed / erasure_pending |
| `lifecycle_version` | `bigint` | 否 | 0 |  |
| `closed_at` | `timestamptz` | 是 | 无 |  |
| `reopened_at` | `timestamptz` | 是 | 无 |  |
| `owner_id` | `text` | 是 | 无 | → `user.id`。创建时必须有发起人；擦除／匿名化后的共享主题可按批准政策置空，不自动移交给他人 |
| `erasure_requested_at` | `timestamptz` | 是 | 无 |  |

约束：沿用 id PK；closed 状态需 closed_at；原 title/summary/initial_summary/private_version 在切换期仅作原所有者兼容投影；owner 物理删除改 SET NULL，不级联删除其他成员的私人会话。

索引：(owner_id,lifecycle_status,updated_at DESC,id)；房间列表只按 room_updated_at 或房间会话时间排序。

权限：事件所有者管理公开生命周期；有效受邀者只见公开 room_title 和公开活动，不见私人字段。

删除／留存：先冻结并走删除流程；conversations.event_id 使用 RESTRICT，不让原所有者直接级联删掉其他成员私人空间；协调清理／保留后再决定是否移除主题。

### conversations

**新增 · M1。** 同一事件下分别建立 intake、private、room、professional 会话，隔离输入、更新版本和模型上下文。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `event_id` | `uuid` | 否 | 无 | → `events.id`。 |
| `kind` | `text` | 否 | 无 | intake / private / room / professional |
| `owner_user_id` | `text` | 是 | 无 | → `user.id`。room 必为空，其余为该私人空间／服务申请人 |
| `application_id` | `uuid` | 是 | 无 | → `applications.id`。仅 professional 非空 |
| `title` | `text` | 是 | 无 | 私人标签只给本会话所有者，room 使用 events.room_title |
| `status` | `text` | 否 | active | active / paused / closed / erasure_pending |
| `revision` | `bigint` | 否 | 0 | 本会话输入／记录变化即递增 |
| `permission_epoch` | `bigint` | 否 | 0 | 成员、分享、资格变化时递增 |
| `created_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(event_id,id)；CHECK kind 与 owner/application 的组合；room 每事件唯一；intake/private 每(event,kind,owner)唯一；professional 每 application 唯一；application 的 event/applicant 与会话用复合 FK 配对。

索引：(owner_user_id,kind,updated_at DESC,id)；(event_id,kind)。

复合关系使用的完整唯一键：UNIQUE(event_id,id)；UNIQUE(application_id,id)；UNIQUE(id,owner_user_id)。

组合外键 `fk_conversation_application`：(application_id,event_id,owner_user_id) → applications(id,event_id,applicant_id)；ON DELETE RESTRICT；即时检查。

权限：intake/private 仅各自所有者；room 按事件资格；professional 按申请归属及开放范围；事件所有者不自动拥有家长私人会话。

删除／留存：私有域可单独擦除；事件全局删除进入协调流程。删除会话级联本域消息和未被保留的派生记录。

### members

**扩展 · M1。** 沿用事件受邀成员关系；原所有者仍由 events.owner_id 表示，不重复插入 owner 行。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `membership_generation` | `bigint` | 否 | 1 | 每次重新加入递增 |
| `participant_role` | `text` | 否 | participant | 仅展示身份，不授予监护／专业权限 |
| `left_at` | `timestamptz` | 是 | 无 |  |
| `history_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `history_mode` | `text` | 是 | 无 | since_join / approved_history / legacy_full_history |
| `history_from_message_id` | `bigint` | 是 | 无 | → `messages.id`。可见历史起点，不是私聊引用 |

约束：沿用 PK(event_id,user_id)；generation>0；active 与 left_at 一致；起点消息须属同事件 room；旧数据 legacy 模式不伪造新的同意。

索引：沿用 members_active_user；索引(event_id,active,user_id)。

组合外键 `fk_member_history_event`：(event_id,history_from_message_id) → messages(event_id,id)；ON DELETE RESTRICT；即时检查。

权限：仅本人的加入状态和有权房间成员必要信息；重新加入不复活旧分享。

删除／留存：退出保留最少成员历史；相关访问授权撤回；本人私人记录保留按独立策略。

### people

**新增 · M3。** 每个人自己的关系人记录，可关联已注册账号，也可只记录提及但未加入的人。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `owner_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `linked_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `display_name` | `text` | 否 | 无 |  |
| `relationship_category` | `text` | 否 | other | family / friend / classmate / other，由本人选择 |
| `relationship_label` | `text` | 是 | 无 |  |
| `avatar_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `revision` | `integer` | 否 | 1 |  |
| `archived_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(owner_user_id,id)；已关联账号每 owner 最多一个有效人物记录；不得按姓名自动合并或绑定账号。

索引：(owner_user_id,archived_at,updated_at DESC)。

复合关系使用的完整唯一键：UNIQUE(owner_user_id,id)。

权限：仅本人；linked_user_id 不授予对方或家长读取。

删除／留存：本人删除时清理关系、收藏和派生私人关系理解；不能删除对方账号或公共消息。

### person_events

**新增 · M3。** 私人关系人和可见事件关联，用于人物详情及按人查找。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `owner_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `person_id` | `uuid` | 否 | 无 | → `people.id`。 |
| `event_id` | `uuid` | 否 | 无 | → `events.id`。 |
| `relationship_note` | `text` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(owner_user_id,person_id,event_id)；复合 FK(owner_user_id,person_id)→people(owner_user_id,id)；关联事件时仍校验本人可访问。

索引：(owner_user_id,event_id)。

组合外键 `fk_person_event_owner`：(owner_user_id,person_id) → people(owner_user_id,id)；ON DELETE RESTRICT；即时检查。

权限：仅 owner；不据此公开宣称对方参加了事件。

删除／留存：任一私人关系记录／事件删除时级联清理。

### saved_items

**新增 · M3。** 私人收藏理解或外部音乐；纸条复用 private_note 理解记录，不新增发信系统。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `owner_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `media_provider` | `text` | 是 | 无 |  |
| `external_media_id` | `text` | 是 | 无 |  |
| `external_url` | `text` | 是 | 无 |  |
| `display_metadata` | `jsonb` | 否 | 无 | 标题／作者／封面来源，非媒体文件 JSON：`DisplayMetadata`（v1）。 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；记录收藏与外部媒体恰一类；媒体需 provider/id/url；每 owner+record_version 或 owner+provider+external_id 唯一；URL 由服务端校验合法平台。

索引：(owner_user_id,created_at DESC,id)。

权限：仅本人；收藏不授予原记录读取权限，展示仍检查当前授权。

删除／留存：本人删除收藏即可；来源删除／撤权后不再显示旧私人正文，不缓存完整音乐。


## 03 消息、卡片与互动

### messages

**扩展 · M1。** 原消息 ID 和内容保留；conversation_id 成为新的权限与分页主键。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。回填完成后 NOT NULL |
| `content_kind` | `text` | 否 | text | text / system / card |
| `hypothetical` | `boolean` | 否 | false | 排练台词，不得当作他人真实表态 |
| `exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。 |
| `redacted_at` | `timestamptz` | 是 | 无 |  |
| `domain` | `text` | 是 | 无 | 兼容 private/room；intake/professional 为 SQL NULL；conversation_id 是权威归属 |
| `message_purpose` | `text` | 否 | chat | chat / private_hint / practice / system |
| `context_room_conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。仅 private_hint；同事件、本人仍有资格的 room；不授予读取其他私人域 |
| `context_room_message_id` | `bigint` | 是 | 无 | → `messages.id`。仅 private_hint；配对房间中本人可读历史范围内的真实消息 |

约束：沿用 id PK；UNIQUE(conversation_id,id)；FK(event_id,conversation_id)→conversations(event_id,id)；in_reply_to 同 conversation 复合 FK；context_room 两列同时空或同时非空；仅 message_purpose=private_hint 且本消息归属 private 时必填；普通消息两列均空；FK(context_room_conversation_id,context_room_message_id)→messages(conversation_id,id)；创建及发布前校验 room 与 private 同 event、本人有效成员代次及消息历史边界；提示作者须为 assistant；SSE、通知、列表均只发给 private owner；不得递归跟随私人提示向公共域取正文；domain 映射与 conversation.kind 一致；NULL 不走旧私聊回退；client_id 保持既有全局幂等。

索引：(conversation_id,id DESC)；UNIQUE(conversation_id,in_reply_to) 保留一次可见回复语义；(context_room_conversation_id,context_room_message_id) WHERE message_purpose=private_hint。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)；UNIQUE(event_id,id)。

组合外键 `fk_message_conversation`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_message_reply`：(conversation_id,in_reply_to) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_private_hint_context`：(context_room_conversation_id,context_room_message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_message_exercise`：(conversation_id,exercise_id) → exercises(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：按会话；原作者名快照也属于个人数据；intake 原始作答消息不得被 private Agent 查询。

删除／留存：普通内容按会话清除；已发布公共内容与授权撤回分别处理，不承诺撤回他人已读内容。

### message_cards

**新增 · M2。** 统一聊天卡片实例，保存展示快照和状态；业务表仍是执行事实来源。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `message_id` | `bigint` | 否 | 无 | → `messages.id`。 |
| `slot` | `smallint` | 否 | 0 |  |
| `card_type` | `text` | 否 | 无 | assessment / understanding / practice_recommendation / exercise / invite / professional / followup / safety / music；与 payload.type 一致 |
| `template_version` | `text` | 否 | 无 |  |
| `payload_schema_version` | `integer` | 否 | 2 |  |
| `payload` | `jsonb` | 否 | 无 | 封闭 v2；professional 的每个候选冻结 profile_version、服务资料快照和 specialties；无申请也能重放，旧 v1 保留原文不补造 JSON：`MessageCard`（v2）。 旧版本只读：1。 |
| `status` | `text` | 否 | pending | pending / active / resolved / skipped / expired / invalidated |
| `revision` | `integer` | 否 | 1 |  |
| `expires_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |
| `assessment_session_id` | `uuid` | 是 | 无 | → `assessment_sessions.id`。只允许本 card_type 对应目标；与会话/主体配对，未来阶段上线后建立 FK |
| `exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。只允许本 card_type 对应目标；与会话/主体配对，未来阶段上线后建立 FK |
| `understanding_id` | `uuid` | 是 | 无 | → `understandings.id`。只允许本 card_type 对应目标；与会话/主体配对，未来阶段上线后建立 FK |
| `invite_id` | `uuid` | 是 | 无 | → `invites.id`。只允许本 card_type 对应目标；与会话/主体配对，未来阶段上线后建立 FK |
| `application_id` | `uuid` | 是 | 无 | → `applications.id`。只允许本 card_type 对应目标；与会话/主体配对，未来阶段上线后建立 FK |
| `followup_id` | `uuid` | 是 | 无 | → `followups.id`。只允许本 card_type 对应目标；与会话/主体配对，未来阶段上线后建立 FK |

约束：PK(id)；UNIQUE(message_id,slot)；UNIQUE(conversation_id,id)；FK(conversation_id,message_id)→messages；payload 必须通过 type+schema_version 校验；原 safety 卡回填；assessment/understanding/exercise/invite/followup 分别且仅一个对应目标列非空；professional 可无目标作为推荐，有 application 时须本人具体申请；practice_recommendation/safety/music 目标列均空；payload.type=card_type；全部真目标与会话/主体配对；understanding payload.record_version_id 须属于 understanding_id 的展示版本；payload 中的候选 method/consultant IDs 仅展示，不赋权或执行；点击后统一核权并创建真实业务对象；invite 目标按 event 与 created_by/私人 owner 匹配，不错误要求 invite.target_conversation_id=卡片的 private 会话；有 application 的 professional 卡限本人 origin private 或该申请 professional，会话不向其他房间开放申请状态。

索引：(conversation_id,status,created_at DESC)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)；UNIQUE(message_id,id)。

组合外键 `fk_card_message`：(conversation_id,message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_card_assessment_session_id`：(conversation_id,assessment_session_id) → assessment_sessions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_card_exercise_id`：(conversation_id,exercise_id) → exercises(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_card_understanding_id`：(conversation_id,understanding_id) → understandings(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_card_followup_id`：(conversation_id,followup_id) → followups(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：按所属会话；不把 private 卡直接复用到 room，公开展示需新卡和获准快照。

删除／留存：随来源消息清除；已处理状态通过 interaction_events 追溯；快照正文纳入擦除。

### interaction_events

**新增 · M2。** 用户真实操作、拒绝和评价的提交记录；不把模型建议当本人操作。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `actor_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `card_id` | `uuid` | 是 | 无 | → `message_cards.id`。 |
| `agent_run_id` | `uuid` | 是 | 无 | → `agent_runs.id`。 |
| `exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。 |
| `action_code` | `text` | 否 | 无 | 与 payload.type 一致；正式反馈为 feedback，原 helpful/misunderstood/unsuitable 保留在 payload.rating，不另造 helpful/unhelpful 动作码 |
| `expected_revision` | `bigint` | 否 | 无 |  |
| `payload` | `jsonb` | 否 | 无 | 仅本人核对后提交的必要内容 JSON：`InteractionPayload`（v2）。 旧版本只读：1。 |
| `request_id` | `uuid` | 否 | 无 |  |
| `result_revision` | `bigint` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `assessment_session_id` | `uuid` | 是 | 无 | → `assessment_sessions.id`。问卷导航／作答／暂停／恢复／提交的唯一操作目标 |
| `payload_schema_version` | `integer` | 否 | 2 |  |

约束：PK(id)；card_id/agent_run_id/exercise_id/assessment_session_id 四个目标恰一非空；均以 conversation+目标复合 FK；不能用卡片 ID 代替问卷 session；UNIQUE(actor_user_id,request_id)；action_code 与目标类型、payload.type 匹配；expected_revision 对 card/exercise/session 是该根 revision；run_cancel 使用当前 conversation.revision 并核对被取消 run 的归属，不能把 run 输入 state_revision 当当前可变版本；与业务写入／版本递增同事务；同 ID 不同 payload 冲突；practice_start/practice_decline 目标必须是本人 private 的 practice_recommendation 卡；选择的方法确实属于卡片候选，server 复验方法/来源/风险；start 与创建/恢复 exercise、CAS、反馈同事务；拒绝不创建练习、不写正文、不共享。

索引：(conversation_id,created_at DESC,id)；各目标 ID 外键索引。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_interaction_card_id`：(conversation_id,card_id) → message_cards(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_interaction_agent_run_id`：(conversation_id,agent_run_id) → agent_runs(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_interaction_exercise_id`：(conversation_id,exercise_id) → exercises(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_interaction_assessment_session_id`：(conversation_id,assessment_session_id) → assessment_sessions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：本人和受权处理者；房间操作按成员身份；评价可脱敏汇总，不自动入训练。

删除／留存：操作正文按会话处理；审计只另存去内容的结果码。

### agent_actions

**扩展 · M2。** Agent 的待确认建议：推荐练习与保存记录分别执行；建议、实际交互、练习及正文版本不混为一条事实。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。目标状态必填；仅 expand/backfill 期间临时允许 NULL，核对归属后加 NOT NULL |
| `card_id` | `uuid` | 是 | 无 | → `message_cards.id`。 |
| `permission_epoch` | `bigint` | 是 | 无 |  |
| `subject_consent_epoch` | `bigint` | 是 | 无 |  |
| `proposal_schema_version` | `integer` | 否 | 2 |  |
| `applied_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `proposal` | `jsonb` | 否 | 无 | v2 含 method/summary/nvc/followup；method 只推荐方法，开始不自动保存或分享；v1 三种记录建议原样读取 JSON：`AgentProposal`（v2）。 旧版本只读：1。 |
| `decision_id` | `uuid` | 是 | 无 | → `agent_decisions.id`。native v2 建议必填且同 run；旧记录未知为空，不补造判断 |
| `method_version_id` | `uuid` | 是 | 无 | → `method_versions.id`。native method 建议必填；与提议 kind、方法 practice_kind 和实际检索依据配对 |
| `resolution_interaction_id` | `uuid` | 是 | 无 | → `interaction_events.id`。应用/拒绝的真实同会话本人交互；旧未知记录为空且不补造 |
| `started_exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。method 应用后创建或恢复的本人练习；开始不产生保存正文版本 |
| `method_tool_call_id` | `uuid` | 是 | 无 | → `agent_tool_calls.id`。native method 建议必填；与 method_version_id 配对确切检索结果，不能用别的 run 检索过作为依据 |

约束：保留 id、run/message/slot、proposal、status；FK conversation 与 run/message/card 同域；移除仅靠旧 event.private_version 的假设，发布与应用都检查新版本；仅允许按工具契约写入；现有 domain=private 约束继续保留；v2 method 与三种需确认记录建议分别执行；不得借 intake/room/professional 写其他人的 private；native method 必有关联方法版本；应用时再核实安全、意愿、方法/政策可用性、来源和 CAS；method 的 applied_record_version_id 为空；记录建议的 started_exercise_id 为空；dismissed/stale 不创建练习或版本；native method 的 method_tool_call_id/method_version_id 必须关联本 run 的真实 agent_method_refs，且 applicability=eligible；同 run 不是绕过方法适配的许可；card_id 非空时还须属于 action.message_id。

索引：(conversation_id,status,created_at DESC)；保留 message/slot 唯一。

组合外键 `fk_action_resolution`：(conversation_id,resolution_interaction_id) → interaction_events(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_started_practice`：(conversation_id,started_exercise_id) → exercises(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_decision`：(run_id,decision_id) → agent_decisions(run_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_run`：(conversation_id,run_id) → agent_runs(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_message`：(conversation_id,message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_card`：(conversation_id,card_id) → message_cards(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_method_tool_run`：(run_id,method_tool_call_id) → agent_tool_calls(run_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_method_retrieval`：(method_tool_call_id,method_version_id) → agent_method_refs(tool_call_id,method_version_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_card_message`：(message_id,card_id) → message_cards(message_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_action_applied_version`：(conversation_id,applied_record_version_id) → record_versions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：对应私人会话本人确认；共享域提议须另列允许的公共动作，不放开任意私写。

删除／留存：随会话清除；applied 后重试幂等，拒绝不产生业务写入。


## 04 测评与初步了解

### assessment_versions

**新增 · M2。** 题本、选项、领域映射、算法和正式可用性共同封版；初期不把每道固定题单独建表。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `instrument_code` | `text` | 否 | 无 | SCQA / 经审核后采用的筛查代码 |
| `questionnaire_version` | `text` | 否 | 无 |  |
| `scoring_version` | `text` | 否 | 无 |  |
| `locale` | `text` | 否 | zh-CN |  |
| `items` | `jsonb` | 否 | 无 | [{item_id,text,options:[{code,value,label}],required}] JSON：`AssessmentItems`（v1）。 |
| `scales` | `jsonb` | 否 | 无 | [{scale_id,domain,direction,item_ids,aggregation,display_precision}] JSON：`AssessmentScales`（v1）。 |
| `schema_version` | `integer` | 否 | 1 |  |
| `source_id` | `uuid` | 是 | 无 | → `knowledge_sources.id`。 |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `content_sha256` | `char(64)` | 否 | 无 |  |
| `status` | `text` | 否 | draft | draft / research_only / approved / retired |
| `reviewed_by` | `text` | 是 | 无 | → `user.id`。 |
| `reviewed_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(instrument_code,questionnaire_version,scoring_version,locale)；item/scale ID 唯一且映射存在；SCQA 明确 24 题／八均分／不合总分；approved 后不可改题文和算法。

索引：(instrument_code,status,locale)。

权限：公开已批准题文可读；原答卷另表私有；research_only 不因存在而允许真实筛查。

删除／留存：被历史答卷引用时 RESTRICT；许可失效停止新答卷，保留可追溯版本。

### assessment_sessions

**新增 · M2。** 一次独立作答，支持多次测评，草稿与正式提交分开。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `subject_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `assessment_version_id` | `uuid` | 否 | 无 | → `assessment_versions.id`。 |
| `status` | `text` | 否 | draft | draft / paused / submitted / cancelled；paused 仍是未提交草稿 |
| `draft_answers` | `jsonb` | 否 | {} | item_id→option_code/null，按冻结题本校验 JSON：`DraftAnswers`（v2）。 旧版本只读：1。 |
| `revision` | `bigint` | 否 | 0 |  |
| `replaces_session_id` | `uuid` | 是 | 无 | → `assessment_sessions.id`。 |
| `consent_grant_id` | `uuid` | 是 | 无 | → `consent_grants.id`。 |
| `started_at` | `timestamptz` | 是 | 无 |  |
| `time_provenance` | `text` | 否 | observed | observed / legacy_unknown |
| `submitted_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() | 仅数据库此行建立时间 |
| `updated_at` | `timestamptz` | 否 | now() |  |
| `current_item_id` | `text` | 是 | 无 | 当前实际展示题 ID；允许新建／旧导入未知时 NULL，非首个未答题的推算值 |
| `paused_at` | `timestamptz` | 是 | 无 | 最近一次实际暂停时间；旧未知保持 NULL |
| `resumed_at` | `timestamptz` | 是 | 无 | 最近一次实际恢复时间；旧未知保持 NULL |
| `last_interaction_at` | `timestamptz` | 是 | 无 | 最近题目导航／作答／暂停／恢复时间 |
| `answers_schema_version` | `integer` | 否 | 2 | 新写 v2 与题本 Code 一致；旧 v1 只读且不改写题号 |

约束：PK(id)；UNIQUE(conversation_id,id)；UNIQUE(id,assessment_version_id,conversation_id)供提交复合 FK；subject 与 intake 所有者一致；只能 intake；相同 user+instrument 的有效草稿策略在服务端串行处理；提交后不可修改原答卷，纠正创建新 session；current_item_id 和答案 key 属于冻结题本；paused 状态须 paused_at 且晚于上次 resumed_at（legacy_unknown 除外）；draft 在恢复后 resumed_at>=paused_at；两时间保留最近一次各自事件，完整历史在 interaction_events；导航／回答／暂停／恢复统一使用 revision CAS 并更新 last_interaction_at；只允许 draft/paused 写草稿，提交不可回退；同事务保存 interaction_events，不从答案推断游标。

索引：(subject_user_id,assessment_version_id,started_at DESC,id)；(conversation_id,status)。

复合关系使用的完整唯一键：UNIQUE(id,assessment_version_id,conversation_id)；UNIQUE(conversation_id,id)。

组合外键 `fk_assessment_subject`：(conversation_id,subject_user_id) → conversations(id,owner_user_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_assessment_replaces`：(conversation_id,replaces_session_id) → assessment_sessions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：仅本人及被分配且获准的初步了解流程；private/room/professional Agent 不直读。

删除／留存：按本人资料请求清理；必要的去内容审计不保存答案。

### assessment_submissions

**新增 · M2。** 完整提交的不可变题文／答案／计分快照与分析状态；避免升级后旧结果漂移。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `session_id` | `uuid` | 否 | 无 | → `assessment_sessions.id`。 |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `assessment_version_id` | `uuid` | 否 | 无 | → `assessment_versions.id`。 |
| `session_revision` | `bigint` | 否 | 无 |  |
| `answers` | `jsonb` | 否 | 无 |  JSON：`SubmittedAnswers`（v2）。 旧版本只读：1。 |
| `scores` | `jsonb` | 否 | 无 | 每 scale 保存 raw_sum、item_count、aggregation、item_ids；mean 由分子分母推导 JSON：`AssessmentScores`（v1）。 |
| `analysis_status` | `text` | 否 | pending | pending / running / complete / error / needs_review |
| `insight_understanding_id` | `uuid` | 是 | 无 | → `understandings.id`。 |
| `analysis_error_code` | `text` | 是 | 无 |  |
| `request_id` | `uuid` | 否 | 无 |  |
| `submitted_at` | `timestamptz` | 是 | 无 |  |
| `time_provenance` | `text` | 否 | observed | observed / legacy_unknown |
| `recorded_at` | `timestamptz` | 否 | now() | 导入时间不冒充原提交时间 |
| `answers_schema_version` | `integer` | 否 | 2 | 新写 v2 与题本 Code 一致；旧 v1 只读且不改写题号 |

约束：PK(id)；UNIQUE(conversation_id,id)；UNIQUE(session_id)；session/version/conversation 复合 FK 配对；observed 的新提交必须有真实 submitted_at；完整性、范围和映射在事务中按冻结定义校验；未知不补零；发现仍由 record_versions 本人核对。

索引：(conversation_id,submitted_at DESC)；(analysis_status,recorded_at) WHERE analysis_status IN pending/error。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_assessment_submission_session`：(session_id,assessment_version_id,conversation_id) → assessment_sessions(id,assessment_version_id,conversation_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_submission_insight`：(conversation_id,insight_understanding_id) → understandings(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：intake 域；往 private 转移仅经本人确认的发现摘要，原答案与原分数不跟随分享。

删除／留存：擦除原答卷时同步处理依赖发现、快照和评测引用；不能仅删除 session 根记录。


## 05 版本化记录、来源与授权

### understandings

**扩展 · M1。** 复用为事实／感受／需要／推测／摘要／小发现／共识差异／私人纸条的记录根。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `kind` | `text` | 否 | summary | fact / feeling / need / hypothesis / summary / insight / common_point / difference / action_agreement / private_note |
| `subject_person_id` | `uuid` | 是 | 无 | → `people.id`。 |
| `current_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `record_state` | `text` | 否 | active | active / superseded / invalidated / erased |
| `supersedes_id` | `uuid` | 是 | 无 | → `understandings.id`。 |
| `updated_at` | `timestamptz` | 否 | now() |  |
| `domain` | `text` | 是 | 无 | 兼容 private/room；intake/professional 为 NULL；新权限只看 conversation |
| `source_message_id` | `bigint` | 是 | 无 | → `messages.id`。旧界面的可空单来源投影；权威来源为 record_sources，取消旧一消息一理解唯一性 |
| `request_id` | `uuid` | 是 | 无 | 新写入请求幂等键；旧导入未知可空 |

约束：沿用 id PK；UNIQUE(conversation_id,id)；旧 content/provenance/version 过渡为当前版本投影；来源迁入 record_sources 后取消必须单消息来源限制；subject_person 仅私人记录且 owner 匹配；UNIQUE(conversation_id,request_id) WHERE request_id IS NOT NULL；废除旧(event_id,domain,source_message_id)唯一及 NOT NULL；兼容单来源投影若有须同会话，其他来源经 record_sources。

索引：(conversation_id,kind,updated_at DESC,id)；(subject_person_id,updated_at DESC)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_current_understanding_id`：(conversation_id,id,current_record_version_id) → record_versions(conversation_id,understanding_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_understanding_conversation`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

权限：按会话；private_note 永不自动进入模型或发送给关系人。

删除／留存：根记录清理级联版本／确认；擦除源后不能继续把派生记录当证据。

### exercises

**重构 · M2。** 把事件一份练习改为多实例；叙事、表达、排练共用实例与版本机制。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() | 新 PK，旧 event_id 保留为受约束的冗余字段 |
| `conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `owner_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `kind` | `text` | 否 | narrative | narrative / nvc / roleplay / 其他获准的方法工具 |
| `method_version_id` | `uuid` | 是 | 无 | → `method_versions.id`。旧原稿没有审核方法版本，保留 NULL |
| `status` | `text` | 否 | active | proposed / active / paused / completed / abandoned |
| `current_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `started_at` | `timestamptz` | 是 | 无 |  |
| `time_provenance` | `text` | 否 | observed | observed / legacy_unknown |
| `created_at` | `timestamptz` | 否 | now() |  |
| `completed_at` | `timestamptz` | 是 | 无 |  |
| `revision` | `bigint` | 否 | 0 | 练习内容/暂停/恢复/状态的目标根 CAS；旧 version 仅兼容正文版本投影 |

约束：PK 从 event_id 改为 id；UNIQUE(conversation_id,id)；owner 匹配 private 会话；当前 act/notes/story/practice_notes 只作原叙事实例兼容投影；不再 UNIQUE(event_id)。

索引：(conversation_id,kind,updated_at DESC,id)；(owner_user_id,status,updated_at DESC)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_current_exercise_id`：(conversation_id,id,current_record_version_id) → record_versions(conversation_id,exercise_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_exercise_event`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_exercise_owner`：(conversation_id,owner_user_id) → conversations(id,owner_user_id)；ON DELETE RESTRICT；即时检查。

权限：仅本人；实例方法适配、意愿和持续安全闸均通过才可推进。

删除／留存：按实例或会话清理；原事件的一份 narrative 与非空 nvc/roleplay 各回填独立实例，不复制成他人记录。

### record_versions

**新增 · M1。** 统一理解、练习和专业纪要的不可变正文版本；有限三个父类型，均有真实外键。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `understanding_id` | `uuid` | 是 | 无 | → `understandings.id`。 |
| `exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。 |
| `note_application_id` | `uuid` | 是 | 无 | → `consultation_notes.application_id`。 |
| `version` | `integer` | 否 | 无 |  |
| `payload_schema_version` | `integer` | 否 | 1 |  |
| `content` | `jsonb` | 否 | 无 | 按父类型定义，见主设计的 JSON 契约 JSON：`RecordContent`（v1）。 |
| `provenance` | `text` | 否 | 无 | user_quoted / user_authored / model_inference / user_corrected / professional_authored / legacy_import |
| `created_by` | `text` | 是 | 无 | → `user.id`。 |
| `confirmation_scope` | `jsonb` | 否 | 无 | 需确认者 ID 集、成员代次和会话权限版本的冻结快照 JSON：`ConfirmationScope`（v1）。 |
| `professional_client_visible` | `boolean` | 否 | false | 仅纪要版本使用 |
| `content_sha256` | `char(64)` | 否 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `record_origin` | `text` | 否 | native | native / legacy_import；来源无法证明的旧资料保持 legacy_import |
| `producing_decision_id` | `uuid` | 是 | 无 | → `agent_decisions.id`。同 conversation 的模型生成决策；仅审计生成者，不构成事实证据 |
| `signed_by_user_id` | `text` | 是 | 无 | → `user.id`。此确切专业纪要版本的实际签署者；与签署时间/资质三者全有或全空，不从旧根推造 |
| `signer_credential_id` | `uuid` | 是 | 无 | → `professional_credentials.id`。与 signed_by_user_id 复合配对，签署时核验资格/服务指派；后续过期不改历史签署事实 |
| `signed_at` | `timestamptz` | 是 | 无 | 此版本签署时间；native >= created_at；一次签署后不可清除、覆盖或挪给新版 |

约束：PK(id)；UNIQUE(conversation_id,id)；三个父 ID 恰一非空；UNIQUE(understanding_id,version)、UNIQUE(exercise_id,version)、UNIQUE(note_application_id,version)；各父+conversation 复合 FK；内容创建后不可更新，只能通过擦除流程删除；current 指针须指向本父版本；native + model_inference 必有 producing_decision_id；legacy_import 不补造旧决策；用户亲写／修正可空；同 conversation 复合 FK；正文来源仍须 record_sources；content.type 须与真实父 kind 配对；professional_client_visible 只用于 note 版本；confirmation_scope 的 type 与 private/room/legacy 对应；native 的 confirmation_scope：private/intake/professional 为实际 owner 的 individual，room 为后端计算的真实确认范围；legacy_unknown 仅允许 record_origin=legacy_import，不能用于跳过新确认；签署三列全空或全非空；只有 professional_note 可签署，签署者与资质配对且属于当前获准专业服务；native 签署时间不早于创建；签署一次写入后不变，修正新建版本且重新签署，旧签署保留；既有根的 signed_at 只在可证实确切版本时回填，未知不补造。

索引：(conversation_id,created_at DESC,id)；三组 UNIQUE 已覆盖按根读取历史。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)；UNIQUE(conversation_id,understanding_id,id)；UNIQUE(conversation_id,exercise_id,id)；UNIQUE(conversation_id,note_application_id,id)；UNIQUE(understanding_id,version,id)。

组合外键 `fk_version_producer`：(conversation_id,producing_decision_id) → agent_decisions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_version_parent_understanding_id`：(conversation_id,understanding_id) → understandings(conversation_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_version_parent_exercise_id`：(conversation_id,exercise_id) → exercises(conversation_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_version_parent_note_application_id`：(conversation_id,note_application_id) → consultation_notes(conversation_id,application_id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_record_signer_credential`：(signed_by_user_id,signer_credential_id) → professional_credentials(subject_user_id,id)；ON DELETE RESTRICT；即时检查。

权限：按父资源及所属域；专业纪要每版本独立开放，不能用后来开放标记暴露旧草稿。

删除／留存：随父级和合法删除流程清理；发布／分享引用版本用 RESTRICT，先清理授权、来源与派生记录再删除。

### record_sources

**新增 · M1。** 记录精确来源，既用于解释和纠错，也用于撤回／删除后定位受影响派生物。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `target_conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `target_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `target_agent_decision_id` | `uuid` | 是 | 无 | → `agent_decisions.id`。 |
| `source_message_id` | `bigint` | 是 | 无 | → `messages.id`。 |
| `source_assessment_submission_id` | `uuid` | 是 | 无 | → `assessment_submissions.id`。 |
| `source_snapshot_id` | `uuid` | 是 | 无 | → `share_snapshots.id`。 |
| `source_grant_id` | `uuid` | 是 | 无 | → `share_grants.id`。 |
| `target_path` | `text` | 是 | 无 | 目标 JSON Pointer，如 /acts/2/user_text，定位哪一部分有此依据 |
| `source_start` | `integer` | 是 | 无 |  |
| `source_end` | `integer` | 是 | 无 | UTF-16 字符偏移，前后端同口径 |
| `source_role` | `text` | 否 | 无 | fact / quote / hypothesis / score / user_confirmed_summary |
| `source_sha256` | `char(64)` | 否 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `source_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。已保存理解／练习等的确切版本，不用可变根指针作来源 |
| `source_access_basis` | `text` | 否 | same_conversation | same_conversation / authorized_room / snapshot_grant；不是客户端自授权限 |
| `source_conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。直接 message/submission/record_version 来源所属会话；same_conversation 时等于目标，authorized_room 时为本人同事件公共 room；snapshot_grant 时为空 |
| `source_path` | `text` | 是 | 无 | 来源为 JSON 版本/答卷/快照时定位具体字段的 JSON Pointer；文本偏移相对该字段；全文引用可空 |

约束：PK(id)；两个目标恰一，四个来源 message/submission/record_version/snapshot 恰一；目标归属 target_conversation_id；same_conversation：source_conversation_id=target_conversation_id，grant 为空；authorized_room：仅 message 来源且 source_conversation_id 为同 event 的 room，目标 private，本人资格/历史边界复验；snapshot_grant：仅 snapshot+grant，source_conversation_id 为空；三种直接来源用(source_conversation_id,source_id)分别复合 FK；source_conversation_id 在直接来源非空，不能用 target_conversation_id 错配 room 来源；snapshot/grant/目标会话用三列复合 FK；grant 不适用于直接来源；同域 record_version 来源禁止自引用和有向环；目标发布前锁根核对源未失效且仍可用；target_path 为存在的 JSON Pointer；source_start/end 为 UTF-16 左闭右开边界，仅文本来源可用；source_role 不把 model_inference/hypothetical 升格为 fact 或 quote；source_sha256 是当时源内容摘要；源撤权／擦除沿全部反向边失效派生，先处理依赖再删除；source_path 如有必须指向实际存在的来源字段；source_start/end 同空或同时非空且 0<=start<end，UTF-16 边界不能截断代理对；非文本不能填字符偏移。

索引：各 target/source 外键索引，特别 source_message_id、source_assessment_submission_id、source_snapshot_id；source_record_version_id；source_conversation_id。

组合外键 `fk_source_target_version`：(target_conversation_id,target_record_version_id) → record_versions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_source_target_decision`：(target_conversation_id,target_agent_decision_id) → agent_decisions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_source_message`：(source_conversation_id,source_message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_source_submission`：(source_conversation_id,source_assessment_submission_id) → assessment_submissions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_source_saved_version`：(source_conversation_id,source_record_version_id) → record_versions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_source_granted_snapshot`：(target_conversation_id,source_grant_id,source_snapshot_id) → share_grants(target_conversation_id,id,snapshot_id)；ON DELETE RESTRICT；即时检查。

权限：与目标同域；读取来源仍复核授权，表内存在引用不等于有访问权。

删除／留存：来源擦除或撤回→定位依赖→使目标失效／重算／擦除，再删引用；不是删来源外键就自动完成派生清理。

### understanding_confirmations

**扩展 · M1。** 继续逐人、逐版本记录认可或反对，不存可漂移的共同确认布尔值。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `membership_generation` | `bigint` | 是 | 无 |  |
| `request_id` | `uuid` | 是 | 无 |  |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：沿用 PK(understanding_id,user_id,version)；FK(understanding_id,version)→record_versions(understanding_id,version)；record_version_id 必须匹配同一版本；仅 confirmation_scope 中的本人可提交；重复请求幂等。

索引：(record_version_id,user_id)。

组合外键 `fk_confirmation_record_version`：(understanding_id,version,record_version_id) → record_versions(understanding_id,version,id)；ON DELETE RESTRICT；即时检查。

权限：当事人确认自己的理解；作者可以改正文但不能代他人确认。

删除／留存：正文修订不沿用旧确认；成员移除不能让原有反对自动消失并变成共识；新群体要重新核对。

### share_snapshots

**重构 · M1。** 统一固定版本的摘要、练习成果和已开放纪要快照，替代各处复制正文。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `source_conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `source_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `snapshot_kind` | `text` | 是 | 无 | confirmed_summary / practice_excerpt / story / professional_note / common_outcome |
| `payload` | `jsonb` | 是 | 无 | 有界、用户实际预览的内容；旧 content 原样保留到切换 JSON：`SnapshotPayload`（v1）。 |
| `payload_schema_version` | `integer` | 否 | 1 |  |
| `content_sha256` | `char(64)` | 是 | 无 |  |
| `state` | `text` | 否 | available | available / invalidated / erased |

约束：沿用 id、event、created_by；取消旧 UNIQUE(event_id,source_version)，改为(source_record_version_id,snapshot_kind,content_sha256)唯一；FK源版本及同事件会话；创建者必须有权分享此具体版本；不接收原始答卷快照。

索引：(event_id,created_at DESC)；(source_record_version_id)。

组合外键 `fk_snapshot_source_conversation`：(event_id,source_conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_snapshot_source_version`：(source_conversation_id,source_record_version_id) → record_versions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：本人可查看自己分享的固定内容；接收人按当前 share_grants，而不是 snapshot ID。

删除／留存：普通编辑不改旧快照；删除／撤回处理分别执行；被合法保存的其他公开消息不是同一份可撤回对象。

### share_grants

**扩展 · M1。** 授权绑定接收人、目标会话、用途、权限和成员代次；仍使用固定快照。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `target_event_id` | `uuid` | 是 | 无 | → `events.id`。旧 event_id 继续指快照源事件 |
| `target_conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `purpose_code` | `text` | 是 | 无 | personal_context / room_discussion / professional_service / action_followup；后者仅同事件 room 的经全体确认行动约定→获准本人 private，不用于跨事件记忆 |
| `permissions` | `text[]` | 否 | 无 | read / use_in_agent，use_in_agent 不自动拥有 |
| `membership_generation` | `bigint` | 是 | 无 |  |
| `application_id` | `uuid` | 是 | 无 | → `applications.id`。 |
| `consent_grant_id` | `uuid` | 是 | 无 | → `consent_grants.id`。 |
| `expires_at` | `timestamptz` | 是 | 无 |  |

约束：沿用 id/snapshot/recipient/撤回字段；旧每事件每接收人唯一改为(snapshot_id,recipient_id,target_conversation_id,purpose_code)未撤回唯一；源 event/snapshot、目标 event/conversation 分别复合 FK；room/professional 源目标须同事件；personal_context 仅本人拥有的 intake/private 可跨事件且只能带获准确认摘要；professional 必须匹配 application；房间代次必须匹配有效成员；自我转移也须明确确认；professional_service 的 application_id 与 target_conversation_id 复合配对，不把 recipient_id 错当申请人；实际接收人须为当前获准申请人或分配专业人员，资格/范围在事务复验，不能因是会话参与者而默认共享。；action_followup 仅同事件 room→实际参与者本人的 private；源为经对应范围共同确认的 action_agreement 确切版本，snapshot_kind=common_outcome，逐项确认披露/使用权限；不改变 personal_context 只限本人 intake/private 的边界。

索引：(recipient_id,target_conversation_id) WHERE revoked_at IS NULL；(snapshot_id,purpose_code)；到期读取动态校验，不把 now() 放部分索引谓词。

复合关系使用的完整唯一键：UNIQUE(target_conversation_id,id,snapshot_id)；UNIQUE(id,snapshot_id,recipient_id)。

组合外键 `fk_grant_target_conversation`：(target_event_id,target_conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_grant_application_conversation`：(application_id,target_conversation_id) → conversations(application_id,id)；ON DELETE RESTRICT；即时检查。

权限：读者按 read；Agent 还需 use_in_agent、所有实际受众授权、用途处理同意及当前资格。

删除／留存：撤回／到期阻止新读取和模型调用；更新目标 permission_epoch；重新加入、重开申请不恢复旧授权。

### invites

**扩展 · M2。** 邀请只授予受邀房间资格，摘要授权另在接受事务生成。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `created_by` | `text` | 是 | 无 | → `user.id`。 |
| `target_conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `intended_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `accepted_membership_generation` | `bigint` | 是 | 无 |  |
| `history_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `accepted_at` | `timestamptz` | 是 | 无 |  |
| `request_id` | `uuid` | 是 | 无 |  |
| `delivery_state` | `text` | 否 | not_sent | not_sent / queued / sent / failed；生成链接不等于送达 |

约束：保留 token_hash 唯一、不存明文 token；目标必须同事件 room；单次令牌不可重复消费；intended_user 非空才是定向邀请；现有一个 snapshot_id 为一条邀请附带一个获准摘要，更多内容在加入后逐项授权；token 仅首次成功创建返回，持久化仅 token_hash；重复创建 request_id 返回 409 INVITE_ALREADY_CREATED（限原创建者的去内容元数据），不承诺恢复链接；丢失后取消旧邀请并使用新 request_id 重建；同 ID 不同 payload 冲突；复制链接不表示已发送；取消/已接受/过期不因重试恢复；日志与 outbox 均不保存原始 token。

索引：保留(event_id,created_at DESC)；(created_by,request_id) 有值时唯一。

权限：令牌预览返回最少公开标题；无账号不展示私人摘要正文；接受需登录、必要政策及目标身份。

删除／留存：取消／到期使令牌失效；不能自动撤销已完成的合法加入，退出／移除走独立流程。


## 06 Agent 状态、决策与工具

### agent_policy_rules

**新增 · M1。** Wang 情境规则的冻结条目：判断条件、Skill、工具许可、禁止行为和回复要求；不把路由、方法与产品能力混为一类。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `rule_code` | `text` | 否 | 无 | 团队登记的稳定政策规则代码；不把 R0–R7 路由或 A00 等场景节点当作独立规则原编号 |
| `source_rule_code` | `text` | 是 | 无 | 仅独立政策规则的真实原编号；R0–R7 是路由编号，A00/A05-2 等是场景节点，均不可冒充此字段。当前两份方案未编号独立政策规则，保持 NULL |
| `source_type` | `text` | 否 | 无 | provided_material / engineering_supplement；均不自动代表专业批准 |
| `source_reference` | `text` | 否 | 无 | 确切文档版本/摘要、页码及适用场景节点；来源设计稿不构成专业审核或发布许可 |
| `priority_group` | `text` | 否 | 无 | safety / authorization / willingness / stage / method / style；硬闸优先，不能靠较小 priority 绕过 |
| `priority` | `integer` | 否 | 无 | 组内非负顺序；相同优先级按 rule_code 稳定排列 |
| `schema_version` | `integer` | 否 | 2 |  |
| `conditions` | `jsonb` | 否 | 无 | 有界字段比较，增加 insight_state、relationship_dependency 及经本轮本人/来源复验的 support_preference；保留 expression_privacy、拒绝及置信度条件。未知不按通过处理；不得把状态候选或旧偏好当权限，不接受任意代码/SQL/JSONPath JSON：`RuleConditions`（v2）。 旧版本只读：1。 |
| `stage_codes` | `text[]` | 否 | 无 | 适用语义阶段；须在同一政策版本登记 |
| `route_code` | `text` | 否 | 无 | 该政策版本登记的主路由代码；采用已读取的 Wang V3.0 时为 R0–R7，不将现有 A–H 自动改名映射 |
| `skill_code` | `text` | 否 | 无 | 组合中的主 Skill，等于 skill_codes 第一项，保留用于查询；其余 Skill 不自动取得工具或数据权限 |
| `skill_codes` | `text[]` | 否 | 无 | 同政策登记的有序 Skill 组合，1–8 项不重复；第一项必须等于 skill_code。它是本规则的完整计划，不是已执行或有效果的证明 |
| `allowed_tools` | `text[]` | 否 | 无 | 只读/副作用仍按工具白名单及服务端授权核验，空数组表示不调用 |
| `forbidden_actions` | `text[]` | 否 | 无 | 禁止立即推练习、猜测第三方动机、未经授权分享等登记动作 |
| `required_confirmations` | `text[]` | 否 | 无 | method_start / record_save / invite / share 等分别核对，不以愿意聊天代替 |
| `response_requirements` | `jsonb` | 否 | 无 | 回应深度、人文关怀、假设核对及专业边界；不是固定回复模板 JSON：`ResponseRequirements`（v2）。 旧版本只读：1。 |
| `content_sha256` | `char(64)` | 否 | 无 | schema 2 的 16 个不可变业务字段（含 skill_codes）的 JCS SHA-256；schema 1 仍按原 15 字段核验且只读，不向旧正文补数组。确切投影见 Wang 基础说明 |
| `created_by` | `text` | 否 | 无 | → `user.id`。 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(policy_version_id,rule_code)；UNIQUE(policy_version_id,id)；priority≥0；policy.category=agent；所有代码在同版本登记；发布前锁政策根，核对规则清单及内容摘要、来源和审核；政策 approved/published 后禁止增删改规则，变更新建政策版本；不能只冻结 policy.content 而继续改子行；安全/授权/明确拒绝先于普通路由；模型不得修改 allowed_tools 或 forbidden_actions；条件未知不按通过处理；冲突停止副作用并澄清或升级；原生新写 schema_version=2；skill_codes 1–8 项有序唯一，首项等于 skill_code，全部在同政策登记；历史 schema 1 保持原字段与原摘要，只读核验。

索引：(policy_version_id,priority_group,priority,rule_code)；UNIQUE(policy_version_id,id)供命中记录配对。

复合关系使用的完整唯一键：UNIQUE(policy_version_id,id)。

权限：授权规则编辑/审核者按职责访问；生产只读已审生效版本。材料来源标记不授予用户数据访问权。

删除／留存：已发布版本被 run 引用后保留最少审计；新版本替代不改写旧规则。

### conversation_states

**新增 · M1。** 语义阶段及可回退长期状态，与 Worker 执行 checkpoint 分开。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `revision` | `bigint` | 否 | 0 |  |
| `stage_code` | `text` | 是 | 无 | NULL 表示尚未判断；不能从旧 checkpoint 猜阶段 |
| `stage_policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `stage_entered_at` | `timestamptz` | 否 | now() |  |
| `readiness` | `text` | 否 | unknown | unknown / listening / exploring / willing / declined / paused |
| `current_goal` | `text` | 是 | 无 |  |
| `state_schema_version` | `integer` | 否 | 2 |  |
| `state_data` | `jsonb` | 否 | 无 | 原生 v2 保存当前支持偏好、Insight/Relationship、稳定 key 的机制假设/反证/本人部分认可或否认、真实已发布支持/反馈及 unresolved_issues；状态摘要不替代来源。expression_privacy 与偏好均需当前本人/输入版本复验；拒绝不因普通聊天清除 JSON：`SessionState`（v2）。 旧版本只读：1。 |
| `safety_state` | `text` | 否 | unassessed | unassessed / clear / review_required / blocked |
| `blocked_capabilities` | `text[]` | 否 | ARRAY[]::text[] |  |
| `last_decision_id` | `uuid` | 是 | 无 | → `agent_decisions.id`。 |
| `updated_at` | `timestamptz` | 否 | now() |  |
| `context_version` | `bigint` | 否 | 0 | 最后消费的 conversation.revision；不同于 state revision，不可用旧运行覆盖新交互 |
| `last_interaction_id` | `uuid` | 是 | 无 | → `interaction_events.id`。最近已消费的真实反馈；同会话复合 FK |

约束：PK(conversation_id)；revision≥0；stage_code 必须在该政策版本定义内；风险限制取此状态与未关闭 safety_cases 的更严格结果；不得凭普通模型回复解除；context_version≥0；输入版本和 expected revision 双重 CAS；拒绝按稳定 method_key 持续生效，不能换方法版本绕过；只有新的本人明确请求/确认才撤销匹配拒绝；安全阻断按独立审核流程解除；advice_declined 持续到本人明确请求建议/方法/支持；普通继续交流不清除；refusal_target 区分邀请、单一方法、全部方法、建议和话题；失败未发布的普通状态不覆盖已生效偏好，风险限制仍即时保留；机制 key 由后端维持，不以改写/换 key 绕过否认；部分认可和否认匹配该主体对该假设的真实反馈，原有反证不静默删除；源撤回沿依赖链失效。prior_support 仅引用同会话已发布决策、本人真实反馈及同主体回访；短期 helpful 不等于问题解决；机制完整更新保存在最终发布 agent_decisions.assessment.mechanism_updates，state_data 为最多 8 项投影；缓存淘汰后仍按不可变完整历史核对最后有效更新，不用更换 key 绕过否认。

索引：按 PK 读取；必要时(safety_state,updated_at)作后台候选索引。

组合外键 `fk_state_last_decision`：(conversation_id,last_decision_id) → agent_decisions(conversation_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_state_interaction`：(conversation_id,last_interaction_id) → interaction_events(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：只供该会话的已获准 Agent 和被分配的安全处理者；不向家长暴露孩子私人状态。

删除／留存：删除会话清理；状态变化同事务写 agent_decisions／audit_events 并使旧任务失效。

### agent_runs

**扩展 · M1。** 保留实际执行尝试、checkpoint 和旧 assessment；增加可复现的上下文和版本依据。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `logical_turn_id` | `uuid` | 是 | 无 | 同一触发消息+上下文版本的尝试共享 ID |
| `attempt_no` | `integer` | 是 | 无 | 新尝试必须正整数；旧记录未知时 NULL，不统一补 1 |
| `state_revision` | `bigint` | 是 | 无 |  |
| `permission_epoch` | `bigint` | 是 | 无 |  |
| `consent_epochs` | `jsonb` | 否 | {} | 实际输入涉及主体的 user_id→epoch，不含正文 JSON：`ConsentEpochs`（v1）。 |
| `agent_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `knowledge_release_id` | `uuid` | 是 | 无 | → `knowledge_releases.id`。 |
| `input_manifest` | `jsonb` | 是 | 无 | 获准消息／快照及版本、工具结果摘要哈希，不缓存无权原文 JSON：`InputManifest`（v1）。 |
| `final_decision_id` | `uuid` | 是 | 无 | → `agent_decisions.id`。 |
| `input_tokens` | `bigint` | 是 | 无 |  |
| `output_tokens` | `bigint` | 是 | 无 |  |
| `reasoning_tokens` | `bigint` | 是 | 无 |  |
| `estimated_cost_minor` | `bigint` | 是 | 无 |  |
| `cost_currency` | `char(3)` | 是 | 无 |  |
| `latency_ms` | `integer` | 是 | 无 |  |
| `retention_until` | `timestamptz` | 是 | 无 |  |
| `invalidated_at` | `timestamptz` | 是 | 无 |  |
| `domain` | `text` | 是 | 无 | 兼容 private/room；intake/professional 为 NULL；NULL 不回退 private |

约束：沿用 id PK；UNIQUE(conversation_id,id)；UNIQUE(conversation_id,trigger_message_id,context_version,attempt_no)；final_decision 必属此 run；原 status 兼容期保留，失效原因用 error_code；费用未知为 NULL；domain 与 conversation.kind 映射；新增 intake/professional 写入前先解除旧 domain NOT NULL、建立会话组合 FK 并切权限读取；旧 assessment/checkpoint 只为恢复投影不当结构证据；event/conversation、trigger/response 消息所属会话分别用复合 FK 配对；旧 conversation_id 未回填时保持 NULL，不借旧 event/domain 猜造新归属。

索引：(conversation_id,created_at DESC,id)；逻辑触发恢复索引；(status,created_at)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)；UNIQUE(id,agent_policy_version_id)；UNIQUE(id,knowledge_release_id)。

组合外键 `fk_run_final_decision`：(id,final_decision_id) → agent_decisions(run_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_run_conversation`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_run_trigger_message`：(conversation_id,trigger_message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_run_response_message`：(conversation_id,response_message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：私有运行日志按来源会话隔离；模型推理可能含私密假设，保留期独立且不作为审计理由。

删除／留存：上下文擦除／撤权使相关运行不再重放；输入和 checkpoint 正文按留存规则清理，不能以日志名义无限保存。

### agent_decisions

**新增 · M1。** 一次运行中的不可变判断与路由快照，可多步，不为每种 Prompt 建独立 Agent 表。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `run_id` | `uuid` | 否 | 无 | → `agent_runs.id`。 |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `ordinal` | `integer` | 否 | 无 |  |
| `assessment_schema_version` | `integer` | 否 | 2 |  |
| `assessment` | `jsonb` | 否 | 无 | 七维判断分别记录安全、情绪、意图、清晰度、insight_state、意愿、relationship_dependency；support_preference 是当前主体自报和本轮复验版本，不能把支持偏好当权限。理解/机制与他人动机仍需本人核对；不是诊断；mechanism_updates 随最终发布决策保存后端核验的不可变机制更新，当前状态缓存淘汰不删除历史，生产者必须读取该 key 的最后有效已提交更新，核对主体和确切反馈范围 JSON：`TurnAssessment`（v2）。 旧版本只读：1。 |
| `risk_code` | `text` | 否 | unknown |  |
| `strategy_code` | `text` | 否 | 无 | 字段保留此名称，保存该 policy_version_id 登记的主路由代码；Wang V3.0 为 R0–R7；不是 Skill 或场景节点，不从旧 A–H 推断新值 |
| `stage_before` | `text` | 是 | 无 |  |
| `stage_after` | `text` | 是 | 无 |  |
| `confidence` | `numeric(5,4)` | 是 | 无 |  |
| `reason_summary` | `text` | 否 | 无 | 简短依据，不存内部思维链 |
| `gate_results` | `jsonb` | 否 | 无 | 风险、同意、意愿、适配及证据检查结果和版本 JSON：`GateResults`（v1）。 |
| `requires_confirmation` | `boolean` | 否 | false |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。与 run.agent_policy_version_id 配对；政策未知的旧运行不能补造新决策 |
| `skill_code` | `text` | 否 | 无 | 能力与 strategy_code、实际工具调用分开 |
| `route_schema_version` | `integer` | 否 | 2 |  |
| `route_decision` | `jsonb` | 否 | 无 | v2 冻结真实候选路由、选中规则的完整有序 skill_codes、允许/禁止动作及独立确认要求；主 skill/策略/阶段与普通列、真实命中行一致。计划不等于已调用工具或产生支持效果；v1 原样只读 JSON：`RouteDecision`（v2）。 旧版本只读：1。 |
| `gate_schema_version` | `integer` | 否 | 1 |  |

约束：PK(id)；UNIQUE(run_id,ordinal)；UNIQUE(conversation_id,id)；run 与 conversation 复合 FK；0≤confidence≤1；stage/strategy/risk 按 run 政策版本校验；变阶段用 conversation_states revision CAS；policy_version_id 与 run 配对；route_decision 的策略/阶段/skill/确认要求等于普通列；完成路由时 selected_rule_id 对应恰好一个 selected 子行，数据库部分唯一约束仅保证最多一个；证据 ID 只定位同 decision 的 record_sources，不授予额外读取权。

索引：(conversation_id,created_at DESC,id)；(strategy_code,created_at) 用于脱敏运营视图。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)；UNIQUE(run_id,id)；UNIQUE(id,policy_version_id)。

组合外键 `fk_decision_run`：(conversation_id,run_id) → agent_runs(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_decision_policy_run`：(run_id,policy_version_id) → agent_runs(id,agent_policy_version_id)；ON DELETE RESTRICT；即时检查。

权限：按 run；只显示允许公开的理由，私人分析不因房间引用而公开。

删除／留存：跟随源会话和运行留存；失败及否定判断也保留到批准期限，不伪造成功。

### agent_decision_rule_matches

**新增 · M1。** 实际评估及命中规则的记录，区分匹配、选中、硬闸阻断与被更高优先级抑制。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `decision_id` | `uuid` | 否 | 无 | → `agent_decisions.id`。 |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `rule_id` | `uuid` | 否 | 无 | → `agent_policy_rules.id`。 |
| `ordinal` | `integer` | 否 | 无 |  |
| `outcome` | `text` | 否 | 无 | matched / selected / blocked / suppressed |
| `reason_summary` | `text` | 否 | 无 | 最少可复核依据；原始证据走同会话 record_sources，不保存内部思维链 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(decision_id,rule_id)；UNIQUE(decision_id,ordinal)；ordinal>0；每个决策至多一个 outcome=selected 的部分唯一索引；同 conversation 的真实 decision；decision、run、rule 的 policy_version_id 完全一致；selected 对应 route/skill，allowed_tools 取全部命中硬约束后的交集，forbidden_actions 取并集；不得只记录最后成功规则而丢弃本轮实际阻断；未评估的规则不伪造 matched；理由涉及的证据必须属于该 decision 的获准来源。

索引：(conversation_id,decision_id)；(policy_version_id,rule_id,outcome)；UNIQUE(decision_id) WHERE outcome=selected。

组合外键 `fk_match_conversation_decision`：(conversation_id,decision_id) → agent_decisions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_match_decision_policy`：(decision_id,policy_version_id) → agent_decisions(id,policy_version_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_match_policy_rule`：(policy_version_id,rule_id) → agent_policy_rules(policy_version_id,id)；ON DELETE RESTRICT；即时检查。

权限：与 decision/run 同会话隔离；规则本身可公开不等于私人命中理由可公开。

删除／留存：跟随 decision 留存和擦除；不得脱离源会话长期保存私人理由。

### agent_tool_calls

**新增 · M1。** 工具执行及来源最少快照，区别提议、尝试和成功。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `run_id` | `uuid` | 否 | 无 | → `agent_runs.id`。 |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `ordinal` | `integer` | 否 | 无 |  |
| `tool_name` | `text` | 否 | 无 |  |
| `tool_schema_version` | `text` | 否 | 无 |  |
| `input` | `jsonb` | 否 | 无 |  JSON：`ToolInput`（v2）。 旧版本只读：1。 |
| `status` | `text` | 否 | 无 | requested / running / succeeded / failed / blocked / stale |
| `result_summary` | `jsonb` | 是 | 无 |  JSON：`ToolResultSummary`（v1）。 |
| `authorization_manifest` | `jsonb` | 否 | 无 | 本次使用的用途、授权 ID 与版本 JSON：`AuthorizationManifest`（v1）。 |
| `error_code` | `text` | 是 | 无 |  |
| `started_at` | `timestamptz` | 是 | 无 |  |
| `finished_at` | `timestamptz` | 是 | 无 |  |
| `decision_id` | `uuid` | 否 | 无 | → `agent_decisions.id`。引起本次调用的决策，必须同 run |
| `input_schema_version` | `integer` | 否 | 2 |  |
| `log_schema_version` | `integer` | 否 | 1 |  |
| `interaction_event_id` | `uuid` | 是 | 无 | → `interaction_events.id`。副作用工具必须有匹配当前目的的真实本人确认；只读调用可空 |
| `request_id` | `uuid` | 是 | 无 | 副作用调用非空；同会话幂等键，重试不重复执行业务 |

约束：PK(id)；UNIQUE(run_id,ordinal)；UNIQUE(run_id,id)供方法引用配对；run 同 conversation；工具名和参数按白名单校验；result 不保存令牌、任意 SQL 或未授权完整原文；有副作用动作必须独立 request_id 幂等并关联实际业务；decision_id 必属本 run；输入日志与工具接口分别版本化；request_id 在副作用时非空且 UNIQUE(conversation_id,request_id)（非空）；与确认交互和实际业务对象同事务配对，重试复用同键。

索引：(run_id,ordinal)；(tool_name,status,started_at)。

复合关系使用的完整唯一键：UNIQUE(run_id,id)。

组合外键 `fk_tool_decision_run`：(run_id,decision_id) → agent_decisions(run_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_tool_conversation_run`：(conversation_id,run_id) → agent_runs(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_tool_interaction`：(conversation_id,interaction_event_id) → interaction_events(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：只在该次授权上下文使用；模型无权选择其他会话或任意 URL。

删除／留存：随运行内容清理；统计仅保留允许的错误码和耗时。

### agent_method_refs

**新增 · M2。** 记录检索到和实际采用的方法版本，支持知识依据审查。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `run_id` | `uuid` | 否 | 无 | → `agent_runs.id`。 |
| `tool_call_id` | `uuid` | 否 | 无 | → `agent_tool_calls.id`。 |
| `knowledge_release_id` | `uuid` | 否 | 无 | → `knowledge_releases.id`。 |
| `method_version_id` | `uuid` | 否 | 无 | → `method_versions.id`。 |
| `rank` | `integer` | 否 | 无 |  |
| `retrieval_score` | `numeric(12,6)` | 是 | 无 |  |
| `used` | `boolean` | 否 | false |  |
| `selection_reason` | `text` | 是 | 无 |  |
| `excerpt_sha256` | `char(64)` | 否 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `decision_id` | `uuid` | 否 | 无 | → `agent_decisions.id`。 |
| `applicability` | `text` | 否 | 无 | eligible / blocked / needs_review；只检索到不等于适用或采用 |
| `restriction_reason` | `text` | 是 | 无 | 被禁忌/意愿/年龄/审核限制时必须说明；不得转为私人诊断标签 |

约束：PK(tool_call_id,method_version_id)；FK(knowledge_release_id,method_version_id)→knowledge_release_items；工具必须属于此 run；release 必须等于 run 的知识版本；检索分数非诊断置信度；decision 与 tool_call 均属本 run；used=true 仅限 applicability=eligible；blocked/needs_review 不用于生成练习，限制理由必填；运行政策与方法适配版本一致。

索引：(run_id,used)；(method_version_id)。

复合关系使用的完整唯一键：UNIQUE(tool_call_id,method_version_id)。

组合外键 `fk_method_ref_decision`：(run_id,decision_id) → agent_decisions(run_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_method_ref_tool`：(run_id,tool_call_id) → agent_tool_calls(run_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_method_ref_release_item`：(knowledge_release_id,method_version_id) → knowledge_release_items(knowledge_release_id,method_version_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_method_ref_run_release`：(run_id,knowledge_release_id) → agent_runs(id,knowledge_release_id)；ON DELETE RESTRICT；即时检查。

权限：只读获准、已审的发布内容；撤回方法停止新使用，旧版本用于受权复盘。

删除／留存：随运行清理关联；公共方法版本按发布审计保留，不能将私人查询拼进方法卡。


## 07 方法与知识发布

### knowledge_sources

**新增 · M2。** 每行对应一个确切来源版本及许可状态，不把书单当已入库内容。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `source_key` | `text` | 否 | 无 |  |
| `version` | `integer` | 否 | 无 |  |
| `source_kind` | `text` | 否 | 无 | book / paper / guideline / curriculum / curated_example |
| `title` | `text` | 否 | 无 |  |
| `authors` | `jsonb` | 否 | 无 |  JSON：`Authors`（v1）。 |
| `edition` | `text` | 是 | 无 |  |
| `source_url` | `text` | 是 | 无 |  |
| `file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `content_sha256` | `char(64)` | 是 | 无 |  |
| `rights_status` | `text` | 否 | pending | pending / allowed / restricted / revoked / expired |
| `allowed_purposes` | `text[]` | 否 | 无 |  |
| `quotation_limits` | `jsonb` | 否 | 无 | 用途、范围和引用限制，由权利审核填写 JSON：`QuotationLimits`（v1）。 |
| `rights_evidence_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `valid_until` | `timestamptz` | 是 | 无 |  |
| `verified_by` | `text` | 是 | 无 | → `user.id`。 |
| `verified_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(source_key,version)；版本内容不可改；许可状态可关闭并审计；无许可不进生产方法发布。

索引：(source_key,version DESC)；(rights_status,valid_until)。

权限：内容审核人员可读获准原文；普通 Agent 只取已发布方法卡必要片段。

删除／留存：许可撤回时阻断新检索并标记依赖版本；不将用户私人案例直接登记成公开知识。

### method_versions

**新增 · M2。** 方法稳定 key 与不可变版本合一；覆盖 11 组方法／规范，不另建 11 套表。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `method_key` | `text` | 否 | 无 |  |
| `version` | `integer` | 否 | 无 |  |
| `family_code` | `text` | 否 | 无 |  |
| `title` | `text` | 否 | 无 |  |
| `goal` | `text` | 否 | 无 |  |
| `allowed_stages` | `text[]` | 否 | 无 |  |
| `allowed_strategies` | `text[]` | 否 | 无 |  |
| `age_requirements` | `jsonb` | 否 | 无 | 与政策年龄带匹配；未知不自动适用 JSON：`AgeRequirements`（v1）。 |
| `trigger_signals` | `jsonb` | 否 | 无 |  JSON：`Conditions`（v1）。 |
| `contraindications` | `jsonb` | 否 | 无 |  JSON：`Conditions`（v1）。 |
| `entry_conditions` | `jsonb` | 否 | 无 |  JSON：`Conditions`（v1）。 |
| `exit_conditions` | `jsonb` | 否 | 无 |  JSON：`Conditions`（v1）。 |
| `steps` | `jsonb` | 否 | 无 |  JSON：`MethodSteps`（v1）。 |
| `examples` | `jsonb` | 否 | 无 |  JSON：`MethodExamples`（v1）。 |
| `refusal_handling` | `jsonb` | 否 | 无 |  JSON：`RefusalHandling`（v1）。 |
| `output_contract` | `jsonb` | 否 | 无 |  JSON：`MethodOutputContract`（v1）。 |
| `evaluation_criteria` | `jsonb` | 否 | 无 |  JSON：`EvaluationCriteria`（v1）。 |
| `schema_version` | `integer` | 否 | 1 |  |
| `content_sha256` | `char(64)` | 否 | 无 | 21 个不可变业务字段的 JCS SHA-256；不含 id、content_sha256、sources_sha256、状态、审核人/凭据/时间/意见及 created_at；确切投影见 Wang 基础说明 |
| `sources_sha256` | `char(64)` | 是 | 无 | 批准时必填；按 source_id/locator 的 UTF-16 顺序对完整 [{source_id,locator,allowed_excerpt,excerpt_sha256}] 做 JCS UTF-8 SHA-256；冻结真实来源成员集，不代表许可永远有效 |
| `status` | `text` | 否 | draft | draft / in_review / approved / retired / withdrawn |
| `reviewed_by` | `text` | 是 | 无 | → `user.id`。 |
| `reviewer_credential_id` | `uuid` | 是 | 无 | → `professional_credentials.id`。 |
| `reviewed_at` | `timestamptz` | 是 | 无 |  |
| `review_comment` | `text` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `practice_kind` | `text` | 是 | 无 | narrative / nvc / roleplay；非产品练习的方法可空 |
| `agent_policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。适用 stage/strategy/skill 的代码来源；发布到其他政策须重新复核 |
| `allowed_skill_codes` | `text[]` | 否 | 无 | 方法知识与沟通 Skill 不是同一对象 |

约束：PK(id)；UNIQUE(method_key,version)；批准后正文不可改；审核人证据须匹配本人有效资质和审核职责；不因模型生成而自动 approved；发布还须检查所有来源许可；批准时锁方法根与完整 method_sources，核对 sources_sha256 后冻结正文和来源成员集；修订另建版本；来源许可关闭仍即时限制检索/使用，不因历史哈希继续放行。

索引：(method_key,version DESC)；GIN(allowed_stages)、GIN(allowed_strategies) 按查询使用；无初始向量字段。

组合外键 `fk_method_reviewer_subject`：(reviewed_by,reviewer_credential_id) → professional_credentials(subject_user_id,id)；ON DELETE RESTRICT；即时检查。

权限：审核后生产只读；不向用户声称该卡等于完整临床治疗。

删除／留存：撤回版本只停止未来使用；历史引用保留最少审计，不随新版本重写旧执行。

### method_sources

**新增 · M2。** 方法卡到确切资料版本的引用依据。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `method_version_id` | `uuid` | 否 | 无 | → `method_versions.id`。 |
| `source_id` | `uuid` | 否 | 无 | → `knowledge_sources.id`。 |
| `locator` | `text` | 否 | 无 | 章节／页码／段落 |
| `allowed_excerpt` | `text` | 是 | 无 |  |
| `excerpt_sha256` | `char(64)` | 是 | 无 |  |

约束：PK(method_version_id,source_id,locator)；引用不得超许可限制；同一本不同版是不同 source_id。

索引：(source_id,method_version_id)。

权限：同方法及版权范围。

删除／留存：父方法清除时级联；来源许可撤回须能反向定位。

### knowledge_releases

**新增 · M2。** 一次可用方法集合的封版；用于复现当时能检索到什么。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `release_key` | `text` | 否 | 无 |  |
| `manifest_sha256` | `char(64)` | 否 | 无 |  |
| `status` | `text` | 否 | draft | draft / published / retired / withdrawn |
| `approved_by` | `text` | 是 | 无 | → `user.id`。 |
| `published_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(release_key)；发布后成员集合不可改；只能包含已审且许可可用的方法版本；一个 method_key 在同发布最多一个版本。

索引：(status,published_at DESC)。

权限：普通运行只读 published；历史回放不得绕过撤回的权限。

删除／留存：被 run 引用时 RESTRICT；新增版本使用新 release，不在旧发布上替换卡片。

### knowledge_release_items

**新增 · M2。** 知识发布的实际方法清单，保留外键完整性。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `knowledge_release_id` | `uuid` | 否 | 无 | → `knowledge_releases.id`。 |
| `method_version_id` | `uuid` | 否 | 无 | → `method_versions.id`。 |

约束：PK(knowledge_release_id,method_version_id)；发布后不可变；同 method_key 多版本排斥由发布事务校验。

索引：(method_version_id,knowledge_release_id)。

复合关系使用的完整唯一键：UNIQUE(knowledge_release_id,method_version_id)。

权限：随知识发布。

删除／留存：随未发布 release 可清理；已发布受引用记录不可直接删除。


## 08 专业服务与通知

### consultants

**扩展 · M3。** 服务目录继续使用当前表；展示资料、核验凭证与具体预约分开。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `verification_status` | `text` | 否 | pending | pending / verified / suspended / expired；旧 verified_at 不等于新版核验，旧未知先 NULL |
| `verified_by` | `text` | 是 | 无 | → `user.id`。 |
| `profile_version` | `integer` | 否 | 1 |  |
| `profile_reviewed_at` | `timestamptz` | 是 | 无 |  |
| `age_requirements` | `jsonb` | 否 | 无 |  JSON：`AgeRequirements`（v1）。 |
| `region_codes` | `text[]` | 否 | ARRAY[]::text[] |  |
| `languages` | `text[]` | 否 | ARRAY['zh-CN']::text[] | 新目录的默认语言；旧目录未核验语言不凭默认值推断，扩展期先 NULL |
| `service_timezone` | `text` | 是 | 无 | 真实排班前须确认 IANA 时区 |
| `fee_minor` | `bigint` | 是 | 无 |  |
| `fee_currency` | `char(3)` | 是 | 无 |  |
| `profile_data` | `jsonb` | 否 | 无 | 方法说明、适用／不适用、渠道及图片 ID，不保存医疗诊断 JSON：`ConsultantProfile`（v1）。 |

约束：保留 id/user_id/active/test_only；active 和 verified、有效资质共同决定真实服务可用；fee≥0、币种与数值成对；文字 price 过渡保留，不将展示费用等同支付。

索引：(active,verification_status)；领域数组按实际查询加 GIN。

权限：公开目录只给已核验可展示字段；资质原件不公开。

删除／留存：停用立即阻断新申请及新确认，取消和撤回仍允许；关联历史不随目录编辑而改写。

### professional_credentials

**新增 · M1。** 独立的专业／审核资质凭证；既可用于咨询人员，也可用于方法和案例审核人员。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `subject_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `credential_type` | `text` | 否 | 无 |  |
| `issuer` | `text` | 否 | 无 |  |
| `credential_reference_hash` | `text` | 是 | 无 | 不向前台返回证件号 |
| `evidence_file_id` | `uuid` | 否 | 无 | → `file_objects.id`。 |
| `valid_from` | `date` | 是 | 无 |  |
| `valid_until` | `date` | 是 | 无 |  |
| `status` | `text` | 否 | pending | pending / verified / rejected / revoked / expired |
| `verified_by` | `text` | 是 | 无 | → `user.id`。 |
| `verified_at` | `timestamptz` | 是 | 无 |  |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(subject_user_id,id)；有效期顺序；验证者不为本人；method/dataset 审核记录须复合 FK 匹配 reviewer 与凭证主体；资质类别是否足够由审核规则确定。

索引：(subject_user_id,status,valid_until)。

复合关系使用的完整唯一键：UNIQUE(subject_user_id,id)。

权限：限核验职责；公开只显示审核过的资格摘要。

删除／留存：到期／撤销停止未来资格；证明文件按审核留存期清理；不能以普通账号角色字符串替代。

### service_slots

**新增 · M3。** 服务方明确开放的可预约时段；非已确认预约。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `consultant_id` | `uuid` | 否 | 无 | → `consultants.id`。 |
| `starts_at` | `timestamptz` | 否 | 无 |  |
| `ends_at` | `timestamptz` | 否 | 无 |  |
| `service_mode` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | open | open / withdrawn |
| `revision` | `integer` | 否 | 1 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(consultant_id,id)；starts<ends；时段更新不暗改已确认预约；容量初期固定一对一，不加未需要的容量平台。

索引：(consultant_id,starts_at) WHERE status=open。

复合关系使用的完整唯一键：UNIQUE(consultant_id,id)。

权限：只向有条件的申请人展示可用时段；咨询方维护自己的开放时段。

删除／留存：撤销时段阻止新确认；保留已确认的历史预约参照。

### appointments

**新增 · M3。** 一次申请的真实时间约定，保留现有双方确认流程并增加冲突约束。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `application_id` | `uuid` | 否 | 无 | → `applications.id`。 |
| `consultant_id` | `uuid` | 否 | 无 | → `consultants.id`。 |
| `applicant_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `slot_id` | `uuid` | 是 | 无 | → `service_slots.id`。 |
| `status` | `text` | 否 | negotiating | negotiating / confirmed / cancelled / completed / no_show / legacy_time_only |
| `legacy_status` | `text` | 是 | 无 | 旧状态原样保存；没有结束时间不猜时长 |
| `confirmed_starts_at` | `timestamptz` | 是 | 无 |  |
| `confirmed_ends_at` | `timestamptz` | 是 | 无 |  |
| `revision` | `integer` | 否 | 1 |  |
| `confirmed_at` | `timestamptz` | 是 | 无 |  |
| `cancelled_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |
| `latest_proposal_id` | `uuid` | 是 | 无 | → `appointment_proposals.id`。本预约最近提议的索引指针 |
| `accepted_proposal_id` | `uuid` | 是 | 无 | → `appointment_proposals.id`。当前已确认时间的来源提议；旧导入不补造 |
| `record_origin` | `text` | 否 | native | native / legacy_import |
| `legacy_data` | `jsonb` | 是 | 无 | 旧状态、已知时间、旧 schedule_version；native 为 null JSON：`LegacyAppointment`（v1）。 |

约束：PK(id)；UNIQUE(application_id)；UNIQUE(id,application_id)；申请人/consultant 与 application 配对；slot 同 consultant；两个 proposal 指针分别以(appointment_id,proposal_id)复合 FK 指向本预约子行；已确认起止必须成对且开始<结束；legacy_time_only 允许只知道开始；confirmed/completed/no_show 必有完整已确认时段；native 的 confirmed 范围必须与 accepted_proposal 相同；咨询方与申请人两条 GiST 排他约束；提议不占用已确认区间，接受时原子换时段；拒绝/过期/撤销不覆盖旧约定；最新提议指针不当作已接受依据；取消不抹掉历史事实；native accepted_proposal 的 slot_id、starts_at、ends_at 必与根一致；legacy_time_only 必须 record_origin=legacy_import；legacy_data 仅 legacy_import 可有，native 为空。

索引：(consultant_id,confirmed_starts_at)；(applicant_user_id,confirmed_starts_at)；排他约束另见主设计。

组合外键 `fk_appointment_application`：(application_id,consultant_id,applicant_user_id) → applications(id,consultant_id,applicant_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_appointment_slot`：(consultant_id,slot_id) → service_slots(consultant_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_appointment_latest_proposal_id`：(id,latest_proposal_id) → appointment_proposals(appointment_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_appointment_accepted_proposal_id`：(id,accepted_proposal_id) → appointment_proposals(appointment_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

权限：申请双方按归属；状态变更写 revisions/audit，确认须匹配当前 appointment revision 与 proposal ID 及有效服务资格；未消除旧时间不完整冲突前不能自动承诺该方新时段。

删除／留存：取消不删除历史；完成／缺席的原时段继续作为占用历史；正式记录保留依批准政策。

### appointment_proposals

**新增 · M3。** 每次时间提议、决定者及结论单列保留，拒绝／再次提议不覆盖历史。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `appointment_id` | `uuid` | 否 | 无 | → `appointments.id`。 |
| `proposal_no` | `integer` | 否 | 无 | 本预约单调递增，锁根分配 |
| `starts_at` | `timestamptz` | 否 | 无 |  |
| `ends_at` | `timestamptz` | 否 | 无 |  |
| `slot_id` | `uuid` | 是 | 无 | → `service_slots.id`。 |
| `proposed_by` | `text` | 否 | 无 | → `user.id`。 |
| `base_appointment_revision` | `integer` | 否 | 无 |  |
| `status` | `text` | 否 | pending | pending / accepted / declined / withdrawn / expired / superseded |
| `decided_by` | `text` | 是 | 无 | → `user.id`。接受/拒绝为真实对方；withdrawn 为提出者；系统过期/替换为空 |
| `decided_at` | `timestamptz` | 是 | 无 |  |
| `decision_reason_code` | `text` | 是 | 无 | 闭合原因码，无私人正文 |
| `expires_at` | `timestamptz` | 是 | 无 |  |
| `request_id` | `uuid` | 否 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(appointment_id,id)；UNIQUE(appointment_id,proposal_no)；UNIQUE(proposed_by,request_id)；每预约 WHERE status=pending 至多一条（不把 now() 放部分索引）；starts_at<ends_at；expires_at 若有须晚于创建；pending 的决定三列均空；闭合态须 decided_at 和 reason；accepted/declined/withdrawn 须 decided_by，expired/superseded 的系统操作为空并入审计；锁 appointment→懒关闭已过期 pending→核对资格、双方身份和 base revision→创建/替换提议；接受须实际未过期、当前 pending 和 expected revision；通过冲突约束后更新 accepted 指针/范围/版本/通知同事务；原 accepted 行不因后续改期改写；提议内容不可变，仅 pending 可一次关闭；决定者不能是提议者本人（withdrawn 除外）；提议 slot 必属本 consultant。

索引：(appointment_id,proposal_no)；(expires_at) WHERE status=pending。

复合关系使用的完整唯一键：UNIQUE(appointment_id,id)。

权限：限本人申请与分配的有效咨询人员；状态由有权限的接口和到期任务维护。

删除／留存：随专业服务资料政策协调处理；不级联消失未完成通知和清理事实。

### applications

**扩展 · M3。** 申请仍是服务关系根；不让房间成员资格自动变成咨询资料授权。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `origin_conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `profile_version` | `integer` | 是 | 无 | 申请时展示的服务资料版本 |
| `service_profile_snapshot` | `jsonb` | 是 | 无 | 已核对的资质摘要、方式和费用，非证件原件 JSON：`ServiceProfileSnapshot`（v1）。 |
| `revision` | `integer` | 否 | 1 |  |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：沿用 id/client_id/事件/申请人/咨询方/status；UNIQUE(id,event_id,applicant_id)及(id,consultant_id,applicant_id)供复合 FK；时间字段切换后由 appointments 投影，shared_summary 迁往具体 share_grants；不可双写两种事实源。

索引：保留 event 索引；(consultant_id,status,created_at DESC)；(applicant_id,created_at DESC)。

复合关系使用的完整唯一键：UNIQUE(id,consultant_id,applicant_id)；UNIQUE(id,event_id,applicant_id)。

组合外键 `fk_application_origin_event`：(event_id,origin_conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_application_origin_owner`：(origin_conversation_id,applicant_id) → conversations(id,owner_user_id)；ON DELETE RESTRICT；即时检查。

权限：申请人和分配的有效服务方；无分享也可申请，服务方仅见最少必要联系与获准资料。

删除／留存：取消撤回相应用途授权；清理事件前按合法留存判断服务记录，不默认所有医疗记录必须永久保留。

### consultation_notes

**扩展 · M3。** 保留每申请一个纪要根，正文和可见性按 record_versions 冻结。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。目标状态必填；仅 expand/backfill 期间临时允许 NULL，核对归属后加 NOT NULL |
| `current_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。 |
| `record_state` | `text` | 否 | draft | draft / signed / corrected / erased；仅根当前版本状态投影，不能覆盖历史签署 |
| `signed_at` | `timestamptz` | 是 | 无 | 仅当前版本签署时间的兼容投影；权威签署事实在 record_versions 三列；不向全部历史版本复制 |
| `retention_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |

约束：沿用 application_id PK；UNIQUE(conversation_id,application_id)；归属对应 professional 会话；签署版本不得原地修改，修正新增版本；原 content/client_visible/version 仅兼容投影。

索引：按 application PK；(record_state,updated_at)仅专业端需要时使用。

复合关系使用的完整唯一键：UNIQUE(conversation_id,application_id)。

组合外键 `fk_current_note_application_id`：(conversation_id,application_id,current_record_version_id) → record_versions(conversation_id,note_application_id,id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

组合外键 `fk_note_application_conversation`：(application_id,conversation_id) → conversations(application_id,id)；ON DELETE RESTRICT；即时检查。

权限：分配的有效专业方；本人仅见该具体开放版本；房间仍要独立 snapshot+grant。

删除／留存：没有批准的保留例外时随用户请求清理；确需保留者进入独立受控档案和 retention_holds，不靠事件级联悄悄保留或误删。

### followups

**扩展 · M2。** 延用私人回访，补足实际行动结果与自愿提醒条件。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。目标状态必填；仅 expand/backfill 期间临时允许 NULL，核对归属后加 NOT NULL |
| `exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。 |
| `action_status` | `text` | 否 | unknown | unknown / planned / attempted / not_attempted / declined |
| `outcome` | `jsonb` | 是 | 无 | 本人报告的变化／障碍，不等于客观临床效果 JSON：`FollowupOutcome`（v1）。 |
| `reminder_opt_in` | `boolean` | 否 | false |  |
| `reminder_consent_grant_id` | `uuid` | 是 | 无 | → `consent_grants.id`。 |
| `revision` | `integer` | 否 | 1 |  |
| `action_occurred_at` | `timestamptz` | 是 | 无 | 本人报告的实际行动时间；未知可空，不用 reviewed_at 代替 |
| `outcome_reported_at` | `timestamptz` | 是 | 无 | 本次 outcome 实际提交时间，旧未知可空 |
| `outcome_schema_version` | `integer` | 否 | 1 |  |
| `source_record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。创建时冻结同 private 会话的确切行动版本；exercise_id 非空时必须同时配对其根，不随 current 指针移动 |
| `source_snapshot_id` | `uuid` | 是 | 无 | → `share_snapshots.id`。共同约定/跨域资料使用获准冻结快照，与 source_grant_id 成对；不直接读取房间或他人私聊 |
| `source_grant_id` | `uuid` | 是 | 无 | → `share_grants.id`。同时绑定目标 conversation、snapshot 和 followups.user_id；每次使用复验 read/use_in_agent、用途 action_followup、撤回/过期与范围 |
| `source_invalidated_at` | `timestamptz` | 是 | 无 | 来源失效时间；撤回/擦除/权限失效立即标记并停止提醒/上下文；受控擦除后保留该时间，不能伪装无来源回访 |

约束：保留 id/user/event/日期；user 匹配 private 所有者；exercise 同 conversation；未 opt_in 不建站外通知；reviewed_at 不等于已发送提醒或实际改善；未报告时 outcome/outcome_reported_at 都为空；本人提交后两者同时非空，action_occurred_at 为可空真实发生时间；outcome.user_reported=true 不是效果认证；来源三选一：无来源自由回访 / 同域确切版本 / 快照+授权；禁止混合；有来源时 conversation 必填，exercise_id 非空时须配对确切练习版本；来源引用创建后不可重指；改行动新建回访。snapshot 路径必须是授权范围内的共同约定/行动摘要，授权接收人=user_id；不能借 snapshot 的存在绕过当前许可；撤回/失效时标 source_invalidated_at 并取消待发提醒、剔除派生上下文和私有副本；受控擦除可清空源引用/内容/exercise_id，保留 invalidated_at 和最小审计；新建/普通更新不能写 invalidated_at 绕过完整来源配对。

索引：保留事件和用户索引；(review_at) WHERE reviewed_at IS NULL AND reminder_opt_in；(source_record_version_id) WHERE source_record_version_id IS NOT NULL；(source_snapshot_id,source_grant_id) WHERE source_snapshot_id IS NOT NULL：来源撤回/擦除依赖查找。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_followup_event`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_followup_owner`：(conversation_id,user_id) → conversations(id,owner_user_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_followup_exercise`：(conversation_id,exercise_id) → exercises(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_followup_source_version`：(conversation_id,source_record_version_id) → record_versions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_followup_exercise_version`：(conversation_id,exercise_id,source_record_version_id) → record_versions(conversation_id,exercise_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_followup_source_grant`：(conversation_id,source_grant_id,source_snapshot_id) → share_grants(target_conversation_id,id,snapshot_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_followup_source_recipient`：(source_grant_id,source_snapshot_id,user_id) → share_grants(id,snapshot_id,recipient_id)；ON DELETE RESTRICT；即时检查。

权限：仅本人，私聊获准上下文按摘要使用。

删除／留存：按本人删除；撤回提醒关闭未发送 outbox，但保留本人选择保存的回访直到相应删除。

### notification_outbox

**新增 · M3。** 事务性通知请求，投递交给现有 pg-boss；不是又建一个队列系统。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `recipient_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `resource_id` | `uuid` | 是 | 无 | → `support_resources.id`。 |
| `conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `handoff_id` | `uuid` | 是 | 无 | → `support_handoffs.id`。 |
| `purpose_code` | `text` | 否 | 无 |  |
| `channel` | `text` | 否 | 无 | in_app / email / sms / push / provider |
| `template_key` | `text` | 否 | 无 |  |
| `template_version` | `text` | 否 | 无 |  |
| `payload` | `jsonb` | 否 | 无 | 仅业务 ID 与最少展示参数，不放私人正文或凭据 JSON：`NotificationPayload`（v1）。 |
| `idempotency_key` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | pending | pending / processing / accepted / delivered / failed / unknown / cancelled；unknown 不盲目重发 |
| `attempt_count` | `integer` | 否 | 0 | 实际逻辑 dispatch 数的缓存，权威来源 notification_attempts；不把 HTTP 重试算新通知 |
| `next_attempt_at` | `timestamptz` | 是 | 无 |  |
| `lease_until` | `timestamptz` | 是 | 无 |  |
| `last_error_code` | `text` | 是 | 无 |  |
| `accepted_at` | `timestamptz` | 是 | 无 |  |
| `delivered_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |
| `cancel_requested_at` | `timestamptz` | 是 | 无 | 撤权/擦除要求停止后续派发的时间，不否认已发生送达 |
| `cancel_reason_code` | `text` | 是 | 无 |  |
| `appointment_id` | `uuid` | 是 | 无 | → `appointments.id`。payload.type 对应的真实业务目标；不能仅信任 JSON 中的 ID；conversation_id 只作配对上下文 |
| `appointment_proposal_id` | `uuid` | 是 | 无 | → `appointment_proposals.id`。payload.type 对应的真实业务目标；不能仅信任 JSON 中的 ID；conversation_id 只作配对上下文 |
| `followup_id` | `uuid` | 是 | 无 | → `followups.id`。payload.type 对应的真实业务目标；不能仅信任 JSON 中的 ID；conversation_id 只作配对上下文 |
| `data_request_id` | `uuid` | 是 | 无 | → `data_requests.id`。payload.type 对应的真实业务目标；不能仅信任 JSON 中的 ID；conversation_id 只作配对上下文 |

约束：PK(id)；UNIQUE(idempotency_key)；user/resource 恰一目标；payload/template 首个 attempt 准备后不可变；业务+outbox+队列同事务；attempt_count/last_error 是派生缓存；accepted/delivered 从经验证 attempt/receipt 聚合；任一真实 delivered 不被较旧失败回执倒退；撤销中在途送达仍如实记录；发前复验用途和资格；cancel_requested_at 后不得新 dispatch，已有在途不能宣称成功取消；unknown 按通道查询/幂等/人工核对，不自动新键重发；邀请链接不通过此表储存或恢复 bearer token；payload.type=appointment/handoff/followup/data_request 时对应真实目标列必填，其他业务目标列为空；appointment_proposal_id 仅 appointment 可填且属于该预约；room_activity 只需真实 room conversation；payload 里的 ID/时间/状态必须与冻结业务事实一致；appointment proposal 配对使用(appointment_id,appointment_proposal_id)组合 FK；followup 以(conversation_id,followup_id)配对；向 recipient/resource 通知的资格与目的仍须事务复验，不能用 JSON ID 自授权；followup_id 非空时 conversation_id 必非空，避免 MATCH SIMPLE 在 NULL 会话时跳过组合 FK；room_activity 的 conversation_id 同样必填。

索引：(status,next_attempt_at) WHERE status IN pending/failed；(recipient_user_id,created_at DESC)。

组合外键 `fk_notification_appointment_proposal`：(appointment_id,appointment_proposal_id) → appointment_proposals(appointment_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_notification_followup`：(conversation_id,followup_id) → followups(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_notification_handoff_conversation`：(conversation_id,handoff_id) → support_handoffs(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_notification_handoff_resource`：(handoff_id,resource_id) → support_handoffs(id,resource_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_notification_handoff_recipient`：(handoff_id,recipient_user_id) → support_handoffs(id,receiver_user_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_notification_request_conversation`：(conversation_id,data_request_id) → data_requests(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：普通用户只见本人送达状态；外部收件地址通过核验目录或认证资料按用途取，不由模型指定。

删除／留存：撤权／取消／删除使未发通知取消；供应商 ID 与失败原因按期限清理。

### notification_attempts

**新增 · M3。** 每次真实通道派发及幂等键、供应商、结果；传输重试复用同一次派发。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `outbox_id` | `uuid` | 否 | 无 | → `notification_outbox.id`。 |
| `attempt_no` | `integer` | 否 | 无 |  |
| `provider_code` | `text` | 否 | 无 |  |
| `provider_request_key` | `text` | 否 | 无 | 在调用前持久化；同一次未知结果的网络重试复用 |
| `request_sha256` | `char(64)` | 否 | 无 | 模板/版本/最少 payload/目标指纹的稳定摘要 |
| `destination_fingerprint` | `char(64)` | 否 | 无 | 密钥化目标指纹；不存收件原地址 |
| `status` | `text` | 否 | prepared | prepared / dispatching / accepted / delivered / failed / unknown / cancelled |
| `transport_retry_count` | `integer` | 否 | 0 |  |
| `provider_message_id` | `text` | 是 | 无 |  |
| `started_at` | `timestamptz` | 是 | 无 |  |
| `finished_at` | `timestamptz` | 是 | 无 |  |
| `accepted_at` | `timestamptz` | 是 | 无 |  |
| `delivered_at` | `timestamptz` | 是 | 无 |  |
| `error_code` | `text` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(outbox_id,attempt_no)；UNIQUE(provider_code,provider_request_key)；UNIQUE(provider_code,provider_message_id) WHERE provider_message_id IS NOT NULL；次数非负/序号正数；provider/key/request_sha256/destination 首次 dispatch 后不可变；未知结果优先查询或同键重试；供应商无幂等保障则 unknown 待人工，不以自动新 attempt 假装安全；重试前目标指纹变更须停止核对，不能旧键改发另一个目标；状态 accepted 非人工接收，delivered 可由真实晚到回执纠正 unknown/failed；仅确证无送达且政策准许时才创建新 attempt；prepared/dispatching 尚无最终 finish；终态观测有 finished_at（unknown 表示本次调用结束但结果未明）；delivered 必有 delivered_at；上游仅 accepted 不虚构 delivered_at。

索引：(outbox_id,attempt_no)；(provider_code,provider_message_id)。

复合关系使用的完整唯一键：UNIQUE(provider_code,id,provider_request_key)；UNIQUE(provider_code,id,provider_message_id)。

权限：仅投递服务和对应受限运营；用户只读脱敏聚合状态。

删除／留存：删除正文/地址后保留去内容幂等/回执证据至已审期限，避免重复投递；不存 token/Cookie/API key。

### notification_receipts

**新增 · M3。** 每个经验签回执单独保存；提前、重复、乱序回执可关联与去重。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `provider_code` | `text` | 否 | 无 |  |
| `provider_event_id` | `text` | 是 | 无 |  |
| `dedupe_key` | `text` | 否 | 无 | 优先通道事件 ID，否则规范化事件摘要 |
| `attempt_id` | `uuid` | 是 | 无 | → `notification_attempts.id`。回执早于同步 API 响应时先空，稍后按同供应商标识关联 |
| `provider_message_id` | `text` | 是 | 无 |  |
| `provider_request_key` | `text` | 是 | 无 |  |
| `correlation_status` | `text` | 否 | pending | pending / matched / rejected |
| `receipt_kind` | `text` | 否 | 无 | accepted / delivered / failed / undeliverable |
| `occurred_at` | `timestamptz` | 是 | 无 | 上游未给真实时间时为空，不用 received_at 冒充 |
| `received_at` | `timestamptz` | 否 | now() |  |
| `verified_at` | `timestamptz` | 否 | 无 |  |
| `payload_sha256` | `char(64)` | 否 | 无 | 验签原始载荷摘要，不保留敏感原载荷 |
| `normalized` | `jsonb` | 否 | 无 | 只存安全原因码、通道状态与传输耗时 JSON：`ReceiptNormalized`（v1）。 |

约束：PK(id)；UNIQUE(provider_code,dedupe_key)；provider_message_id/request_key 至少一个非空；matched 必有 attempt_id 且 provider 和至少一个可靠通道键配对，不允许两个键指向不同 attempt；无效签名只记拒绝审计，不记为业务回执；pending 不改变 outbox；后台对账再 matched；只允许关联状态修正，回执内容不可改；同事件重复只返回同一回执；乱序聚合以真实 delivered 为不可降级事实；未匹配/被拒绝回执不得覆盖发送事实；取消请求不屏蔽已发生送达；matched 时按 provider_code+provider_request_key/message_id 事务核对；不得仅凭 attempt_id 单列合法就接受跨供应商回执；未匹配事实不可进入聚合；仅 matched 行保存 attempt_id；provider+attempt+request/message 两个复合 FK 分别检查有值的键，两个键同时提供时必须指向同一真实派发；pending/rejected 用 NULL 关联并保留最少拒绝审计。

索引：(provider_code,provider_message_id)；(received_at) WHERE correlation_status=pending。

组合外键 `fk_receipt_request_identity`：(provider_code,attempt_id,provider_request_key) → notification_attempts(provider_code,id,provider_request_key)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_receipt_message_identity`：(provider_code,attempt_id,provider_message_id) → notification_attempts(provider_code,id,provider_message_id)；ON DELETE RESTRICT；即时检查。

权限：仅验签入口、对账 Worker 和去内容审计职责；通道字段不是授权凭证。

删除／留存：依通知政策保留最少证据；清理不保留可重放的 bearer token。


## 09 安全、人工处理与审计

### safety_cases

**新增 · M1。** 持久风险处理状态；软件优先级不是临床诊断，阈值由经审政策决定。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `subject_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `priority_code` | `text` | 否 | unknown |  |
| `status` | `text` | 否 | open | open / assigned / handling / followup / resolved / closed_unreachable |
| `blocked_capabilities` | `text[]` | 否 | 无 |  |
| `source_message_id` | `bigint` | 是 | 无 | → `messages.id`。 |
| `source_decision_id` | `uuid` | 是 | 无 | → `agent_decisions.id`。 |
| `triage_summary` | `text` | 是 | 无 |  |
| `assigned_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `review_due_at` | `timestamptz` | 是 | 无 |  |
| `resolution_code` | `text` | 是 | 无 |  |
| `resolved_by` | `text` | 是 | 无 | → `user.id`。 |
| `resolved_at` | `timestamptz` | 是 | 无 |  |
| `revision` | `integer` | 否 | 1 |  |
| `opened_at` | `timestamptz` | 否 | now() |  |
| `updated_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；来源同会话；优先级／解除权限按 policy；同 subject+conversation 同时最多一个未关闭 case（NULL subject 用 NULLS NOT DISTINCT 语义）；普通用户或主模型不能直接解除阻断。

索引：(status,priority_code,review_due_at)；(assigned_user_id,status)；(conversation_id,opened_at DESC)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_safety_source_message`：(conversation_id,source_message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_safety_source_decision`：(conversation_id,source_decision_id) → agent_decisions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：仅被分配且职责有效的安全人员；向用户显示必要处理状态；监护关系不授予安全档案读取。

删除／留存：按安全留存政策及最小必要处理；没有政策依据不能永久保存原话；关闭不等于已经获救或完成医疗治疗。

### support_handoffs

**新增 · M1。** 真实转介每次尝试及接收确认，与普通咨询申请分开。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `safety_case_id` | `uuid` | 是 | 无 | → `safety_cases.id`。 |
| `conversation_id` | `uuid` | 否 | 无 | → `conversations.id`。 |
| `resource_id` | `uuid` | 是 | 无 | → `support_resources.id`。 |
| `receiver_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `scope_snapshot_id` | `uuid` | 是 | 无 | → `share_snapshots.id`。 |
| `authorization_grant_id` | `uuid` | 是 | 无 | → `share_grants.id`。 |
| `emergency_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。例外披露须具体经审规则，不假造普通同意 |
| `status` | `text` | 否 | requested | requested / acknowledged / accepted / declined / unreachable / completed / cancelled |
| `requested_by` | `text` | 是 | 无 | → `user.id`。 |
| `request_id` | `uuid` | 否 | 无 |  |
| `due_at` | `timestamptz` | 是 | 无 |  |
| `acknowledged_at` | `timestamptz` | 是 | 无 |  |
| `accepted_at` | `timestamptz` | 是 | 无 |  |
| `closed_at` | `timestamptz` | 是 | 无 |  |
| `outcome_code` | `text` | 是 | 无 |  |
| `revision` | `integer` | 否 | 1 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `acknowledgement_audit_event_id` | `uuid` | 是 | 无 | → `audit_events.id`。真实接收方已读确认审计，非通知送达；与 handoff 同会话，核对 actor/action/resource/revision |
| `acceptance_audit_event_id` | `uuid` | 是 | 无 | → `audit_events.id`。真实接收方接管确认审计；只设置 accepted_at 不足以证明已接通 |
| `closure_audit_event_id` | `uuid` | 是 | 无 | → `audit_events.id`。完成、拒绝、未接通或取消的实际状态审计；不因派发成功自动完成接管 |

约束：PK(id)；resource/receiver 恰一目标；UNIQUE(conversation_id,request_id)；公开显示已接收须有真实接收方确认；披露正文必须对应 scope+授权或已审例外；case 同 conversation；acknowledged/accepted/终止状态须配对实际 audit_event 与时间；审计须同 conversation、同 handoff resource_reference、对应 handoff_transition/to_state/revision。user 确认须为接收方，external_receiver 必须经真实通道认证；service 的通知回执不能冒充接收或接管。。

索引：(status,due_at)；(safety_case_id,created_at DESC)；(receiver_user_id,status)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)；UNIQUE(id,resource_id)；UNIQUE(id,receiver_user_id)。

组合外键 `fk_handoff_case_conversation`：(conversation_id,safety_case_id) → safety_cases(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_handoff_disclosure_recipient`：(authorization_grant_id,scope_snapshot_id,receiver_user_id) → share_grants(id,snapshot_id,recipient_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_handoff_acknowledgement`：(conversation_id,acknowledgement_audit_event_id) → audit_events(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_handoff_acceptance`：(conversation_id,acceptance_audit_event_id) → audit_events(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_handoff_closure`：(conversation_id,closure_audit_event_id) → audit_events(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：分配的接收方仅见获准最少快照；创建者不能替接收方确认接收。

删除／留存：未接通有回退和升级，不自动转家长；删除按已审安全记录策略清理。

### support_resources

**新增 · M1。** 核验过的地区支持资源版本；不预填未经本轮确认的电话号码或承诺。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `resource_key` | `text` | 否 | 无 |  |
| `version` | `integer` | 否 | 无 |  |
| `resource_type` | `text` | 否 | 无 | campus / counseling / medical / crisis / community |
| `name` | `text` | 否 | 无 |  |
| `region_codes` | `text[]` | 否 | 无 |  |
| `languages` | `text[]` | 否 | 无 |  |
| `age_requirements` | `jsonb` | 否 | 无 |  JSON：`AgeRequirements`（v1）。 |
| `public_contacts` | `jsonb` | 否 | 无 | 官方地址、电话、预约渠道，无 API 凭据 JSON：`PublicContacts`（v1）。 |
| `service_hours` | `jsonb` | 否 | 无 |  JSON：`ServiceHours`（v1）。 |
| `timezone` | `text` | 否 | 无 |  |
| `official_source_url` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | pending | pending / verified / withdrawn / stale |
| `verified_by` | `text` | 是 | 无 | → `user.id`。 |
| `verified_at` | `timestamptz` | 是 | 无 |  |
| `recheck_after` | `timestamptz` | 是 | 无 |  |
| `evidence_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(resource_key,version)；已核验内容改版新增版本；过复核期限不保证继续有效；contact 与用途在发送端再次核对。

索引：GIN(region_codes)；(resource_type,status,recheck_after)。

权限：公开仅核验过的服务摘要；核验凭据限工作人员。

删除／留存：停用阻止新推荐；历史 handoff 引用原版本，不因当前目录更新而改写当时渠道。

### staff_assignments

**新增 · M1。** 有限职责授予，不建设通用权限表达式或角色继承平台。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `user_id` | `text` | 否 | 无 | → `user.id`。 |
| `role_code` | `text` | 否 | 无 | operator / safety_responder / method_reviewer / data_reviewer / service_verifier |
| `region_codes` | `text[]` | 否 | ARRAY[]::text[] |  |
| `credential_id` | `uuid` | 是 | 无 | → `professional_credentials.id`。 |
| `granted_by` | `text` | 否 | 无 | → `user.id`。 |
| `valid_from` | `timestamptz` | 否 | 无 |  |
| `valid_until` | `timestamptz` | 是 | 无 |  |
| `revoked_by` | `text` | 是 | 无 | → `user.id`。 |
| `revoked_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；有效期顺序；不可自行授予；凭证主体匹配；具有角色不等于能读任意私人会话，还需案件分配／业务授权。

索引：(user_id,role_code) WHERE revoked_at IS NULL。

组合外键 `fk_staff_credential_subject`：(user_id,credential_id) → professional_credentials(subject_user_id,id)；ON DELETE RESTRICT；即时检查。

权限：仅受权管理方维护；普通客户端无新增／修改权限。

删除／留存：撤销立即生效并使有关处理会话权限失效；历史记录按最少审计留存。

### audit_events

**新增 · M1。** 跨事件的去内容操作审计，覆盖敏感读取、授权、审核、接管、配置和状态变更。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `actor_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `actor_kind` | `text` | 否 | 无 | user / service / external_receiver |
| `actor_role_code` | `text` | 是 | 无 |  |
| `subject_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `action_code` | `text` | 否 | 无 |  |
| `resource_type` | `text` | 否 | 无 |  |
| `resource_reference` | `text` | 否 | 无 | 定位用，不作为业务外键或权限依据 |
| `purpose_code` | `text` | 否 | 无 |  |
| `reason_code` | `text` | 否 | 无 |  |
| `outcome` | `text` | 否 | 无 | allowed / denied / succeeded / failed |
| `policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `request_id` | `uuid` | 是 | 无 |  |
| `metadata` | `jsonb` | 否 | 无 | 错误码、版本、耗时等白名单，无正文、音频、证件、Cookie、令牌或推理 JSON：`AuditMetadata`（v1）。 |
| `retention_until` | `timestamptz` | 是 | 无 |  |
| `occurred_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；普通角色只能追加，不能修改既有事件；resource_reference 可在源删除后保留去内容定位，不以它判断资料存在或访问权；过期清理由独立职责执行。

索引：(actor_user_id,occurred_at DESC)；(subject_user_id,occurred_at DESC)；(action_code,occurred_at DESC)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

权限：专门审计职责；工作人员读取敏感资料必须有已分配业务理由且先写访问记录。

删除／留存：按已审期限清理或去标识；审计不是“永久保留全部私人内容”的例外。


## 10 文件、留存与资料请求

### data_requests

**新增 · M1。** 本人／合法代表的导出、纠正和删除请求及可核验处理结果。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `requester_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `requester_participant_id` | `uuid` | 是 | 无 | → `research_participants.id`。外部研究请求者的真实研究主体；与 participant_id 目标分开，不能用所请求对象冒充请求者；合法去身份后可空且不可重放 |
| `subject_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `request_type` | `text` | 否 | 无 | export / erase / rectify / restrict |
| `scope_kind` | `text` | 否 | 无 | account / event / conversation / research_participant / understanding / record_version / assessment_session / exercise / message / corpus_asset |
| `event_id` | `uuid` | 是 | 无 | → `events.id`。 |
| `conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `participant_id` | `uuid` | 是 | 无 | → `research_participants.id`。 |
| `status` | `text` | 否 | requested | requested / identity_verified / processing / completed / partial / rejected / failed |
| `request_id` | `uuid` | 否 | 无 |  |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `due_at` | `timestamptz` | 是 | 无 |  |
| `result_file_id` | `uuid` | 是 | 无 | → `file_objects.id`。 |
| `result_summary` | `jsonb` | 否 | 无 | 仅范围、结果和未完成原因，无被删除原文 JSON：`DataRequestSummary`（v2）。 旧版本只读：1。 |
| `requested_at` | `timestamptz` | 否 | now() |  |
| `completed_at` | `timestamptz` | 是 | 无 |  |
| `understanding_id` | `uuid` | 是 | 无 | → `understandings.id`。scope 对应真实目标；event/conversation 为配对上下文；完成擦除后可清空 |
| `record_version_id` | `uuid` | 是 | 无 | → `record_versions.id`。scope 对应真实目标；event/conversation 为配对上下文；完成擦除后可清空 |
| `assessment_session_id` | `uuid` | 是 | 无 | → `assessment_sessions.id`。scope 对应真实目标；event/conversation 为配对上下文；完成擦除后可清空 |
| `exercise_id` | `uuid` | 是 | 无 | → `exercises.id`。scope 对应真实目标；event/conversation 为配对上下文；完成擦除后可清空 |
| `message_id` | `bigint` | 是 | 无 | → `messages.id`。scope 对应真实目标；event/conversation 为配对上下文；完成擦除后可清空 |
| `corpus_asset_id` | `uuid` | 是 | 无 | → `corpus_assets.id`。scope 对应真实目标；event/conversation 为配对上下文；完成擦除后可清空 |
| `recorded_by` | `text` | 是 | 无 | → `user.id`。实际登记请求的服务／员工；不冒充外部请求者 |
| `requester_kind` | `text` | 否 | user | user / verified_representative / research_participant |
| `verification_evidence_sha256` | `char(64)` | 是 | 无 | 代表资格／外部身份核验材料摘要，不存原证件 |
| `request_payload_schema_version` | `integer` | 否 | 2 |  |
| `requested_changes` | `jsonb` | 否 | 无 | type 与 request_type 配对；rectify 区分 record（版本/路径）、assessment（revision/新 session）、message（哈希/追加更正），不原地改历史 JSON：`RequestedChanges`（v2）。 旧版本只读：1。 |
| `target_manifest` | `jsonb` | 是 | 无 | 服务端冻结最少目标 ID、版本及哈希；用于擦除后追踪，不代替实际 FK 权限 JSON：`TargetManifest`（v2）。 旧版本只读：1。 |
| `target_erased_at` | `timestamptz` | 是 | 无 | 在锁请求并完成根目标擦除的同一事务设置；之后不再次执行 |

约束：PK(id)；UNIQUE(request_id)（含 requester 已去标识情形）；重放还须核对同一已核验请求者和 payload；target_erased_at 为空且 requester_kind=user 时必有 requester_user_id；完成合法去标识后允许 NULL，不可重新执行；代表／研究外部请求须核验证据；擦除前按 scope_kind 恰一真实目标：account→subject_user_id；event→event_id；conversation→conversation_id；research_participant→participant_id；其余→同名目标列；细粒度请求的 event/conversation 只能作该目标配对上下文，不能扩大范围；requested_changes.type 与 request_type 匹配；rectify 只允许对应业务可修正字段，expected_record_version_id 必属目标；生成新版本而非改历史／同意／审计；首次执行前 target_manifest 冻结目标、版本、摘要；授权按真实 FK／本人或代表资格验证；target_erased_at 非空时对应目标 FK 可全部 NULL，清理与置空同事务，状态只能 partial/completed 且不得再执行；没有此标记不能提前清空；跨期可空 FK 随被引用表上线建立；外部核验记录不授予任意研究内容访问权；结果仅去内容信息；物理账户擦除后主体 FK 可置空但不得改变已冻结请求范围；requested_changes=rectify 时 target_kind=record 仅 understanding/record_version/exercise，assessment 仅 assessment_session 并新建替代 session，message 仅本人原话且 append_correction；其他 scope 的纠正须新增经审专用契约，不接受任意路径；未核验请求允许 target_manifest 为空；进入 processing 前冻结并必填，之后不可修改；纠正 record 路径必须与实际 content.type 匹配，禁止写 provenance/author/consent/审计；申请人不能改对方消息；requester_participant_id 只表示外部请求者，participant_id 仍为目标；research_participant 请求者在未擦除时必有真实 actor 引用，私有用户作用域不能由研究主体自授权；请求者和目标的当前资格分别核验。

索引：(subject_user_id,requested_at DESC)；(status,due_at)。

复合关系使用的完整唯一键：UNIQUE(conversation_id,id)。

组合外键 `fk_request_conversation_event`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_request_understanding_scope`：(conversation_id,understanding_id) → understandings(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_request_record_scope`：(conversation_id,record_version_id) → record_versions(conversation_id,id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_request_message_scope`：(conversation_id,message_id) → messages(conversation_id,id)；ON DELETE RESTRICT；即时检查。

权限：本人只见自己请求结果；导出包按请求人可见范围生成，事件 owner 不导出家长 private 或专家未开放草稿。

删除／留存：请求结果有短保留期；导出包到期清理；completed 需所有必须任务已完成或明确合法例外。

### data_request_items

**新增 · M1。** 追踪数据库、文件、供应商和备份各处的实际清理／导出结果。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `data_request_id` | `uuid` | 否 | 无 | → `data_requests.id`。 |
| `system_code` | `text` | 否 | 无 | postgres / object_store / model_provider / asr_provider / backup |
| `resource_category` | `text` | 否 | 无 |  |
| `opaque_reference` | `text` | 是 | 无 | 受控内部定位，不放原文或可直接访问的 URL |
| `operation` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | pending | pending / processing / completed / restricted / expires_later / failed / unavailable |
| `attempt_count` | `integer` | 否 | 0 |  |
| `not_before` | `timestamptz` | 是 | 无 |  |
| `completed_at` | `timestamptz` | 是 | 无 |  |
| `evidence` | `jsonb` | 否 | 无 | 回执、计数、证明哈希、到期日 JSON：`DataRequestEvidence`（v1）。 |
| `error_code` | `text` | 是 | 无 |  |
| `resource_key` | `text` | 否 | 无 | 后端按系统与确切对象/版本/备份批次生成的稳定去内容键；不是权限凭据 |

约束：PK(id)；UNIQUE(data_request_id,system_code,resource_key,operation)；相同类别的两文件／版本各有一项，不再互相覆盖；resource_key、resource_category、opaque_reference 在首次执行冻结；每项关联 target_manifest 的具体对象或其经授权派生；opaque_reference 只给处理职责且按政策清理；不能将“上游无删除接口”或“尚在备份保留期”标成已删除；evidence 有 schema；按真实完成／失败／延期回执聚合父请求状态。

索引：(data_request_id,status)；(status,not_before)。

权限：资料处理职责；普通模型和房间成员不可读。

删除／留存：完成后保留最少证明到批准期限；定位符也随处理结束去标识。

### retention_holds

**新增 · M3。** 仅登记有具体政策依据的受控保留例外，不在事件正文上做无限期软删除。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `archive_file_id` | `uuid` | 否 | 无 | → `file_objects.id`。 |
| `data_request_id` | `uuid` | 是 | 无 | → `data_requests.id`。 |
| `policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `custodian_user_id` | `text` | 否 | 无 | → `user.id`。 |
| `reason_code` | `text` | 否 | 无 |  |
| `scope_manifest` | `jsonb` | 否 | 无 | 精确字段／版本与最少关联；非整事件默认全留 JSON：`RetentionScope`（v1）。 |
| `retain_until` | `timestamptz` | 否 | 无 |  |
| `review_at` | `timestamptz` | 否 | 无 |  |
| `approved_by` | `text` | 否 | 无 | → `user.id`。 |
| `released_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；保留结束、复核时间合理；仅批准后建立；档案和普通用户事件解耦，不能因旧 CASCADE 丢失保留记录；没有已审依据不启用。

索引：(released_at,review_at)；(archive_file_id)。

权限：仅有职责的保管人；不再供普通 Agent／运营浏览使用。

删除／留存：到期复核解除并销毁档案；原业务正文按请求清理；保留例外不替代用户解释和结果告知。

### file_objects

**新增 · M1。** 文件内容留在受控对象存储，数据库存元数据、用途、摘要和清理状态。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `owner_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `classification` | `text` | 否 | 无 | private / research_raw / research_deidentified / licensed / public_asset / retained_archive |
| `purpose_code` | `text` | 否 | 无 |  |
| `storage_key` | `text` | 否 | 无 |  |
| `mime_type` | `text` | 否 | 无 |  |
| `byte_size` | `bigint` | 否 | 无 |  |
| `sha256` | `char(64)` | 否 | 无 |  |
| `encryption_key_reference` | `text` | 是 | 无 | 仅密钥标识，不存密钥 |
| `status` | `text` | 否 | quarantined | quarantined / ready / deleting / deleted / failed |
| `retention_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `retention_until` | `timestamptz` | 是 | 无 |  |
| `verified_at` | `timestamptz` | 是 | 无 |  |
| `deleted_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(storage_key)；byte_size≥0；私有访问由来源业务和用途校验，owner 为 NULL 不等于公共；不存永久带凭据 URL。

索引：(owner_user_id,created_at DESC)；(status,retention_until)。

复合关系使用的完整唯一键：UNIQUE(id,sha256)。

权限：通过授权后短时访问；原始访谈、证明和档案不对普通 API／Worker 授予整表内容读取。

删除／留存：擦除需真实对象回执并清理派生；同一文件被合法多方引用时逐条检查权利与保留，不凭 SHA 相同合并所有权。


## 11 研究资料与决策评测

### research_participants

**新增 · M4。** 独立研究参与者及防泄漏分组；不要求有产品账号，也不保存真实姓名／电话。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `participant_code` | `text` | 否 | 无 |  |
| `leakage_group_id` | `uuid` | 否 | 无 | 同人复访、有关联家庭材料与衍生反事实共用分组 |
| `age_band_code` | `text` | 是 | 无 |  |
| `age_basis` | `text` | 是 | 无 |  |
| `status` | `text` | 否 | pending | pending / authorized / withdrawn / erased |
| `authorization_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(participant_code)；code 不能编码姓名／手机号；匿名化不等于授权，实际用途查 consent_grants。

索引：(leakage_group_id)。

权限：研究／数据审核职责；不能从普通用户接口遍历。

删除／留存：撤回定位其访谈、案例、数据集与派生副本；必要去内容撤回台账另留，不能继续训练或路演。

### research_sessions

**新增 · M4。** 一次真实访谈，与参与者人数、文件份数和时长分开计数。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `participant_id` | `uuid` | 否 | 无 | → `research_participants.id`。主要受访对象／索引；不是完整授权主体集；须同时在 research_session_participants 中登记 |
| `session_kind` | `text` | 否 | unknown | initial / followup / unknown |
| `occurred_at` | `timestamptz` | 是 | 无 |  |
| `duration_seconds` | `integer` | 是 | 无 |  |
| `duration_basis` | `text` | 否 | unknown | unknown / stated / media_verified |
| `source_label` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | registered | registered / authorization_pending / usable / withdrawn / erased |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(participant_id,id)；duration≥0；没有音频或时间证据不标 media_verified；一次访谈的音频和转写不是两次访谈；被经审素材引用后，旧素材的受访主体/角色/主对象由 corpus_asset_participants 冻结，不原地改；若当前主要索引/清单有误，先撤回受影响派生，再受控修正当前索引和创建新素材版本，不复制通话根/时长；完整主体集由 research_session_participants 表达；主要对象必须为成员；使用/撤回检查所有祖先通话的全部主体，未知主体或不完整清单不放行；统计时长按唯一 session.id 求和。

索引：(participant_id,occurred_at,id)。

复合关系使用的完整唯一键：UNIQUE(participant_id,id)。

组合外键 `fk_research_session_primary`：(id,participant_id) → research_session_participants(research_session_id,participant_id)；ON DELETE NO ACTION；DEFERRABLE INITIALLY DEFERRED。

权限：仅资料处理职责。

删除／留存：随参与者授权和删除处理；保留统计必须满足已批准的去标识方案。

### research_session_participants

**新增 · M4。** 一次研究通话的完整实际主体清单；授权与撤回按全部主体核对，通话根和时长不重复。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `research_session_id` | `uuid` | 否 | 无 | → `research_sessions.id`。 |
| `participant_id` | `uuid` | 否 | 无 | → `research_participants.id`。 |
| `role_code` | `text` | 否 | unknown | child / mother / father / guardian / other / unknown；角色不是授权 |
| `created_at` | `timestamptz` | 否 | now() |  |
| `status` | `text` | 否 | active | active / retracted；更正当前清单时可撤下错误登记，历史素材冻结关联保留，不能删除关联后伪造旧来源 |

约束：PK(research_session_id,participant_id)；UNIQUE(participant_id,research_session_id)；主 participant 必在此清单；同一真实通话只有一个 session 根；经审核可用前核实完整实际主体；每位主体分别核验用途、访谈范围、年龄和代表权限，不把角色或登记当同意；当前清单为 active 行；素材可用前冻结当时完整清单于 corpus_asset_participants。更正先撤回受影响素材/案例/数据集/评测，再更新当前清单及新建素材版本；旧冻结行及通话根不改，不重复通话/时长；可用前所有实际主体在同一当前 leakage_group 连通分量；发现跨组关联先使相关数据集/评测失效并重分组，不能只按主要对象定组；usable session 的主要 participant 必为 active；新素材只冻结当前全部 active 行；retracted 只保留历史，不供新素材继续选取。

索引：PK 覆盖按通话读取；反向 UNIQUE 覆盖按主体追溯授权和撤回。

复合关系使用的完整唯一键：UNIQUE(research_session_id,participant_id)；UNIQUE(participant_id,research_session_id)。

权限：仅资料处理职责。

删除／留存：撤回任一主体即沿全部 session 资产及派生闭包停止使用；擦除先处理同意/素材依赖，再按受控流程删除成员和通话根。

### corpus_assets

**新增 · M4。** 一次访谈的原文件／转写／脱敏版本及生成来源。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `research_session_id` | `uuid` | 是 | 无 | → `research_sessions.id`。session 范围必填；compiled 范围为空，访谈来源由 corpus_asset_sources 完整追溯 |
| `file_id` | `uuid` | 否 | 无 | → `file_objects.id`。 |
| `asset_kind` | `text` | 否 | 无 | audio / transcript / deidentified_transcript / compiled_deidentified |
| `version` | `integer` | 否 | 1 |  |
| `transform_version` | `text` | 是 | 无 |  |
| `deidentification_status` | `text` | 否 | not_reviewed | not_reviewed / processing / reviewed / rejected |
| `reviewed_by` | `text` | 是 | 无 | → `user.id`。 |
| `reviewed_at` | `timestamptz` | 是 | 无 |  |
| `status` | `text` | 否 | restricted | restricted / usable / withdrawn / erased |
| `content_sha256` | `char(64)` | 否 | 无 | 该确切 asset 文件原字节 SHA-256；与 file_objects.sha256 组合 FK 配对，不对原文件作归一化 |
| `sources_sha256` | `char(64)` | 是 | 无 | 素材/转换元数据、确切文件、corpus_asset_participants 的完整冻结主体/角色/主对象和全部父来源摘要的 JCS SHA-256；不得从当前 roster 重建旧版；摘要不代表当前授权 |
| `created_at` | `timestamptz` | 否 | now() |  |
| `asset_scope` | `text` | 否 | session | session / compiled；compiled 汇编须多源追溯 |

约束：PK(id)；session 对应 research_session_id 必填，compiled 对应 NULL 且 asset_kind=compiled_deidentified；session 内 UNIQUE(research_session_id,asset_kind,version)；compiled 以 id/内容哈希识别；corpus_asset_sources 是全部直接来源；原始资产没有来源；transcript/deidentified_transcript 必有来源，session 衍生的所有祖先均属于该 session；compiled 可以跨 session，至少两个直接来源；禁止有向环；进入案例须 deidentification_status=reviewed、审核材料完整、所有祖先主体对该用途有效授权；撤回沿来源闭包失效资产／案例／数据集及评测；可用前锁素材根和完整来源，核对 sources_sha256 后冻结文件/来源；改来源建新版本；许可撤回沿全部祖先/派生失效，摘要不授予访问；session 素材审核/可用前必须有完整 corpus_asset_participants 冻结清单及恰一个主要对象，须等于当时经核实的 active 通话清单；compiled 不建此类直接主体行，沿父资产逐一追溯；冻结行随素材不可修改，当前清单更正不改旧摘要输入。

索引：(research_session_id,asset_kind,version DESC)；(status,deidentification_status)。

复合关系使用的完整唯一键：UNIQUE(id,research_session_id)。

组合外键 `fk_asset_file_digest`：(file_id,content_sha256) → file_objects(id,sha256)；ON DELETE RESTRICT；即时检查。

权限：原文与脱敏稿分权；普通 Agent 不直接读研究原稿。

删除／留存：撤回沿 derived_from 追踪全部派生，清理对象与案例引用；不把文件放进应用静态资源。

### corpus_asset_participants

**新增 · M4。** 每个确切 session 素材版本的冻结主体/角色/主对象清单；重建历史摘要和反向撤回不依赖通话当前清单。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `asset_id` | `uuid` | 否 | 无 | → `corpus_assets.id`。 |
| `research_session_id` | `uuid` | 否 | 无 | → `research_session_participants.research_session_id`。同时与素材根及实际通话主体复合配对；compiled 不允许直接主体行 |
| `participant_id` | `uuid` | 否 | 无 | → `research_session_participants.participant_id`。冻结主体，关联记录可后来 retracted 但旧素材历史不改 |
| `role_code` | `text` | 否 | 无 | child / mother / father / guardian / other / unknown；保存审核该素材时的角色，不随当前角色修改 |
| `is_primary` | `boolean` | 否 | false | 本素材版本冻结的主要对象；session 素材审核/可用前恰一行 true |

约束：PK(asset_id,participant_id)；asset+session 与 session+participant 复合 FK；每 asset 至多一个 is_primary=true（部分唯一索引），可用前恰一在事务内验证；审核/可用时逐行核对完整 active 通话清单、角色、主要对象及真实审核，不能先漏主体后用摘要证明完整；冻结后不可增删改，纠错建立新 asset 版本；授权/撤回使用所有祖先素材的冻结清单；旧成员被 retracted 不能让旧素材忽略其同意/撤回；擦除先失效派生并处理合法留存，再受控清理来源和关联。

索引：PK 覆盖素材完整清单；(participant_id,research_session_id,asset_id) 支持所有历史来源反查；UNIQUE(asset_id) WHERE is_primary。

组合外键 `fk_asset_subject_session`：(asset_id,research_session_id) → corpus_assets(id,research_session_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_asset_subject_member`：(research_session_id,participant_id) → research_session_participants(research_session_id,participant_id)；ON DELETE RESTRICT；即时检查。

权限：原文与脱敏稿分权；普通 Agent 不直接读研究原稿。

删除／留存：随确切素材受控清理；删除会破坏旧摘要重建，必须先失效所有相关派生，不以重指当前通话清单补造历史。

### corpus_asset_sources

**新增 · M4。** 素材的多对多来源边，支持跨访谈汇编和反向撤回。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `asset_id` | `uuid` | 否 | 无 | → `corpus_assets.id`。 |
| `source_asset_id` | `uuid` | 否 | 无 | → `corpus_assets.id`。 |
| `ordinal` | `integer` | 否 | 无 | 正整数来源顺序 |
| `relation_code` | `text` | 否 | 无 | transcription / deidentification / compilation |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(asset_id,source_asset_id)；UNIQUE(asset_id,ordinal)；CHECK asset_id<>source_asset_id 且 ordinal>0；写入和发布须查全图无环；来源文件必须存在且用途许可、脱敏状态与目标步骤匹配；按 asset_id 排序加锁；来源被引用时 RESTRICT，撤回先失效闭包再协调清理。

索引：source_asset_id。

权限：仅研究资料职责；来源边不授予普通 Agent 访问研究文本。

删除／留存：不让删除来源悄悄断链；资料请求处理所有下游并保留去内容清理结果。

### decision_cases

**新增 · M4。** 不可变的场景题版本，区分真实观察、改写、反事实和纯合成。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `case_key` | `text` | 否 | 无 |  |
| `version` | `integer` | 否 | 无 |  |
| `case_type` | `text` | 否 | 无 | observed / adapted / counterfactual / synthetic |
| `derived_from_case_id` | `uuid` | 是 | 无 | → `decision_cases.id`。 |
| `leakage_group_id` | `uuid` | 否 | 无 |  |
| `scenario` | `jsonb` | 否 | 无 | 原生 v2 显式包含 actor（角色/研究主体）、current_input_origin、current_input_source_ordinals、authorized_context；可冻结 prior_state。来源按本 case_id 下真实 decision_case_sources.ordinal 配对，不伪造 UUID；模型输入不得读取 expected 的未来结果或其他主体私密内容 JSON：`CaseScenario`（v2）。 旧版本只读：1。 |
| `expected` | `jsonb` | 否 | 无 | 多个政策登记路由、可选 Skill 顺序、前置/转换条件、独立确认和禁止动作；支持意图、表达边界、拟议回复及冻结五维 dialogue_rubric 与未知校准阈值。拟议工具/回复不等于已实现、已执行或金标准；outcome_reference 单独区分观察/模拟/未知反馈及回访资料可用性，引用真实 case source ordinal，不注入模型输入 JSON：`CaseExpected`（v2）。 旧版本只读：1。 |
| `schema_version` | `integer` | 否 | 2 |  |
| `content_sha256` | `char(64)` | 否 | 无 | case_key/version/case_type/derived_from_case_id/leakage_group_id/scenario/expected/schema_version/agent_policy_version_id 九字段的 JCS SHA-256；不含审核状态/时间 |
| `sources_sha256` | `char(64)` | 是 | 无 | 批准时冻结确切父案正文/来源摘要和全部直接素材/定位/来源摘要；合成无源案例明确 parent=null、sources=[]，不冒充真实素材 |
| `status` | `text` | 否 | draft | draft / in_review / approved / withdrawn |
| `reviewed_by` | `text` | 是 | 无 | → `user.id`。 |
| `reviewer_credential_id` | `uuid` | 是 | 无 | → `professional_credentials.id`。 |
| `reviewed_at` | `timestamptz` | 是 | 无 |  |
| `review_note` | `text` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `agent_policy_version_id` | `uuid` | 是 | 无 | → `policy_versions.id`。期望规则代码有值时必须指定冻结规则集；通用人工原则可不绑定某版规则 |

约束：PK(id)；UNIQUE(case_key,version)；UNIQUE(id,leakage_group_id)；全部实际来源保存在 decision_case_sources；审核后题文／来源边不可改；observed/adapted 至少一个经审核来源；counterfactual 须明确标非真实并有父案例或来源；synthetic 不冒充观测，若参考真实资料仍登记全部来源；derived_from_case_id 不可形成环，表示改写／反事实父案；父案来源闭包与本案来源共同计算；相关参与者、家庭、所有多源祖先归同 leakage_group；新边连接旧组时使受影响已封版独立性结论失效，重分组重发布；批准时锁案例、完整来源和父案闭包，核对正文及 sources_sha256；已批准的内容/来源不原地改；合成/反事实明确标记且按全部来源闭包复核授权；scenario 的当前输入/上下文和 expected 的结果标签分别校验来源 ordinal、素材许可、主体及时间边界；来源表无独立 UUID，不编造 source_id；未来结果只能作 expected 标签，另一方私密内容不得因同案例被读入输入。

索引：(case_key,version DESC)；(leakage_group_id)。

复合关系使用的完整唯一键：UNIQUE(id,leakage_group_id)。

组合外键 `fk_case_parent_group`：(derived_from_case_id,leakage_group_id) → decision_cases(id,leakage_group_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_case_reviewer_subject`：(reviewed_by,reviewer_credential_id) → professional_credentials(subject_user_id,id)；ON DELETE RESTRICT；即时检查。

权限：数据／专业审核人员；生产聊天不可将这些场景当用户真实经历。

删除／留存：撤回源或案例后停止新评测／发布并定位数据集，删除原文和模型输出中的可识别内容。

### decision_case_sources

**新增 · M4。** 案例版本的全部原始／脱敏资料定位，不再选一个主来源隐藏其他来源。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `case_id` | `uuid` | 否 | 无 | → `decision_cases.id`。 |
| `asset_id` | `uuid` | 否 | 无 | → `corpus_assets.id`。 |
| `ordinal` | `integer` | 否 | 无 | 正整数；同资产不同片段允许多行 |
| `source_role` | `text` | 否 | 无 | observation / adaptation / counterfactual_reference |
| `source_locator` | `jsonb` | 否 | 无 | 经过 schema 校验的段落／时码定位及原文哈希 JSON：`SourceLocator`（v1）。 |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(case_id,ordinal)；ordinal>0；同一 case 可有多个资产与片段；FK 保证案例／资产存在；发布事务冻结全部边；locator 与该确切 asset 内容哈希、段落／时码长度一致；脱敏且用途有效；泄漏分组按完整来源闭包而非 ordinal=1 计算。

索引：asset_id。

权限：仅获准研究职责；不向产品 Agent 暴露。

删除／留存：撤回／擦除反查全部案例、发布和评测输出；不以删除关联行继续保留可用案例。

### dataset_versions

**新增 · M4。** 确定用途和版本的数据集发布，不将同意评测等同训练或公开展示。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `dataset_key` | `text` | 否 | 无 |  |
| `version` | `integer` | 否 | 无 |  |
| `purpose_code` | `text` | 否 | 无 | development / evaluation / training / showcase |
| `status` | `text` | 否 | draft | draft / approved / released / withdrawn |
| `split_policy_version` | `text` | 否 | 无 |  |
| `manifest_sha256` | `char(64)` | 否 | 无 |  |
| `approved_by` | `text` | 是 | 无 | → `user.id`。 |
| `approved_at` | `timestamptz` | 是 | 无 | 实际批准时间，与 released_at 分开；新建或尚未批准保持 NULL |
| `released_at` | `timestamptz` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；UNIQUE(dataset_key,version)；发布时重新检查全部直接及间接来源用途授权、脱敏和案例审核；manifest 封版不原地改。

索引：(dataset_key,version DESC)；(purpose_code,status)。

权限：按用途分配的研发／评测职责；showcase 只用获准脱敏资料。

删除／留存：源撤回使相关发布不可新用；离线导出也登记到 data_request_items 清理范围。

### dataset_assignments

**新增 · M4。** 每个版本中一个防泄漏组只分配到一个 split，防复访和改写漏进留出集。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `dataset_version_id` | `uuid` | 否 | 无 | → `dataset_versions.id`。 |
| `leakage_group_id` | `uuid` | 否 | 无 |  |
| `split` | `text` | 否 | 无 | development / validation / holdout |

约束：PK(dataset_version_id,leakage_group_id)；发布后不可改 split；整个关联家庭／同人复访一起分配。

索引：(dataset_version_id,split)。

复合关系使用的完整唯一键：UNIQUE(dataset_version_id,leakage_group_id)。

权限：数据集管理职责；holdout 参考答案不向优化 Prompt 的角色默认开放。

删除／留存：随未发布数据集删除；已发布变更走新版或撤回。

### dataset_items

**新增 · M4。** 数据集绑定确切案例版本和既定分组，不重复复制题目。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `dataset_version_id` | `uuid` | 否 | 无 | → `dataset_versions.id`。 |
| `case_id` | `uuid` | 否 | 无 | → `decision_cases.id`。 |
| `leakage_group_id` | `uuid` | 否 | 无 |  |
| `weight` | `numeric(8,4)` | 否 | 1 |  |

约束：PK(dataset_version_id,case_id)；FK(case_id,leakage_group_id)→decision_cases(id,leakage_group_id)；FK(dataset_version_id,leakage_group_id)→dataset_assignments；weight>0；同 case_key 每发布最多一版由发布事务校验。

索引：(case_id,dataset_version_id)。

复合关系使用的完整唯一键：UNIQUE(dataset_version_id,case_id)。

组合外键 `fk_dataset_case_group`：(case_id,leakage_group_id) → decision_cases(id,leakage_group_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_dataset_group_split`：(dataset_version_id,leakage_group_id) → dataset_assignments(dataset_version_id,leakage_group_id)；ON DELETE RESTRICT；即时检查。

权限：同数据集；题目与参考判断按角色投影。

删除／留存：源撤回标记数据集失效；不把权重用于掩盖安全关键失败。

### evaluation_runs

**新增 · M4。** 一次可复现离线评测任务，记录版本和运行限制。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `dataset_version_id` | `uuid` | 否 | 无 | → `dataset_versions.id`。 |
| `agent_policy_version_id` | `uuid` | 否 | 无 | → `policy_versions.id`。 |
| `knowledge_release_id` | `uuid` | 是 | 无 | → `knowledge_releases.id`。 |
| `model` | `text` | 否 | 无 |  |
| `provider_code` | `text` | 否 | 无 | 可信评测配置中的实际供应商代码；不从模型自述推断，不保存密钥或私有端点 |
| `model_parameters` | `jsonb` | 否 | 无 |  JSON：`ModelParameters`（v1）。 |
| `code_revision` | `text` | 否 | 无 |  |
| `status` | `text` | 否 | pending | pending / running / completed / failed / cancelled |
| `created_by` | `text` | 否 | 无 | → `user.id`。 |
| `started_at` | `timestamptz` | 是 | 无 |  |
| `finished_at` | `timestamptz` | 是 | 无 |  |
| `summary_metrics` | `jsonb` | 否 | 无 | v2 按 reviewer_kind/供应商/模型/rubric/score_scale 分桶，只取最新有效修订；旧 v1、当前 0–1 和 0/1/2 量纲不混算。根均分 NULL；未评分不补零，硬性安全/授权否决分别计数 JSON：`EvaluationMetrics`（v2）。 旧版本只读：1。 |
| `created_at` | `timestamptz` | 否 | now() |  |
| `metrics_schema_version` | `integer` | 否 | 2 | summary_metrics 原生新写 v2；v1 冻结只读。规则/模型/专家及实际供应商分别汇总，不合并平均分 |

约束：PK(id)；UNIQUE(id,dataset_version_id)；只跑获准且有效发布；模型参数不含密钥；纯评测环境禁止真实邀请、通知、预约或安全告警外发。

索引：(dataset_version_id,created_at DESC)；(status,created_at)。

复合关系使用的完整唯一键：UNIQUE(id,dataset_version_id)。

权限：评测人员；真实资料不得因默认 eval 命令自动发给供应商。

删除／留存：按数据来源许可与留存清理；外部调用和输出登记，撤回时可定位。

### evaluation_results

**新增 · M4。** 每样本每次实际输出及硬检查；重跑不覆盖早先失败。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `evaluation_run_id` | `uuid` | 否 | 无 | → `evaluation_runs.id`。 |
| `dataset_version_id` | `uuid` | 否 | 无 | → `dataset_versions.id`。 |
| `case_id` | `uuid` | 否 | 无 | → `decision_cases.id`。 |
| `sample_no` | `integer` | 否 | 1 |  |
| `output` | `jsonb` | 是 | 无 | v2 含实际 state_after 与 safety_state_after，连同可信 route_decision 复核；v1 原样只读 JSON：`EvaluationOutput`（v2）。 旧版本只读：1。 |
| `status` | `text` | 否 | 无 | completed / error / blocked |
| `hard_checks` | `jsonb` | 否 | 无 |  JSON：`HardChecks`（v1）。 |
| `latency_ms` | `integer` | 是 | 无 |  |
| `token_usage` | `jsonb` | 是 | 无 |  JSON：`TokenUsage`（v1）。 |
| `error_code` | `text` | 是 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |
| `output_schema_version` | `integer` | 否 | 2 |  |

约束：PK(id)；UNIQUE(evaluation_run_id,case_id,sample_no)；run 的 dataset 与本行一致；FK(dataset_version_id,case_id)→dataset_items；样本失败保留原始结论。

索引：(evaluation_run_id,status)；(case_id,created_at DESC)。

组合外键 `fk_eval_run_dataset`：(evaluation_run_id,dataset_version_id) → evaluation_runs(id,dataset_version_id)；ON DELETE RESTRICT；即时检查。

组合外键 `fk_eval_dataset_case`：(dataset_version_id,case_id) → dataset_items(dataset_version_id,case_id)；ON DELETE RESTRICT；即时检查。

权限：同 run；私有真实数据输出不进入普通用户日志或公开演示。

删除／留存：随源数据撤回及评测保留期清理；重复运行生成新结果而不“修饰”旧通过率。

### evaluation_reviews

**新增 · M4。** 规则、模型评审和人工专家分别登记，不以同供应商自评代替专家。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | 否 | gen_random_uuid() |  |
| `evaluation_result_id` | `uuid` | 否 | 无 | → `evaluation_results.id`。 |
| `reviewer_kind` | `text` | 否 | 无 | rule / model / expert |
| `reviewer_user_id` | `text` | 是 | 无 | → `user.id`。 |
| `reviewer_credential_id` | `uuid` | 是 | 无 | → `professional_credentials.id`。 |
| `judge_model` | `text` | 是 | 无 |  |
| `judge_provider_code` | `text` | 是 | 无 | 仅 model 评审必填的真实供应商代码，用于区分同供应商自评与独立评审 |
| `rubric_version` | `text` | 否 | 无 |  |
| `revision` | `integer` | 否 | 1 |  |
| `verdict` | `text` | 否 | 无 | pass / fail / needs_review |
| `scores` | `jsonb` | 否 | 无 | v2 对象保存 scale_code、逐维 raw_score/冻结权重/证据、原始总分、满分和 normalized_quality。V3.0 五维各 0/1/2、各权重 0.2、总分 10；缺分为 NULL 不补零，阈值须专业校准。旧 v1 0–1 数组只读 JSON：`ReviewScores`（v2）。 旧版本只读：1。 |
| `scores_schema_version` | `integer` | 否 | 2 | 原生新写 v2；冻结 ReviewScoresV1 数组只读，不将旧值猜成 0–2 原始分 |
| `safety_failure` | `boolean` | 否 | false |  |
| `authorization_failure` | `boolean` | 否 | false | 独立授权/隐私硬性否决，与安全失败分开记录；任一为真 verdict 必为 fail，高质量分不能抵消 |
| `rationale` | `text` | 否 | 无 |  |
| `created_at` | `timestamptz` | 否 | now() |  |

约束：PK(id)；expert 必须是真实 reviewer，凭证和职责匹配；model 必须填 judge_model；评分修正追加 revision 不覆盖；不能通过 JSON 格式修复改变原有通过结论；UNIQUE NULLS NOT DISTINCT(evaluation_result_id,reviewer_kind,reviewer_user_id,judge_provider_code,judge_model,rubric_version,revision)；expert 与本人凭据配对，model 的模型/供应商都必填；修订追加且不覆盖既有结论；原生 scores_schema_version=2；评分维度、权重和量纲与该结果案例的冻结 rubric 匹配；逐维不可重复，汇总按实际原始分重算；安全或授权失败均只能 fail，分数不自动产生通过阈值。

索引：(evaluation_result_id,reviewer_kind,created_at DESC)；(safety_failure,created_at)。

组合外键 `fk_eval_reviewer_subject`：(reviewer_user_id,reviewer_credential_id) → professional_credentials(subject_user_id,id)；ON DELETE RESTRICT；即时检查。

权限：审核人员分权；可将留出题最终专家判断对研发隐藏。

删除／留存：同样本留存；总结指标明确区分人工审定、模型判断、硬规则及补测。


## 12 旧表承接与退役

### revisions

**扩展 · M1。** 保留事件内正文修订和状态变化，不承担通用敏感访问审计。

| 字段 | SQL 类型 | 可空 | 默认值 | 外键／说明 |
| --- | --- | --- | --- | --- |
| `conversation_id` | `uuid` | 是 | 无 | → `conversations.id`。 |
| `entity_type` | `text` | 是 | 无 |  |
| `entity_reference` | `text` | 是 | 无 |  |
| `entity_version` | `bigint` | 是 | 无 |  |
| `request_id` | `uuid` | 是 | 无 |  |

约束：沿用 event、actor、kind、value、created；有 conversation 时同 event；日志引用只定位，不授予权限；正文版本以 record_versions 为准；原业务兼容写入和修订同事务；V2 记录正文/答卷完成切换后 value 只读，改由 record_versions/interaction_events 留历史。

索引：(conversation_id,id DESC)；(event_id,entity_type,entity_reference,id)。

组合外键 `fk_revision_conversation`：(event_id,conversation_id) → conversations(event_id,id)；ON DELETE RESTRICT；即时检查。

权限：按各自会话隔离；原所有者不能通过 event 修订列表读取家长私聊修订。

删除／留存：含私人正文，必须和所属域一并清理；不搬入长期 audit_events。

### questionnaires

**只读退役 · M2。** 迁往 assessment_sessions＋assessment_submissions；旧发现迁 intake 的 insight 记录，旧确认摘要仍只投影给原所有者。

约束：迁移核对完成并切换全部调用方前不删除旧表；正式 drop 使用单独 contract 迁移。

索引：切换期间沿用现有索引。

权限：旧读兼容不放大权限；不再新写。

删除／留存：历史私人正文仍参与合法资料清理；过渡保留不是永久保留承诺。

### perspectives

**只读退役 · M1。** 迁 room 内 kind=feeling/need 的 understandings＋record_versions＋本人确认；不改变原说话人。

约束：迁移核对完成并切换全部调用方前不删除旧表；正式 drop 使用单独 contract 迁移。

索引：切换期间沿用现有索引。

权限：旧读兼容不放大权限；不再新写。

删除／留存：历史私人正文仍参与合法资料清理；过渡保留不是永久保留承诺。

### note_shares

**只读退役 · M3。** 迁 source_record_version 为已开放纪要的 share_snapshots＋share_grants，保留旧固定正文与授权／撤回时间。

约束：迁移核对完成并切换全部调用方前不删除旧表；正式 drop 使用单独 contract 迁移。

索引：切换期间沿用现有索引。

权限：旧读兼容不放大权限；不再新写。

删除／留存：历史私人正文仍参与合法资料清理；过渡保留不是永久保留承诺。

### consent_records

**历史保留 · M1。** 仅保留历史 local_test／legacy_import 台账，不转换为新正式同意，不再作为新准入事实。

约束：迁移核对完成并切换全部调用方前不删除旧表；正式 drop 使用单独 contract 迁移。

索引：切换期间沿用现有索引。

权限：旧读兼容不放大权限；不再新写。

删除／留存：历史私人正文仍参与合法资料清理；过渡保留不是永久保留承诺。

## 复用对象

认证 user/session/account/verification、schema_migrations 和 pg-boss 内部表沿用原系统。ASR 原始音频不自动落库；未保存本机草稿不新增表。
