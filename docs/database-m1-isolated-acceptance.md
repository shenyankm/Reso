# M1a/M1 第一阶段隔离实施与验收

2026-11-17。对应 [M1a/M1 实施方案](database-m1-implementation-plan.md)的迁移、旧数据回填、恢复和基础权限演练。**只使用一次性 PostgreSQL 17 集群及合成数据；现有业务库、持久卷、`.env` 和线上服务未改。** P5 原生业务写入与 P6 切流尚未完成。

## 交付与运行方式

```sh
npm run test:m1:isolated
uv run scripts/check-database-design.py
uv run scripts/check-database-draft.py --self-test
npm test
npm run build
```

需要 Docker、Node.js 与 uv。入口 [verify-m1.ts](../scripts/verify-m1.ts)不读取 `.env`，不接受外部指定的目标库；创建带随机标记的容器，使用 tmpfs、随机凭据及 `127.0.0.1` 随机端口，拒用已有业务端口 55436。验证 Docker 名称、标签、挂载、端口及库内标记后，才允许建演练库。故障注入、备份恢复和清理都限定于这套集群，不调用 `docker compose up`。

子进程不继承业务库、模型、ASR 或部署凭据。退出时删除本轮库、角色及容器；报告、合成 JSON、加密备份及其测试密钥仅留在忽略目录 `.data/m1-verification/<run_id>/`（目录 0700，文件 0600）。测试密钥与备份同目录仅用于本机合成数据演练，真实备份须另行管理密钥，不能据此宣称已交付正式密钥托管。

GitHub CI 增加 `m1-isolated`，同样新建 tmpfs 集群，不使用仓库业务密钥。它执行本轮用例、实际导入 JSON 契约校验及全部既有后端集成测试；不上传备份、密钥或正文附件。

## 真正增量及兼容边界

| 文件或入口 | 行为 |
| --- | --- |
| [0008_m1a_expand.sql](../server/migrations/m1/0008_m1a_expand.sql) | 119 条语句，建立 M1a 的 8 张新表及对应扩展 |
| [0009_m1_foundation_expand.sql](../server/migrations/m1/0009_m1_foundation_expand.sql) | 235 条语句，仅补 M1 余下 12 张表与扩展，不重复 M1a |
| [migrations.ts](../server/migrations.ts) | 显式 `m1a`/`m1` 目标；一个 PoolClient、事务锁、逐文件 SHA-256 和事务回滚 |
| 默认 `db:migrate`、API、Worker | 仍选 `legacy` 的 7 份文件，校验继续严格；不自动执行 0008/0009 |
| 累计审阅草案 | 均从 0007 出发，不能依次执行；离线检查核对增量 AST、文件内容及无嵌套 COMMIT |

0001–0007 未修改。M1a 的一处 CHECK 名称归一为累计 M1 已有的 `ck_agent_runs_containers`，仅统一名字，无规则变化。合并结构在真实 PostgreSQL 与独立 0007→累计 M1 参考库逐项一致：列、类型、默认值、可空性、唯一键、FK、CHECK、延后属性、索引和 RLS 均核对。

**旧 API/Worker 不能直接连已升级 M1 的库。** 回填后的新 FK 会影响旧删除路径，同事件多人的 private 又不能继续按 event/domain 聚合。因此未增加绕过校验的开关，也未假称已交付兼容回滚构建；该构建与全入口适配列入 P5/P6。

## 回填与维护字段字典

[backfillM1](../server/m1-backfill.ts)以 event 为页，默认 100、允许 1–500 个 event。每页先取迁移锁和回填锁，再锁根/旧行，写目标与台账并一次提交。一个 event 的消息/理解不能拆页，实际大事件的内存/锁时长仍需副本测量。恢复从头扫描，确定性 UUIDv5 与源摘要保证重复不新增；这不是在线增量同步器，真实实施须停写、排空在途任务并固定截止点。

`reso_migration.backfill_items` 属于维护 schema，不是业务授权表，不计入 76 张业务目标表；不向 API/Worker/预览账号授权。它与目标数据同库同事务，免去跨文件 pending/complete 双提交。

