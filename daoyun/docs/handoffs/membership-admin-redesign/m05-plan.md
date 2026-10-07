# M05 用户组 / 成长 / 积分 / 勋章后台

状态：DONE / PAUSED。2026-10-06。用户“继续”后完成本阶段，现已暂停，未进入 M06。

## 范围与裁决

复用 M04 固定 UID 入口、已有用户组目录/关系、动态成长等级 CRUD 与勋章目录。仅补真实运营能力：管理员 EXP 调整/冲正与分页流水、管理员积分分页流水、勋章独立幂等回执与核实、用户组配置分区。EXP、积分、勋章、社区组均不产生治理权限。较新 core-v2 和 2026-09-05 勋章目录规格优先于旧固定等级/17 项业务目录。现有素材可复用，业务目录无限制。

七分类具体原文未在现有需求文档中列出；按现有普通权限/额度分为基本信息、浏览与发言、互动与私信、附件与下载、资料与外链、审核要求、成员与期限，不扩展白名单。成员与期限复用既有关系管理。

## 契约先行

- EXP 读使用 membership.rules.read；写使用 membership.rules.write，Cookie/CSRF 与现有状态变更认证，事务内复核权限。GET /admin/membership/users/{user_id}/experience 返回真实账户；GET .../experience/ledger 返回 PageResponse。用户不存在 404，存在但未初始化账户返回明确 null；读取不初始化。
- POST /admin/membership/experience：user_id、amount（非零安全整数）、reason（人工原因）、expected_revision（正整数）、idempotency_key（必填 1–64 ASCII 可见字符）、reversal_of（负值必填，正值为空）。ledger 的技术 reason 使用 admin.adjustment/admin.reversal，人工原因独立保存。同键先核对完整输入，再检查新请求版本；409 保留原因并刷新账户。复用追加事务，原子 ledger/account/outbox/audit。冲正必须精确抵消同 UID 原始正流水且只能一次，不自动降级；不得冲正冲正流水。回执区分原流水 balance/revision 与当前账户，重放不得误报再次增加。
- 积分 GET /admin/membership/users/{user_id}/points/ledger 复用 membership.points.grant 既有读取门槛与 DAO，分页 limit 1–50，默认 20；存在但未初始化为真实空页。无独立读取 capability，本阶段不扩大角色权限。
- 两类流水均按 created_at/id 倒序、cursor 限于同 UID；非法/跨 UID cursor 拒绝，不能跨用户读取。统一 request_id 和 no-store，完整 OpenAPI/generated。
- 勋章现有 grant/revoke 请求增加必填 expected_revision（>=0）与 idempotency_key（1–64）。新增真实用户勋章状态读取（revision、当前持有）及按 UID/key 查询原回执。读取 membership.medals.read；写 membership.medals.grant，事务内复核权限。
- 勋章持有表保持现有语义；新增用户勋章 revision 状态与追加请求回执。grant/revoke/自动授予锁同一 UID 状态，新命令先查原 key，完整 actor/operation/target/reason/revision 不同则 409；同输入返回原 receipt。旧 grant 经 revoke 后重试绝不重建持有。新 key/version 才能再次授予。回执保存受影响事实、版本、审计 ID、原 request ID、时间；没有变更的回执明确 affected=false，不能冒充审计事实。未知回执 404 仅表示尚未找到，可用完全相同参数/键核实，不能改参数。
- 两个可回滚增量迁移仅新增账本元数据与勋章状态/回执，保留既有账本/持有/审计，不修改已应用迁移、不新增依赖。

## 增量与验收

- [x] T01 积分管理分页契约、鉴权/UID/cursor/未初始化失败测试、最小 endpoint 和前端映射；定向验证。
- [x] T02 EXP 原子管理员命令、revision/幂等/冲正/审计失败测试，迁移、真实分页与账户契约；定向验证。
- [x] T03 勋章持久回执、grant→revoke→旧 grant 与并发/自动授予版本失败测试，迁移、状态/核实 API；定向验证。
- [x] T04 成长/积分工作区与 M04 UID 入口接真实账户和流水，勋章共享安全操作与回执，未知结果冻结参数和同键核实；行为测试验证无权、409、失败、空页、续页、切 UID 异步隔离。
- [x] T05 用户组七类配置、默认基础组/普通能力/额度/只读边界与稳定工作区可访问结构；行为测试。
- [x] T06 Rust workspace/fmt/clippy、OpenAPI/generated、前端全量/TS/E2E TS/build/diff；真实浏览器五宽度/浅深主题、键盘、axe、截图与默认 E2E 比较冻结失败集合。
- [x] T07 独立只读 review 后主代理最终核验，更新结果/当前交接，停止本轮临时服务并暂停。

## 证据与限制

证据目录 test-results/membership-admin-redesign/M05。开始前源码哈希/副本与 git 状态已保存；保留全部既有 dirty 文件，无 commit/reset/stash/PR/发布。PostgreSQL 既有本地服务保留，SQLx 测试使用隔离数据库。M04 E2E 基线 90 passed/24 failed/230 skipped；同集合必须保留 FAIL，不能计入新通过。M06 权益/兑换、M07 治理、M08 八角色/1920 验收不属于本阶段。

官方依据：Axum 0.8.9 Query https://docs.rs/axum/0.8.9/axum/extract/struct.Query.html；PostgreSQL 16 FOR UPDATE https://www.postgresql.org/docs/16/explicit-locking.html。SQLx 0.9.0 官方在线页面不可访问，使用本机同版本源码核对事务 API 后实现。

## 最终验收入口

完整结果见 [m05-result.md](m05-result.md)，当前交接见 [current.md](current.md)。最终门禁见 test-results/membership-admin-redesign/M05/gates.json：前端 125 文件 / 1205 通过；Rust workspace 509 通过 / 1 ignored，最终 operations 10 通过（不叠加重复用例）；TS、E2E TS、build、fmt、clippy、OpenAPI/generated 均通过。真实浏览器 192 张截图、90 次 axe 扫描、6 项键盘 / 13 项交互通过，WCAG 与 heading-order 均为 0。默认 E2E 保留 FAIL：90 通过 / 24 既有失败 / 230 跳过，失败集合与 M04 一致。独立范围与 E2E 证据核验完成；临时 API/gateway 已停止，PostgreSQL 保留。
