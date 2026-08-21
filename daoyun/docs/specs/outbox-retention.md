# Spec: Outbox 保留与清理

## Objective

为 `outbox_events` 建立有界的保留边界。当前 `completed` 事件永不删除，`dead` 事件永久堆积，
表和索引随站点运行时间单调增长；[平台异步处理计划](platform-async-processing-plan.md) 第 55 行
把"outbox 无限增长"列为 Medium 风险并显式推给"后续运维切片"，但此前没有任何 spec 或 plan 承接。

本切片补上该承接：定义终态事件的保留窗口、后台清理任务、按需清理 API 和保留指标，
使 Outbox 表的规模由保留策略决定，而不是由累计事件量决定。

本切片不改变 enqueue、claim、complete、fail 的既有语义，也不新增公开 HTTP API。

## Assumptions

- PostgreSQL 仍是 Outbox 的唯一事实来源；清理只删除已经到达终态且超过保留窗口的行。
- `completed` 表示 handler 已成功且结果已落库，行本身不再具备业务价值，只用于近期排障。
- `dead` 表示已耗尽重试，需要人工介入。它的保留窗口必须显著长于 `completed`，
  否则运维会在发现问题之前丢失现场。
- `pending` 和 `processing` 是未完成状态，任何情况下都不得删除；
  这与 [平台异步处理规格](platform-async-processing.md) 的 `Never：删除未完成事件` 边界一致。
- 清理是纯运维操作，不产生业务副作用，因此不写入业务审计，只写入管理审计。
- 单实例与多实例部署共用同一套清理逻辑，不引入外部调度器或 cron 依赖。

## Contract

### 保留窗口

| 状态 | 默认保留 | 环境变量 | 允许范围 |
| --- | ---: | --- | --- |
| `completed` | 7 天 | `DAOYUN_OUTBOX_COMPLETED_RETENTION_DAYS` | 1 至 90 |
| `dead` | 90 天 | `DAOYUN_OUTBOX_DEAD_RETENTION_DAYS` | 7 至 365 |
| `pending` / `processing` | 永不删除 | — | — |

越界或无法解析的配置在启动边界拒绝，与 `CacheConfig::from_environment` 和
`ObservabilityConfig::from_environment` 的失败方式保持一致，不静默回退默认值。

### Internal operations

- `delete_expired_outbox_events(limit)`：按批删除 `completed_at` 早于 completed 窗口的 `completed` 行，
  以及 `updated_at` 早于 dead 窗口的 `dead` 行。使用 `FOR UPDATE SKIP LOCKED` 选取候选，
  与 `claim_outbox_events_matching` 和 `expire_admin_user_statuses` 的批处理模式一致。
  单批上限 1000 行，返回按状态分列的删除计数。
- `outbox_retention_snapshot()`：返回各状态行数与最早 `created_at`，供运维汇总和指标使用。

删除必须是"选取候选后再按 ID 删除"的两步操作，不得写成无界 `DELETE ... WHERE status = 'completed'`：
后者在积压表上会长时间持锁，与 worker 的 claim 事务争用。

### 后台任务

新增 `OutboxRetentionWorker`，形状对齐既有 [restriction_worker.rs](../../apps/api/src/restriction_worker.rs)：

- 默认 `poll_interval` 1 小时，`batch_size` 500；构造时校验区间，非法配置返回构造错误。
- 每轮删除至多 `batch_size` 行；删除数等于批上限时立即继续下一批，直到批次不满或收到关闭信号。
- 单轮失败只记录错误并继续下一轮，不终止任务；`watch::Receiver<bool>` 关闭信号即时生效。
- 在 [main.rs](../../apps/api/src/main.rs) 与既有四个 worker 并列 spawn，共用同一 `shutdown_tx`。

### 管理 API

`POST /api/v1/admin/outbox/cleanup` 提供按需清理，用于不便等待轮询的运维场景。

- 要求 Cookie 会话、会话绑定 CSRF 和既有 `operations.alerts.write` capability。
  不新增 capability：清理是运维写操作，与告警规则写入同属一类，
  新增第 55 个 capability 只会扩大授权矩阵而不增加实际隔离。