| 字段 | 类型／约束 | 含义与关系 |
| --- | --- | --- |
| source_key | text PRIMARY KEY | table/PK、event、kind、owner 等组成的 JSON 数组，按对象类型固定构造；不拼接不透明分隔符 |
| source_sha256 | char(64) NOT NULL | 对原始基线列的 JSON/JCS 摘要；原生新增列不混入源摘要；变化时停止并人工对账 |
| target_id | uuid NOT NULL | 该维护项的目标 event/conversation/version/grant；目标类型由 source_key 的首项确定，不是可复用的业务多态授权 FK |
| converter_version | integer NOT NULL CHECK = 1 | 固定转换器版本；不自动接受不同转换器语义 |
| completed_at | timestamptz NOT NULL DEFAULT now() | 页事务时间，提交后才可见；不冒充历史事件/授权发生时间 |

报告另保存 run_id、合成数据截止点/摘要、转换器文件 SHA、源迁移集合/校验和；映射台账随加密库备份恢复。目标实际存在且归属/正文一致才复用映射，不能仅信台账。

已实施的映射：

- 旧事件只创建 owner 的 private、intake 和一间 room；room 标题/活动时间来自公开字段，空公开标题不回填私人标题。
- 旧消息和运行按原 event/domain 定位，保留 ID、作者、正文、时间、版本、旧 Prompt、assessment 和 checkpoint。旧 checkpoint 不升级为原生可恢复状态，不补造逻辑轮次、attempt、policy、manifest 或授权 epoch。
- 每条理解只捕获当前可证明正文，形成 `record_origin=legacy_import` 的版本、同会话真实消息来源及根指针；不生成缺失的 v1…vn。模型推测保留 hypothesis，用户修正不自动升级为客观事实。
- 本次转换的 JSON 回读后按现有 `RecordContent`、`ConfirmationScope` 校验。原文 UTF-8 摘要与新 JSON JCS 摘要分开；emoji、组合字符和换行原样保留。
- 仅当前确切版本的确认挂接 record_version；更早且正文无法证明的确认保留旧字段，指针 NULL。范围使用 `legacy_unknown`，不补全体认可或历史成员代次。
- 旧成员只记录可证明基点与 `legacy_full_history`；不制造退出时间。旧 grant 定位目标 room、`permissions=[]`，撤回记录不复活，不新增 `use_in_agent` 或正式同意。
- 旧 summary_version 不等于理解版本。无法证明源版本的分享快照保持原字节与旧版本，原生来源/payload/hash 为 NULL，单独计数；不捏造来源根来满足 FK。
- 问卷、练习、预约、纪要及其作者/状态/版本保持旧表；不填 M2+ 关系，不创建正式同意、已批准政策、专业资格或已接管风险等种子。

源变化、跨域来源、已映射目标/指针被清空、撤回/重分类、原生消息元数据或分享用途冲突、擦除中的事件都会停止该页，保留之前已提交页供对账。不可把这些失败行加入原生读写试点。

## 只读权限预览

[configureM1ReadAccess](../server/m1-access.ts)仅供演练；没有路由、启动器或 Worker 接入它。独立 reader 为 NOINHERIT/NOBYPASSRLS，不能直接读旧 messages、分享、维护台账或敏感新表，也没有 INSERT/UPDATE/DELETE/TRUNCATE/DDL。

三处 SECURITY DEFINER 函数固定 `search_path=pg_catalog`，只查明确的 public 表；所有者是 NOLOGIN/BYPASSRLS 辅助身份，仅授必要 SELECT，不授角色成员身份、写入或 DDL。该身份用于避免跨表 RLS 递归，不作为业务连接；普通 reader 自身的 RLS/权限用真实登录账号验收。旧表不启用会破坏 legacy 的全表 RLS，而以受限投影视图读取消息。

每次由可信后端从认证主体派生 actor 和确切 conversation，在**同一只读事务**设置局部上下文；池取出/归还均清理。数据库服务凭据仍属于可信后端，GUC 不是允许终端用户自己声明身份的认证接口。

| 可读对象 | 必须满足 |
| --- | --- |
| conversations | 当前 active profile；精确会话；本人 private/intake 或当前 room owner/成员；事件与会话未进入擦除 |
| m1_read.messages | 上述范围，再检查真实归属、room 当前历史起点、消息未脱敏；private_hint 在预览中始终关闭 |
| record_versions / record_sources | 仅 active 理解的 legacy_import 捕获；全部真实消息来源仍在当前可读会话范围内 |
| professional、批准/资格、安全/同意及其他新表 | 不放行；展示身份字符串不构成专业权限 |
| 旧 Worker/运行职责 | 原白名单重配后仍无任何新表读写授权，不能借缺少 actor 扩权 |

