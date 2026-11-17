# 数据库与后端结构

2026-11-16 补充：基于完整交付清单的[数据库目标设计 V2.3](database-design-v2.md)和[表字段字典](database-field-dictionary-v2.md)已整理。已按 10 项复查补齐关系与 JSON 契约，并按 [Wang 基础补全](wang-database-foundation-2026-11-16.md)增加情境规则、命中追踪和练习选择边界，见[修订复查记录](database-design-review-2026-11-16.md)。2026-11-17 又按[独立审查修复台账](database-nine-fixes-2026-11-17.md)补齐 9 项问题。它们是待实施设计，未执行迁移；下文保留现有 0001–0007 的实现与升级记录，不能把目标结构当成当前已建表。

2026-11-13。PostgreSQL 17，pg 连接池与 Drizzle SQL；保持单体 API 和独立 Worker。

同日权限修复后的最新规则、角色来源和启动方式见 [权限矩阵](permissions.md)。新增 0003_room_activity.sql，为 events 添加 room_updated_at；成员只看到公开活动时间。后文 0001／0002 部分描述前一轮结构转换。

## 当前边界

已实现版本迁移、分享内容与授权分离、历史测试同意记录、Agent 追踪，以及 0004 的理解核对、私人回访、双方确认预约和版本化服务纪要。问卷与练习仍按事件各一份，非暴力沟通和情境排练笔记按练习类型保存在同一事件；多次独立测评和多个练习实例未实现。未引入微服务、通用 ACL 或新的依赖。

## 表与关系

原有业务表保留：profiles、events、messages、exercises、questionnaires、members、invites、perspectives、consultants、applications、revisions、agent_runs。认证表仍由 Better Auth 维护，任务表仍由 pg-boss 维护。

| 表 | 字段与约束 |
| --- | --- |
| schema_migrations | name 主键、checksum、applied_at；执行过的迁移不可修改 |
| share_snapshots | id、event_id、created_by、content、source_version、created_at；事件内来源版本唯一；应用只插入和读取快照 |
| share_grants | id、event_id、snapshot_id、granted_by、recipient_id、granted_at、revoked_at、revoked_by、source；每个事件每个接收人最多一个未撤回授权；复合外键阻止跨事件引用快照 |
| consent_records | id、user_id、consent_type、policy_version、action、occurred_at；同一用户、类型和版本唯一；action 为 accepted 或 legacy_import |

旧 snapshots 表已转换为 share_snapshots 和 share_grants；invites 用 snapshot_id 关联固定内容，不再复制摘要正文。profiles 不再维护 consent_at，以 consent_records 为同意记录来源。

Agent 记录补充 trigger_message_id、response_message_id、prompt_version、finished_at、error_code。status 只保存 running、complete、error；错误原因单独保存。静默回复可正常完成且没有 response_message_id，权限变化导致的过期结果记录 error，不发布回复。旧记录缺失的消息关联、Prompt 版本和结束时间保持 NULL，不推测补齐。进程中断留下的 running 记录表示未观察到结束，尚未实现自动恢复判定。

## 0004 PRD 流程补齐

| 表 | 新增字段与约束 |
| --- | --- |
| messages | card_type 可空，当前只允许 safety；新增 event_id、domain、id 唯一约束，供原消息引用 |
| exercises | practice_notes JSONB，保存 nvc／roleplay 的私人表单；原幕次、暂停和故事字段保留 |
| applications | proposed_at、schedule_version、rejection_reason；增加 proposed 状态。scheduled_at 仅表示已确认时间 |
| consultants | specialties、service_modes 数组、availability、verified_at；非测试人员必须有核验时间才在目录展示或接受新申请 |
| understandings | id、event_id、domain、author_id、source_message_id、content、provenance、version、created_at；来源限同事件同会话，原消息唯一，provenance 为原话、模型推测或用户修正 |
| understanding_confirmations | understanding_id、user_id、version 联合主键；agreed、confirmed_at；修改理解后旧确认不适用于新版本 |
| followups | id、event_id、user_id、reflection、next_step、review_at、reviewed_at、created_at；用户与创建时间索引 |
| consultation_notes | application_id 主键、author_id、content、client_visible、version、updated_at；未开放草稿仅分配的有效咨询人员可读 |
| note_shares | id、application_id、recipient_id、granted_by、content 固定副本、source_version、granted_at、revoked_at；同申请同接收人最多一个有效分享 |

理解的来源及确认状态分别保存；接口返回原说话人与来源消息、当前版本的确认人和时间。共识按当前有效参与者计算，单方认可不显示双方确认，任一人反对显示分歧。修正正文通过 revisions 留痕，历史确认继续保留。列表和 Agent 取最近 40 条理解，完整记录可导出；数据量增大后需补分页。

