# 用户、成长、权益与治理核心 V2 规格

## 状态

Accepted，依据 `C:\Users\111\Desktop\22.md` V2.0 与 ADR-008。

## 目标

建立不可由插件替代的可信核心：账号状态负责最终拒绝，社区用户组负责普通社区允许与额度，治理角色负责治理操作，独立 EXP 驱动动态等级，Points 保持可消费账本，标准权益投影承载有期限的 VIP 类权益。后续签到、任务、VIP 套餐、勋章认证、运营玩法和支付渠道默认由官方或第三方插件实现。

## 技术栈

- Rust 1.94.1、Axum 0.8、Tokio 1.53、Serde、utoipa 5.5。
- PostgreSQL 16、SQLx 可回滚迁移。
- React 19、TypeScript、Vite、Vitest、Testing Library。
- Wasmtime Component Model 插件沙箱；业务插件使用新版本 WIT，不修改 `daoyun:plugin@0.1.0`。

## 命令

```powershell
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm typecheck
pnpm build
pnpm generate:api --check
$env:DAOYUN_LOCAL_E2E = "1"
pnpm test:e2e
```

## 项目结构

```text
migrations/                    可回滚 PostgreSQL Schema 迁移
crates/api-contract/           公共 DTO 与 OpenAPI Schema
crates/infrastructure/         事务、查询、授权与账本事实来源
apps/api/                      Axum 路由和输入边界
crates/plugin-host/            Wasmtime、WIT、能力与资源配额
src/api/                       生成类型的运行时映射
src/components/                用户侧与管理端展示
docs/specs/                    活规格与实施计划
```

## 核心模型

### 账号状态

- `active` 继续后续判定。
- `restricted` 按限制项拒绝写入。
- `suspended` 立即使会话与全部能力失效。
- 状态拒绝优先于用户组、标准权益和治理角色。

### 动态等级与 EXP

- `membership_levels.id` 使用 UUIDv7 稳定标识。
- `internal_key` 仅用于配置和审计，不承载序号语义。
- `level_order` 是正整数且唯一，不设技术上限。
- `required_experience` 在已发布且启用等级中严格递增。
- `experience_accounts` 保存不可消费的累计 EXP 和 `current_level_id`。
- `experience_ledger_entries` 采用追加式流水、业务幂等键和反向流水，不修改历史记录。
- Points 流水不得隐式写 EXP；补偿、退款和管理员赠分不得升级。
- 等级仅用于成长和展示，不参与普通社区权限与治理权限。

### 社区用户组

- `community_groups` 与 RBAC `roles` 分离。
- 用户可拥有一个基础组和多个附加组；成员关系支持生效、到期、撤销、来源、原因、revision 和幂等键。
- 布尔允许项采用任一有效组允许即允许。
- 数值额度取所有有效组的最大值。
- 用户组不提供显式拒绝；拒绝由账号状态、内容状态与安全策略负责。
- 默认注册事务为用户加入 `member` 基础组。

### 内容访问策略

- 首版支持公开、登录可见、指定社区用户组可见、有效标准权益可见和治理人员可见。
- 策略使用明确的 `any_of` 或 `all_of`，不得依赖等级、积分余额或前端入口隐藏。

### 治理作用域

- `exact` 仅覆盖当前板块。
- `subtree` 根据请求时的当前板块树覆盖当前板块及全部后代。
- 不保存静态后代列表；板块移动后权限结果必须立即随树变化。
- 置顶、加精、锁定、移动和板块内发言限制均要求独立 capability、revision、作用域、保护级别、审计和必要 Outbox。

### 标准权益投影

- 核心只保存插件和管理员可通过受控命令写入的标准权益事实：类型、权益快照、状态、生效/到期/撤销时间、来源、幂等键和 revision。
- VIP 套餐、兑换码、积分兑换流程和支付渠道属于插件；核心权限判定只读取标准权益投影。
- 标准权益不能包含治理 capability，插件停用不会隐式撤销既有有效投影。

### 插件业务边界

- 新 WIT/manifest 版本提供版本化事件、最小只读 DTO、受控写命令、插件专属存储、后台任务、受限 UI 插槽和固定交互动作。
- 插件无数据库直连、任意 HTTP 路由、任意治理 capability、WASI、网络、文件系统、环境变量或进程权限。
- 核心权限判定不在请求链同步调用插件。

## 公共接口方向

- 保留现有 `/api/v1/users/me/membership`，在过渡切片完成前不移除既有字段。
- 新增 `/api/v1/users/me/experience`、`/api/v1/membership/levels` 和 `/api/v1/users/me/groups`。
- 管理端等级、用户组、作用域与标准权益写入均使用 Cookie 会话、CSRF、近期认证、capability、expected revision 和事务审计。
- 所有版本化业务响应体与 `x-request-id` 使用同一 `request_id`，并定义 OpenAPI。

## 代码风格

```rust
pub async fn resolve_experience_level(
    transaction: &mut Transaction<'_, Postgres>,
    experience: i64,
) -> Result<MembershipLevelRecord, InfrastructureError> {
    // 查询只依赖已发布且启用的动态等级，不解析 internal_key。
    todo!()
}
```

- 公共 DTO 与持久化记录分离。
- 组件和领域数据使用命名导出。
- UUID、枚举、长度、revision 和幂等键在 API 边界校验，事务内重新鉴权。
- 不为旧论坛产品增加迁移或兼容逻辑；仓库自身 Schema 演进使用可回滚迁移。

## 测试策略

- 单元测试覆盖权限合并、额度取最大值、动态等级选择和插件契约纯逻辑。
- PostgreSQL 集成测试覆盖迁移正反向、幂等、并发、revision、事务审计和板块树动态作用域。
- API/OpenAPI 测试覆盖认证、CSRF、capability、稳定错误、隐私字段与 request ID。
- 前端测试覆盖运行时 DTO、权限入口、冲突恢复、可访问性和响应式状态。
- Chromium 覆盖 320、768、1024、1440px 的关键用户与治理流程。

## 边界

- 始终：先写失败行为测试；每个写入事务内重新鉴权并原子写审计；默认安全拒绝；保持插件数据隔离。
- 先询问：新增第三方依赖、不可逆 Schema 变更、让系统角色可编辑、扩大插件网络或文件能力。
- 永不：由等级、积分、勋章、VIP 或前端状态推导治理权限；让插件直连数据库；把可消费积分作为 EXP。

## 成功标准

- 动态等级没有 `lv_1..lv_20` 技术上限，Points 写入不会改变 EXP 或等级。
- 多社区用户组布尔允许稳定合并、额度取最大值，账号限制始终优先拒绝。
- `subtree` 治理授权随板块移动即时变化，无静态后代缓存泄漏。
- 标准权益叠加用户组但不能产生治理能力，到期后自动不再参与权限。
- 后续官方业务插件可通过相同沙箱、能力审批、配额、事件、命令、存储和 UI 协议交付。

