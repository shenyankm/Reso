# 数据库 V2.3：九项审查修复台账

日期：2026-11-17。范围：数据库目标设计、字段关系、JSON 契约、五份替代 SQL 审阅草案、字段字典及离线正反例。原问题见[独立审查](database-independent-review-2026-11-17.md)；原记录及修前复现材料保留。**没有执行数据库迁移、SQL、回填、运行层接入或微信操作。**

## 逐项落实

| 原编号 | 修复 | 验证入口与反例 |
| --- | --- | --- |
| 1 | 按阶段放行 understanding / 三类练习 / professional_note，SQL 正文与父分支配对，跨行校验真实练习 kind | SQL 检查遍历所有正文约束并逐分支正向验证；额外旧 understanding-only CHECK、错父/错域/错练习 kind 均拒绝 |
| 2 | 资料请求的枚举、typed scope 和 manifest 同步为 6/8/8/10 类 | SQL 检查逐范围正向验证；追加旧六范围 CHECK、未知范围拒绝；四类新目标均有合法分支 |
| 3 | 新增 research_session_participants 和 corpus_asset_participants；一个通话根、当前清单、每版素材冻结清单分开；主要对象须唯一且有效；同意复合引用实际主体关系 | 一次母亲/孩子通话、两份素材仍计一次/1800 秒；第二主体可以授予 session 同意/请求；少一人授权、撤回、过期、错用途/错通话、旧快照被改或重复计数拒绝；逐人允许 participant 全局或特定 session 范围，局部撤回优先；全部主体泄漏组一致 |
| 4 | 真实事件为 action_code=payload.type=feedback，保留 helpful/misunderstood/unsuitable，支持投影明确映射 | 正例直接校验 InteractionPayload；三种 rating 和 mixed 正例；虚构 helpful 动作、unknown rating、额外正文、错主体/决策拒绝 |
| 5 | 题号与答案键共用 Code；作答表新增 answers_schema_version=2；请求 payload 同步 v2 | 点/冒号题号的草稿、提交、更正及实际题本联动；旧前导下划线题号 v1 只读；旧版本新写和非法键拒绝 |
| 6 | role_id 转映射前检查唯一，保留单一本人、台词引用及假设检查 | 同 ID 的家长/本人两种顺序均拒绝；未知角色引用、两个本人及非假设对方台词拒绝；完整唯一角色正例通过 |
| 7 | record_versions 增 signed_by_user_id、signer_credential_id、signed_at；三者成组、仅纪要可签；资质与签署者组合 FK | v1/T2 与 v2/T4 各保留签署；旧签署覆盖/清除、内容改写、借资质、错服务、早于创建拒绝；根只投影当前签署，不补造旧历史 |
| 8 | MessageCard v2 专业候选冻结 profile_version、ServiceProfileSnapshot、specialties；旧卡 v1 冻结只读 | 未申请前卡片即可重放公益/50 分钟；目录改收费/30 分钟不改旧卡；缺快照/版本/擅长方向、引用新目录回放拒绝；申请仍须当前核验 |
| 9 | followups 冻结同域版本或 snapshot+grant；exercise/会话/接收人复合配对，增加 source_invalidated_at | NVC v1 回访不随根 v2 移动；共同 action_agreement 经 action_followup 用途授权；错根/域/人/快照、重指、撤回仍提醒、保留派生副本、借 personal_context 越界均拒绝 |

## 配套文件与版本处理