私人 Agent 取得保存的练习、故事及最近十条回访；公共 Agent 不取得这些内容，也不取得任何咨询纪要。练习、理解及回访更新会使旧上下文失效，阻止旧回复发布。显式危险回复在同一事务记录 safety 卡和暂停练习。

旧 scheduled 记录升级为 proposed，将原时间移至 proposed_at 并等待申请人确认；completed 历史不变。新预约按“接单 → 提议时间 → 申请人确认”流转，提议更新后拒绝旧版本确认；调整时间期间保留此前已确认时间，拒绝调整则保留原约定。完成必须到达约定时间。尚无自动排班或冲突检测。

纪要更新使用版本冲突检查；申请人只能分享当前向自己开放的版本。分享固定内容，不随咨询人员后来修改或隐藏纪要而变化；申请人仍能撤回旧分享。取消申请、移出成员或成员退出均撤回对应纪要分享，重新加入不会恢复。正式服务记录的留存与删除规则仍待确认。

## 授权与接口

- POST /api/events/:id/invites：固定邀请时的摘要快照；接受邀请后创建接收人的授权。
- PUT /api/events/:id/shares/:userId，body 为 `{ "version": 当前摘要版本 }`：仅事件所有者可给当前有效成员授权；需要非空摘要，过期版本返回 409。
- DELETE /api/events/:id/shares/:userId：仅事件所有者可撤回摘要授权，保留房间成员资格；重复撤回不增加重复历史。
- DELETE /api/events/:id/members/:userId：所有者移出成员，或成员自行退出；同时撤回对应授权。

分享、撤回、退出与 room_version 的更新在同一事务内，持有事件行锁。重新授权会撤回旧授权并新增记录；重复授权同一快照不产生重复历史。公共 Agent 仅取得所有当前成员都获准读取的同一快照。发布前再次核对上下文版本与成员资格。

撤回不删除历史公开消息，不承诺收回已阅读或复制的内容。事件所有者仍能看见自己曾分享的版本与授权历史；接收人只能通过业务接口读取当前有效授权的摘要。数据库备份同样包含私人内容，不能公开。

## 历史测试同意记录

按当前界面要求，已删除登录页开发测试勾选、数据使用说明和说明版本，以及已有会话的重新确认入口。HTTP 业务写入和 Worker 不再检查开发测试说明的同意版本；GET /api/me 保留 `consentRequired: false` 兼容旧调用方。登录不会自动接受说明或新增记录。

历史 consent_records 和迁移文件保持不变。兼容接口 POST /api/consent 仍校验显式 `{ "accepted": true, "version": 当前版本 }`，类型及版本来源为 shared/consent.ts，旧版本返回 400；当前界面不再调用它。摘要及咨询纪要的具体分享确认与授权未变。这些历史测试记录不代表正式未成年人或监护人同意。

## 迁移与升级

1. 停止旧版 Web、API、Worker，创建 PostgreSQL 备份，保留匹配的旧版源码。不要同时运行新旧 Worker。
2. 执行 `npm run db:migrate`，使用 MIGRATION_DATABASE_URL 完成认证表、业务表、队列初始化及受限运行角色配置，不监听 HTTP 端口或启动回复消费。
3. 启动新版 `npm run dev`。既有会话、事件、邀请及历史同意记录保留，不再要求确认开发测试说明。

0001_initial.sql 保存原始建表脚本，可兼容已存在的本地 MVP 数据库；0002_sharing_consent_tracing.sql 在事务中转换旧记录。两步及迁移记录一起提交，失败则一起回滚。发现同一事件、同一摘要版本有不同内容时，升级失败并保留原数据，不能任意挑一份覆盖。

旧授权缺少完整历史时间，其 granted_at、revoked_at 使用导入时刻，source 标记 legacy_import，不能作为精确历史发生时间。旧 profiles 时间仅以 legacy_import 保存，不认定为用户接受了任何新政策。新旧数据不再双写。

迁移使用数据库事务锁串行执行，校验已应用文件的 SHA-256，拒绝校验和变化或代码不认识的迁移。后续修改新增 SQL 文件，不修改已执行的 0001–0004。Better Auth 的表仍使用其现有迁移入口，不混入业务迁移记录。

API 和 Worker 使用 DATABASE_URL，只验证角色、迁移版本与校验和，不再执行 DDL。旧版单一管理员连接在迁移命令成功后拆为运行连接与迁移连接，其余配置保留；后续依赖或结构升级应先停服务并执行迁移，再统一重启。

本版没有向下迁移。需要退回旧代码时，在隔离库恢复升级前备份并校验后再切换；恢复旧备份不会包含升级后新增的数据。既有事件级联删除规则未改变，正式咨询记录的保留规则需在接入真实服务前明确。

## 模块