- 请求体为空；保留窗口只来自服务端配置，不接受客户端指定，避免通过 API 绕过保留下限。
- 响应返回 `deleted_completed`、`deleted_dead` 和 `remaining_total`。
- 成功写入 `admin_audit_log`，action 为 `outbox.cleanup`，摘要只含三个计数，
  遵循 [全域业务操作审计规格](business-audit.md) 的固定白名单：不含事件 ID、类型、payload 或错误摘要。

### 指标

`GET /metrics` 增加 `daoyun_outbox_events_total{status}` 与 `daoyun_outbox_oldest_event_age_seconds{status}`。
标签只取四个固定状态值，保持 [运营监控与可观测性规格](operations-observability.md) 的低基数约束。

## Commands

```text
cargo test -p infrastructure --test outbox
cargo test -p daoyun-api --test operations
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
pnpm test
pnpm typecheck
pnpm build
pnpm generate:api --check
```

## Project Structure

- `migrations/`：终态保留索引及反向迁移。
- `crates/infrastructure/src/outbox.rs`：保留配置、批量删除和快照查询。
- `crates/infrastructure/tests/outbox.rs`：保留窗口、批次边界和未完成事件保护测试。
- `apps/api/src/retention_worker.rs`：清理任务生命周期。
- `apps/api/src/operations.rs`：清理 API、capability 校验和审计写入。
- `docs/specs/outbox-retention.md`：本文件。

## Code Style

```rust
let deleted = database
    .delete_expired_outbox_events(config.batch_size)
    .await?;
```

保留窗口使用 `time::Duration` 而非裸整数；删除计数按状态分列返回，不合并为单个 `usize`，
以便审计摘要和指标分别归因。SQL 全部参数绑定，不拼接窗口天数。

## Testing Strategy

- PostgreSQL 集成测试：`completed` 与 `dead` 分别在窗口内保留、窗口外删除；
  `pending` 和 `processing` 无论多旧都不被删除；批上限被遵守且返回计数准确。
- 并发测试：清理与 `claim_outbox_events` 并发执行时，正在处理的事件不被删除，
  且 `SKIP LOCKED` 不会让清理阻塞在 worker 的行锁上。
- 配置单元测试：越界天数、非数字和空值在启动边界被拒绝。
- API 集成测试：缺少 capability、缺少 CSRF、无会话分别返回稳定错误；成功路径写入一条审计。
- 迁移测试：新索引正向和反向执行。

## Boundaries

- Always：只删除 `completed` 与 `dead`；删除批量有界；保留窗口只来自服务端配置。
- Ask first：缩短默认保留窗口、把清理改为同步阻塞 API、将终态事件归档到外部存储。
- Never：删除 `pending` 或 `processing` 事件；接受客户端指定的保留窗口；
  在日志、审计或指标中输出事件 payload、`dedupe_key` 或 `last_error`。

## Success Criteria

- 超过保留窗口的 `completed` 与 `dead` 事件被删除，窗口内的事件保留。
- 未完成事件在任何路径下都不被删除，并有测试证明。
- 清理与 worker 并发执行时不互相阻塞，也不删除已被领取的事件。
- 表规模在持续运行下由保留窗口决定，`daoyun_outbox_events_total` 可观测。
- 越界保留配置在启动时失败，不静默回退。
- Rust workspace 与前端质量门禁保持通过。

## Decisions

- 复用 `operations.alerts.write` 而非新增 `outbox.cleanup` capability：
  清理与告警规则写入同属运维写操作，且 [附件生命周期清理](../project-status.md) 新增
  `attachment.cleanup` 的理由是它删除用户上传的对象存储数据，属于不同风险级别；
  Outbox 终态事件不含用户内容，不需要独立授权维度。
- 采用后台任务加按需 API 的双路径，而非仅 API：仅 API 会让保留边界依赖人工执行，
  与"表规模由策略决定"的目标相悖；仅后台任务则在积压事故中缺少即时手段。
- 不使用 PostgreSQL 分区表：当前事件量级下，带索引的批量删除足够，
  分区会把迁移、约束和 `FOR UPDATE SKIP LOCKED` 的复杂度提高一个量级。
- `dead` 保留 90 天而非与 `completed` 一致：dead 事件是需要人工介入的现场，
  7 天窗口在低频故障下会在被发现前清空。