- [目标设计](database-design-v2.md)：分域、跨表事务、冻结、签署、授权与擦除规则。
- [字段模型](database-model-v2.json)与[生成字典](database-field-dictionary-v2.md)：76 张目标表，919 条字段条目、268 处引用注解、120 个复合关系；字段条目不是最终总列数。
- [JSON 契约](database-json-contracts-v2.json)：63 个 JSONB 绑定。DraftAnswersV1、SubmittedAnswersV1、MessageCardV1 和 RequestedChangesV1 冻结旧读，原有 13 个冻结 V1 的验证含义保留；ServiceProfileSnapshot 不改旧申请结构。新增语义约束与纯 JSON 校验明确分开。
- [正反例](database-contract-examples-v2.json)和[设计检查器](../scripts/check-database-design.py)：检查默认值、旧读/新写分派及跨行状态。所有数据均为合成示例，不代表真实授权或专业审核。
- [SQL 与 manifest](database-drafts/README.md)和[草案检查器](../scripts/check-database-draft.py)：pglast 离线解析，逐字段/候选键/FK/JSON 容器/阶段分支比对并做破坏检查；不连接数据库或执行 SQL。五份都基于未改变的 0001–0007，不能连续执行。

研究来源摘要从每个确切 asset 的冻结主体/角色/唯一主对象行重建；当前清单更正不改变历史，撤回反查全部历史素材关联，许可仍实时核验。共同约定回访仅同事件 room→获准本人 private，使用 action_followup；没有放宽跨事件长期记忆的 personal_context。版本签署只允许单次写入事实，内容及旧版本不原地改；所有这些跨行/历史约束仍须下一阶段的真实事务和权限实现。

## 验证及独立复查

当前离线设计检查：294 个 JSON 正反例、398 个关系/状态例，共 692 项。7 个既有迁移文件及文件清单不变。

| 草案 | 新表 | 列定义 | FK / 复合 | 索引 | 排他 | 合法阶段分支 | 拒绝破坏版本 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1a | 8 | 142 | 32 / 15 | 19 | 0 | 0 | 19 |
| M1 | 20 | 409 | 123 / 47 | 37 | 0 | 7 | 28 |
| M2 | 31 | 619 | 204 / 90 | 61 | 0 | 12 | 48 |
| M3 | 41 | 776 | 249 / 108 | 83 | 2 | 13 | 62 |
| M4 | 55 | 913 | 288 / 120 | 102 | 2 | 15 | 86 |

三名独立子 agent 分别完成关系/SQL、JSON/兼容性和 Wang 业务/授权复查，均只读、未接触数据库。复查中另外确认并修正了原第 3 项的两处关联遗漏：只有清单哈希不能重建历史，以及只允许 session 授权会误拒合法的 participant 授权。新增素材冻结主体表及授权范围/优先级反例后再次复验，**没有剩余的已确认 P1/P2**。反馈动作说明和草案旧计数两处文字残留也已同步。

关系审查额外运行 173 个正文/父分支/签署/回访空值向量、15 个复合 FK 正反例和 27 个冻结主体关联向量；契约审查另做 22 个内存探针，核对原 13 个冻结 V1 的全部传递引用及新增 4 个冻结旧定义；业务复查重跑相关 63 例，并用 4 个新内存案例检查主对象更正、政策隔离和专门再同意。新旧历史的验证含义保持一致，没有重写旧正文或伪造历史来源。

最终可重复执行的检查为：

```sh
uv run scripts/check-database-design.py
uv run scripts/check-database-draft.py --self-test
npm test
npm run build
git diff --check
```

结果：692 个设计例通过；47 个合法阶段分支通过，五份草案合计拒绝 243 个破坏版本；109 个单元/组件测试通过，TypeScript/Vite 构建通过。所有 55 张目标新表的草案均启用/强制 RLS 且没有放行策略。原 7 个迁移文件摘要及清单保持不变。

这些证明字段/契约/关系及静态草案一致性，不证明 PostgreSQL 真实执行、并发事务、RLS 隔离、回填质量、原生 API/Worker 或专业有效性；本轮未执行数据库集成测试或打开微信。

## 停止点及下一阶段目标

本阶段以九项修复、独立复查和离线验证收尾，之后停止。下一阶段建议先制定 M1a/M1 的实施与回填验收方案：旧数据映射/未知值保留、失败回滚、角色与 RLS、原生写入事务及隔离测试用例；后续指令确定后再实施，当前不执行迁移或接入运行层。
