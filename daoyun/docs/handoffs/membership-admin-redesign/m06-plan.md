# M06 会员权益 / 兑换商品 / 原子续期

状态：DONE；已完成并暂停。2026-10-07。用户已确认具体规格并要求实施；M01–M06 DONE，M07/M08 未开始。本文保留已确认的执行规格、实际完成任务及回滚限制；验收见 m06-result.md。

## 目标与已确认范围

在已有会员体系和固定 UID 用户详情中完成会员权益目录、版本、发放、续期、撤销与真实历史，收口兑换商品编辑及失败恢复。复用标准权益投影和积分兑换插件，不引入支付、充值、其他旧论坛兼容层或新依赖。完成本阶段实际验证后暂停。

依据：current.md、m01-baseline.md、m04-result.md、m05-result.md、docs/specs/membership-permissions-core-v2.md、docs/decisions/adr-008-plugin-first-feature-boundary.md。旧 docs/tasks/admin-membership-rebuild 的编号只作历史证据，不能替代最新 M06 定义。

## 当前事实与待修复问题

- standard_entitlements.rs 已有类型版本、不可变权限/额度快照、授予/撤销事务、revision、审计及 outbox；没有续期。
- 管理员权益列表已包含待生效、有效、过期、撤销记录，不重复建设伪历史列表。
- EntitlementsWorkspace 已支持固定 UID、未知授予原输入/同键重试、撤销 revision 刷新及 onChanged 摘要刷新。未知撤销弹窗已有 busy 关闭保护；本阶段补齐其他撤销/续期触发按钮的原请求写锁，避免切换目标。
- 当前授予幂等比较 ends_at。如果续期只覆盖 ends_at，原授予 key 重试会误冲突；续期必须保留原授予期限，并用原事实核对授予命令。
- RedemptionWorkspace 已使用真实商品目录、固定权益版本和 revision。409 的“重新加载商品”关闭弹窗并丢弃草稿，违背冲突后保留草稿的边界。
- 兑换由现有 Host 事务实现，插件提供能力；兑换 receipt 保存商品名、revision、价格、余额及权益关联。停用后历史和有效投影仍保留。M06 不把已有同类权益的兑换改成付费续期。

## 已确认的续期业务规则

用户确认采用以下延长期限命令：

1. 只允许未撤销、尚未到期的有限期权益续期；待生效但尚未到期的有限期权益可续期。数据库锁内使用实际时间判定。
2. ends_at 必须是绝对 UTC 时间，并严格晚于当前 ends_at；不缩短期限，不把有限期改为永久，不续期永久或已撤销权益。
3. 已过期权益不通过原行续期恢复；需要重新发放，保留原到期记录。若产品需要过期后恢复，需先确认恢复起点和历史语义，再调整本文。
4. 保留 entitlement id、starts_at、type_version、permission_snapshot、quota_snapshot、source、source_reference_id、原发放 reason 与 granted_by；只增加 ends_at、revision、updated_at。续期原因独立写入追加 receipt/审计。
5. 类型发布新版本、类型状态变化、兑换商品更新、插件停用均不改写既有授予快照；续期沿用原快照，不自动升级版本。
6. 不扣积分、不写 EXP、不生成治理能力；续期与兑换是独立命令。

## 已确认 API 与事务契约

所有路径以 /api/v1 为前缀。公开 DTO 位于 crates/api-contract，持久化记录不直接暴露。