| 位置 | 职责 |
| --- | --- |
| server/app.ts | 认证、请求来源检查、错误处理、组件启动和关闭 |
| server/context.ts、server/http.ts | 业务上下文、修改记录、输入校验公共定义 |
| server/permissions.ts、server/notifications.ts | 公共访问规则、有效会话检查、明确范围的更新通知 |
| server/setup-database.ts、server/database-access.ts | 管理端初始化及受限运行账号配置与检查 |
| server/routes/accounts.ts | 用户角色和同意记录 |
| server/routes/events.ts | 事件、消息、关系查询和导出 |
| server/routes/assessments.ts | 问卷、小发现和练习 |
| server/routes/sharing.ts、server/shares.ts | 邀请、成员、观点和分享授权事务 |
| server/routes/support.ts | 咨询目录、申请、双方确认预约与纪要授权 |
| server/understandings.ts | 来源明确的理解记录、版本化确认与分歧 |
| server/routes/followups.ts | 私人回访与已回看状态 |
| server/routes/transport.ts | 语音转写和 SSE 生命周期 |
| server/agent-context.ts | 权限过滤和模型上下文组装 |
| server/worker.ts、server/agent.ts | 排队、模型编排、运行追踪与发布前检查 |

## 验证

`npm test`、`npm run test:integration`、`npm run build`。集成测试只创建随机命名的隔离库，并在结束时删除。

覆盖新建库、旧版带数据升级、失败回滚、并发迁移、校验和变更拒绝、快照跨事件外键、摘要独立撤回、重新授权与幂等、多人共享上下文、生成期间撤回、同意版本更新和 Agent 成功／失败记录。模型由测试注入，不调用真实供应商。

本机升级前另存源码和数据库备份在忽略提交的 .data/backups/，并将备份恢复到临时库比对 16 张原表的保留字段及旧快照正文，结果均相同；脱敏数量记录在 .data/refactor-verification.json。新增界面只完成构建检查，浏览器工具因 native pipe 启动失败未完成视觉或交互验收。

启动检查另验证了 Web、API、Worker 三个进程正常启动，Web 代理的状态接口返回正常，未登录业务请求返回 401；检查时临时禁用模型 Key，未调用模型供应商，结束后已停止这三个检查进程。

## 0004 本机升级结果（2026-11-13）

升级前源码与数据库备份为 `.data/backups/before-prd-completion-20261113-135231.*`。已执行 0004 并刷新运行账号明确授权；从该备份恢复临时库，对照 19 张原认证和业务表的保留字段，全部一致，新增五表为空；`.env` 逐字节未变。脱敏结果位于 `.data/prd-completion/data-verification.json`。旧排期转换另在隔离升级测试中验证。本机未改动 0001–0003 的既有文件。

## 0005 稳定性索引与事务

该轮本机迁移为 0005，仅新增 events_owner_activity、members_active_user 和 agent_runs_trigger 索引，无新表或业务字段。事件与联系人查询先限定当前用户可见事件；最新运行记录按事件、会话、触发消息索引查询。

消息保存、上下文版本更新与 pg-boss 入队在同一数据库事务内提交，入队失败全部回滚；重复 clientId 不重复建任务。显式重试仍可独立建任务。问卷、练习及咨询申请更新先锁事件，避免与 Worker 发布时的锁顺序相反。导出使用只读 repeatable read，读取同一时点的各表版本。

本轮升级前备份为 `.data/backups/before-stability-20261113-145058.*`；恢复临时库后对比 24 张原认证及业务表全部字段均相同，配置未变。已执行的 0001–0005 不应再修改。故障恢复、测量与超时边界见 [工程稳定性报告](engineering-stability.md)。

## 0006 详情读取优化

当前本机迁移为 0006，新增 followups_event_user_created、applications_event、invites_event_created 索引；没有新增业务表或字段。历史消息独立 GET /api/events/:id/messages 返回最多 50 条和 hasMore，每次按会话域检查当前权限。原详情接口的 before 参数继续兼容。

24 张原表的全部字段与升级前备份一致，配置保留。已执行的 0001–0006 不应修改；完整数据集、成对测量与回归依据见 [性能记录](performance.md)。

## 0007 Agent 执行与确认

2026-11-14 增加 `agent_runs.checkpoint` 及按事件/域/触发消息恢复的索引，增加 `agent_actions` 与来源回复关联、唯一槽位及事件索引。运行账号只增加该业务表的 SELECT/INSERT/UPDATE 权限，未增加 DDL、管理或任意执行权限。升级只增加结构，不重写既有消息。

原库升级前的私密完整备份保留在 `.data/agent-audit/before-0007.sql`（0600）；旧表行数与原有字段摘要、`.env` 摘要核对见 `.data/agent-audit/data-verification.json`。恢复、确认事务和私人资料边界见 [Agent 设计](agent-design.md)。