已验证成员退出、历史起点调整、消息脱敏、账号停用、事件擦除会关闭相应消息及衍生理解读取。尚未接入原生输出发布、任务取消、SSE/导出/删除传播；相应用例不能据此标为全部通过。

## 实测与反例

本机 PostgreSQL **17.11**。已通过 **16 个专项场景（Node 计数含父项共 17）**、6 个数据库回读 JSON 契约检查，以及 **26 项既有后端集成测试**。旧基线对账 39 个关系（含迁移表），升级后整库恢复对账 60 个关系（含维护台账、认证及队列表）。迁移表按预期从 7→8→9，旧业务列、作者、原文、时间、状态及认证/队列行摘要保持一致。

另通过 109 项单元/组件测试、TypeScript/Vite 构建、294 个 JSON 与 398 个语义设计反例，以及 243 项 SQL 草案变异拒绝检查；业务目标仍为 76 张表、919 条字段条目。

| 范围 | 已运行的正例／反例 |
| --- | --- |
| A01–A03 | 有数据 0007→M1a→M1、并发重复、参考库目录等价；DDL 中途失败、累计草案误用、未知迁移、摘要篡改均拒绝；角色设置失败时角色/ACL/函数一并回滚 |
| A04–A05 | 页 1 成功后页 2 失败并续跑；执行中终止数据库连接；无半个版本/来源/根指针/台账；跨域 run、孤儿 event、源字节变化、被清空映射、元数据冲突均拒绝 |
| A06–A08 | checkpoint/未知原生运行字段不升格；模型推测、历史反对、已撤回分享、测试专业账号、旧安全卡不变成确认、正式资格或接管事实 |
| P01/P02/P07 | 同事件 A/B 私聊及活动元数据隔离；reader/Worker 直接越权 SQL 拒绝；重复及交错角色配置仍受限；旧 API 指向 M1 拒绝启动 |
| P03 | max=1 同一后端连接轮流读 A/B/无上下文；提交、SQL 错误、查询超时、意外 session SET 后无权限残留 |
| P04/P06 子集 | 当前成员/历史起点、源脱敏、账号停用及擦除后的只读过滤；完整任务发布、HTTP/SSE/导出/删除新域适配仍待 P5 |
| R01–R03 子集 | 0007 加密整库恢复到独立库并用受限 legacy 服务启动；M1 升级后整库恢复保留新增 B 私聊、版本和撤权/擦除状态，重配只读权限再验；原升级库未覆盖或逆向 DROP |

合成样本为 2 个 event、6 条旧消息、2 个旧 run、3 条当前理解及 3 条历史确认。M1a 创建 6 个会话；M1 捕获 3 个版本和 3 条来源；重复零新增。**1 份快照缺乏确切源版本、1 条旧确认缺乏对应历史正文**，已保留 legacy 并计数，没有隐瞒为全部原生可用。

一次本机样本中，0007 恢复约 0.2 秒，M1 恢复约 0.3 秒，整个隔离集群加既有集成测试约 24 秒；这些只是小型合成数据测量。真实库体量、维护窗口、锁等待、RPO/RTO、远程备份及运行资源均未验收。

## 恢复决策与下一阶段

DDL 未提交时事务回滚；部分回填失败时保留已提交整页、停下并对账后重跑。结构已提交时**不删迁移记录、不 DROP 新表、不直接切回只懂旧域的代码**。

两次加密恢复均落在新建库，包含认证、队列和维护台账。备份使用 `--no-owner --no-privileges`，恢复后必须重新配置受限角色和辅助函数所有者，再验权才可供服务使用；不重放待处理任务或外部动作。升级后的新增事实、撤回、脱敏和擦除状态在恢复副本中均保留，不用升级前备份覆盖它们。

下一阶段是 P5：交付原生消息/理解写入事务、完整 JSON 边界、CAS/epoch、Worker 出队/发布复验以及分页、导出、删除、SSE 和旧客户端隔离；同时完成携带已执行迁移集合、能解释全部新事实的兼容回滚构建。之后才能评估 P6。当前提交不授权或自动触发业务库部署。