- POST /admin/entitlements/{entitlement_id}/renew：entitlements.grants.write、Cookie/CSRF 和既有近期认证门槛。请求 user_id、expected_revision（>=1）、ends_at、reason（1–200 字符，非空白且无控制字符）、idempotency_key（1–64 ASCII 可见字符）。明确核对 URL 目标属于请求 UID，不能只相信前端固定用户。
- GET /admin/entitlements/users/{user_id}/renewal-requests/{key}：entitlements.grants.read；按 UID/key 查询原续期 receipt。不存在返回 404，404 只表示尚未找到，客户端不能据此宣布原写入未发生。
- 续期 mutation 响应区分不可变原 receipt、当前 entitlement 与 replayed。receipt 保存 UID、目标 id、actor、原 expected_revision、原 ends_at、新 ends_at、原因、key、结果 revision、审计 id、原 request_id、提交时间及原权限/额度快照。当前 entitlement 可已再次续期或撤销，不把它冒充原命令的结果。
- 同键以 UID 为作用域，完整规范化输入（含 actor、目标、原 revision、时间、原因）相同才重放。先查已提交 receipt，再校验新命令的当前 revision/期限。旧续期在后续续期或撤销后重放，返回原 receipt 和当前状态，不重新延长或恢复权益。
- 事务依次锁定该 UID 的协调行及目标 entitlement，锁后重新核对管理员有效状态和 capability、UID、revision 与期限。使用既有权限引擎；不承诺与跨领域 summary 同一快照。
- entitlement 更新、receipt、audit、outbox 同事务。审计失败全部回滚；同键并发只产生一次 revision、审计与事件。续期与撤销通过目标行锁和 revision 排他，冲突返回 409。
- renewal outbox 使用 standard_entitlement.renewed 与 entitlement.changed，dedupe key 包含操作、UID 和原 key，避免不同用户同 key 被吞。原 request_id 随 receipt 保留；每次 HTTP envelope 和 x-request-id 使用本次相同请求号。
- 400/401/403/404/409/422/503 的实际响应、no-store、非法 UUID/key、权限撤回、CSRF 与 OpenAPI 均有契约测试。任何 malformed/缺请求号响应按结果未确认处理。

## Schema 演进及原命令保护

本阶段只新增一对可回滚迁移：原始授予期限元数据和追加式 renewal receipt。现存有限/永久权益的原始 ends_at 按当前真实事实初始化，不造续期、审计或历史 receipt。所有权益生产入口（管理员、受控插件、积分兑换）都必须正确写入原授予期限；不得只改一个入口。

授予的同键比较继续核对原授予期限和完整输入；grant → renew → 原 grant 重放不能缩短期限、重新授予或误判为不同请求。新增续期 receipt 不改变原授予与撤销的 API 操作边界。

down 保留现有权益行、实际延长后的 ends_at、审计和 outbox，但丢弃新增原期限元数据与 renewal receipt；重新 up 不能恢复已删除的原命令事实。回滚不承诺撤销已完成续期，必须在结果文档披露这一限制。不得改已应用迁移，不删除数据库业务事实。

## 前端验收

- 当前 UID 详情和会员权益工作区共用续期动作；已撤销、永久、已过期记录给出真实状态与不可续期原因。
- 权益类型/版本展示普通能力和额度；运营文案统一“会员权益”，领域标识和历史规格标题保持原名。版块权限选择器文案属于 M07。
- 续期弹窗展示原期限、原类型版本/快照、新到期时间、操作原因；成功明确区分原 receipt 与当前权益，调用已有 onChanged 刷新摘要。
- 请求期间阻止重复提交、关闭和切 UID；响应未知冻结原输入、日期、revision 和 key，保留可见核实/完全相同命令重试入口，联动同详情的其他领域写锁。
- 409 保留新期限/原因，显式刷新目标基线，再生成新命令；不能自动重用旧 revision 发起变更。权限撤回后不能写入，同键恢复也由后端拒绝。
- 读取继续使用 abort/请求代次，迟到响应不能覆盖另一个 UID。维持 keyed 宿主边界，不宣称浏览器刷新/地址栏跳转有持久命令恢复。
- 兑换商品 409 重新读取当前目标 revision 并保留名称、价格、期限、上限、上下架和权益选择草稿；刷新失败不得解除冲突锁。未知保存保留原目标 UUID 与请求，不能盲目生成新商品。
- 商品目录真实展示价格、时长、限额、上下架、权益版本及快照；商品变更不污染兑换历史快照。插件停用明确说明保留历史与已获得有效权益；不伪造管理员全站订单接口或统计。
- 语义 list/fieldset/标题、表单错误定位、键盘焦点、按钮标签沿用现有组件；只用管理后台语义令牌，圆角不超过 8px。

## 任务与文件范围

每个增量先写失败行为/契约测试，再最小实现、定向验证。任务串行执行，探子只做只读定位/核验；代码修改与最终验证由主代理负责。

- [x] T01 续期 DTO/API 草案与失败用例：api-contract/src/standard_entitlements.rs、api-contract/src/lib.rs、API tests 的 M06 专用文件、infra tests/entitlement_renewals.rs。
  - 验收：新路径/认证/CSRF/request_id、原授予重放与期限边界有实际红灯。
