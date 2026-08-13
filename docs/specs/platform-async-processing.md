# Spec: 平台异步处理基础切片

## Objective

为 DaoYun 建立可靠的异步处理基础，使业务事务可以把事件写入 PostgreSQL Outbox，后台 Worker 能够安全领取、重试和完成事件；后续 Redis 缓存、通知分发、索引刷新和异步清理均复用该边界。

本切片不新增公开 HTTP API；公开品牌接口保持响应契约不变，并增加可选 cache-aside 读取。内部基础设施和持久化契约均可独立验证。

## Assumptions

- PostgreSQL 是 Outbox 的唯一事实来源，Redis 只作为后续缓存或派发加速层，不能替代持久化事件。
- 事件 payload 使用 JSONB，事件类型由受控字符串标识，当前不接受任意动态 handler。
- 事件写入必须能够加入调用方的 SQLx 事务；独立写入仅用于内部任务或测试。
- Worker 使用数据库行锁和租约避免多实例重复处理；handler 成功后事件只标记一次完成。
- 失败事件按指数退避重试，超过最大尝试次数进入 dead 状态，不再自动领取。
- Redis 使用固定 `redis-rs 1.5.0`、惰性 `ConnectionManager`、TLS 和有界连接/响应超时；默认关闭且所有业务读取 fail-open。

## Contract

### Outbox event

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | UUIDv7 | 主键 |
| `event_type` | varchar(80) | 小写点分隔，长度 1-80 |
| `aggregate_type` | varchar(40) | 受控资源类型 |
| `aggregate_id` | UUID | 资源 ID |
| `dedupe_key` | varchar(160) | 同一事件类型和幂等键唯一 |
| `payload` | JSONB | 不得为 null |
| `status` | enum/string | `pending`、`processing`、`completed`、`dead` |
| `attempts` | integer | 0 至 25 |
| `available_at` | timestamptz | 下一次可领取时间 |
| `locked_until` | timestamptz | processing 租约截止时间 |
| `last_error` | varchar(500) | 仅保存泛化错误摘要 |
| `created_at` / `updated_at` | timestamptz | 服务端时间 |

### Internal operations

- `enqueue_outbox_event`: 在调用方事务中插入事件；相同 `event_type + dedupe_key` 返回已有事件且不重复写入。
- `claim_outbox_events_for_types`: 仅按 Worker 已注册事件类型原子领取到期事件，设置 processing、attempts + 1 和租约。
- `complete_outbox_event`: 仅持有有效租约的 Worker 可完成事件。
- `fail_outbox_event`: 仅持有有效租约的 Worker 可记录失败；未达到上限时计算退避，否则标记 dead。

## Commands

```text
cargo test -p infrastructure --test outbox
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
pnpm test
pnpm typecheck
pnpm build
```

## Project Structure

- `migrations/`：Outbox 表、索引、约束及反向迁移。
- `crates/infrastructure/src/outbox.rs`：DTO、状态和数据库事务操作。
- `crates/infrastructure/tests/outbox.rs`：幂等、领取租约、完成、重试和 dead 状态测试。
- `apps/api/src/worker.rs`：受控 handler 注册、批量处理、失败隔离和优雅停止。
- `apps/api/src/cache.rs`：Redis 配置、站点品牌 cache-aside provider 和失效 handler。
- `docs/specs/platform-async-processing.md`：持续维护的边界与验收标准。

## Code Style

```rust
let event = database
    .enqueue_outbox_event(&mut transaction, NewOutboxEvent { ... })
    .await?;
```

公共 DTO 与持久化模型分离；错误使用枚举并隐藏 SQLx 细节；时间和 UUID 使用现有 workspace 类型；所有写入都通过参数绑定。

## Testing Strategy

- 数据库集成测试验证真实 PostgreSQL 约束、事务回滚、并发领取和租约边界。
- 单元测试验证退避计算、事件类型和 payload 边界。
- 受控 Redis 协议测试验证缓存命中、写入、TTL 命令和删除；API 集成测试验证 Redis 不可达时回退 PostgreSQL。
- 本切片不新增前端测试，因为公开响应契约和 UI 行为不变。

## Boundaries

- Always：事件 payload 限制大小；幂等键和事件类型在边界校验；错误摘要不得包含令牌、密码或完整数据库错误。
- Ask first：增加新的公开 API、将 Redis 改为强依赖、扩大缓存到认证或用户私有数据。
- Never：使用 Redis 作为唯一事件存储；删除未完成事件；通过日志输出 payload 敏感内容。

## Success Criteria

- 新迁移可正向/反向执行，数据库约束拒绝非法状态。
- 相同幂等键并发 enqueue 只产生一条事件。
- 多 Worker 并发 claim 不会重复领取同一租约内事件。
- 完成和失败操作无法被过期租约或其他 Worker 冒用。
- 重试次数、指数退避和 dead 状态均有集成测试覆盖。
- workspace Rust 与前端质量门禁保持通过。

## Decisions

- Redis provider 固定 `redis-rs 1.5.0`，使用 Tokio、Rustls WebPKI roots 和可克隆自动重连的 `ConnectionManager`。
- 首个生产事件为 `cache.site_branding_invalidated`；品牌更新、管理员审计和失效事件在同一 PostgreSQL 事务提交。
- Redis 关闭或不可用时，品牌公开读取仍由 PostgreSQL 提供；失效 handler 在关闭状态下安全幂等完成。
