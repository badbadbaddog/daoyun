# Implementation Plan: 平台异步处理基础切片

## Overview

先建立数据库驱动的 Outbox 可靠性边界，再以一个真实业务事件接入 Worker，最后增加 Redis 缓存 provider。每个阶段都保持现有 API 和前端可运行。

## Task List

### Phase 1: Outbox 持久化基础

- [x] Task 1: 新增 Outbox 迁移和状态约束
  - Acceptance：表、索引、唯一幂等约束、租约字段和反向迁移存在；非法状态被数据库拒绝。
  - Verify：`cargo test -p infrastructure --test outbox` 的迁移与约束测试。
  - Files：`migrations/*outbox*.sql`、`crates/infrastructure/tests/outbox.rs`。

- [x] Task 2: 实现事务可组合的 enqueue/claim/complete/fail
  - Acceptance：enqueue 支持调用方事务；claim 使用 `FOR UPDATE SKIP LOCKED`；租约失效后可重新领取；重试超过上限进入 dead。
  - Verify：Outbox 集成测试覆盖幂等、并发、租约和退避。
  - Files：`crates/infrastructure/src/outbox.rs`、`crates/infrastructure/src/lib.rs`、测试文件。

### Checkpoint: Outbox foundation

- [x] `cargo test --workspace`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `cargo fmt --all -- --check`

### Phase 2: Worker 最小闭环

- [x] Task 3: 定义内部 handler trait 和周期性 worker 生命周期
  - Acceptance：worker 可优雅停止；每轮领取、处理、完成/失败均有 request-independent 结构化日志；单事件失败不会停止 worker。
  - Verify：worker 单元测试和一个内存 handler 集成测试。
  - Dependencies：Tasks 1-2。

- [x] Task 4: 接入一个真实事件类型
  - Acceptance：至少一个现有事务写入 outbox，worker 消费后产生可验证结果；重复消费安全。
  - Verify：真实 PostgreSQL 集成测试。
  - Dependencies：Task 3。

### Phase 3: Redis provider

- [x] Task 5: 评审并加入 Redis 客户端与环境配置
  - Acceptance：默认不启用 Redis；启用时校验 URL/TLS/超时，不记录凭据。
  - Verify：配置单元测试和 provider 连接失败降级测试。

- [x] Task 6: 实现 cache-aside 与 outbox 驱动失效
  - Acceptance：缓存命中/未命中、TTL、序列化错误和 Redis 不可用均有确定行为；数据库仍为事实来源。
  - Verify：Redis 集成测试或受控测试容器验证。
  - Dependencies：Tasks 3-5。

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 租约过期导致重复处理 | High | handler 设计幂等；完成操作校验租约 token |
| outbox 无限增长 | Medium | dead 状态、批量清理任务和索引监控留到后续运维切片 |
| Redis 依赖扩大构建树 | Medium | 先做依赖审计，默认 feature 关闭 |
| 事务写入点遗漏 | High | 先接入单一真实事件并加入集成测试，再扩展覆盖面 |

## Checkpoint: Complete

- [x] Rust workspace 测试、Rustfmt、Clippy 和 API 二进制检查通过。
- [x] 前端 Vitest、TypeScript、生产构建和 Chromium 质量用例通过。
- [x] OpenAPI 现有业务路径与响应契约测试保持通过。
- [x] 文档记录状态、配置和运维边界。