- [x] T02 原始期限与续期事务：一对 migrations、infra/src/standard_entitlements.rs、相关 exports 和既有积分兑换生产入口。
  - 验收：snapshot 不变、同键并发、不同输入拒绝、renew/revoke 竞争、权限锁后复核、审计回滚、迁移 down/up。
- [x] T03 注册 API/OpenAPI：apps/api/src/admin.rs、apps/api/src/lib.rs、contract exports、src/api/generated.d.ts（由生成器同步）。
  - 验收：真实响应/no-store/header/UID/key/422 与 schema 一致；生成检查通过。
- [x] T04 前端适配与动作：src/api/admin.ts、src/api 的 M06 契约测试、EntitlementsWorkspace.tsx 及测试，必要的 UserMembershipActions/Panel 与详情测试。
  - 验收：固定 UID、成功刷新、409 草稿、原 receipt 核实、未知结果导航/写锁、已过期/永久/撤销边界。
- [x] T05 权益/商品列表及失败恢复：RedemptionWorkspace.tsx/.test.tsx、src/api/redemptions.ts/.test.ts（确有需要时）、管理作用域样式与既有会员工作区测试。
  - 验收：商品冲突草稿、只读/权限撤回、真实权益版本/快照、停用后历史/投影保留；不扩展插件业务规则。
- [x] T06 全量门禁与真实浏览器：全量前端、TS/E2E TS/build、Rust workspace/fmt/clippy、OpenAPI/generated；五宽度浅深主题、axe、键盘、真实固定 UID 续期/核实与回执。
  - 验收：保存实际日志、截图、请求和源码哈希；E2E 与 M05 90 passed/24 failed/230 skipped 的冻结失败集合逐项比较，既有失败仍保留 FAIL，跳过不算通过。
- [x] T07 独立只读核验及主代理收口：m06-result.md、current.md、gates/closeout、临时服务停止记录。
  - 验收：准确接口/迁移/测试数量、未验证边界、UTF-8 和 diff check；M06 实际完成才标 DONE，M07 未开始。

## 执行命令与目录

React 19/TypeScript/Vite/Vitest/Testing Library；Rust/Axum/SQLx/PostgreSQL 沿用锁定版本，不新增依赖。

- 前端：pnpm test；pnpm typecheck；pnpm test:e2e:typecheck；pnpm build。
- 后端：cargo test --workspace；cargo fmt --all -- --check；cargo clippy --workspace --all-targets -- -D warnings。
- 契约：pnpm generate:api --check；实际服务 OpenAPI 与导出比较。
- 浏览器：pnpm test:e2e；本阶段真实 320/390/768/1024/1440 浅深主题关键流程，输出 test-results/membership-admin-redesign/M06。
- SQLx 测试使用隔离数据库，保留已有 PostgreSQL 和业务记录。临时 API/gateway 仅在归属核实后启动和停止。
- 默认终端入口当前 CET 启动失败；可用 Node 进程入口已验证 git 读取。正式门禁必须实际执行，不能因入口错误冒充通过。

公开类型使用命名导出和 API snake_case，展示数据映射 camelCase；组件示例沿用：const saved = await renewStandardEntitlement(target.id, input, csrfToken)。

## 边界和评审门槛

始终：保留全部既有 dirty 修改，UTF-8 读写，先失败测试，真实服务端权限与事务审计，领域独立；不修改公共主题、不自动 commit/reset/stash/worktree/PR/发布。

先确认：本文新定义的续期期限/过期规则与契约；新增依赖、不可逆 Schema 或扩大业务/插件能力另行确认。当前迁移方案为增量且可回滚，不运行真实业务 mutation 作为测试替代。

永不：积分隐式改变 EXP，权益/勋章/组产生治理权限，前端重算最终授权，伪造历史/统计/receipt，把 skipped 或既有 FAIL 记成通过。

spec-driven-development 要求实施前人工审阅具体规格。用户于 2026-10-07 回复“确认，按此规格实施”；本阶段依照本文实施。

M07 的角色/版块治理来源与两层解释、M08 的二十项最终验收/八角色/1920 不属于本阶段。未验证项必须如实交接。
