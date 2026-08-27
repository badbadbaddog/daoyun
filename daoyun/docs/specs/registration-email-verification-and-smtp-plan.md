# Implementation Plan: 注册邮箱验证码与 SMTP 配置

## Architecture decisions

- 使用独立 SMTP 单例配置表；复用 `admin.configuration.read/write`，避免扩大权限模型。
- 使用独立部署密钥加密 SMTP 密码和待投递验证码；验证码校验只依赖 Argon2id 哈希。
- 复用 PostgreSQL outbox 保证发送重试；事件只引用挑战 ID。
- 用可选注册字段保持验证关闭时的现有 API 兼容性；前端通过公开 registration policy 决定是否展示验证码步骤。

## Phase 1: Contract and persistence

- [ ] Task 1: Add failing DTO/OpenAPI and migration tests
  - Acceptance: 新 schema、路径、错误码和数据库表约束由失败测试定义。
  - Verify: `cargo test -p api-contract`; infrastructure migration tests。
  - Files: api-contract tests、API OpenAPI tests、infrastructure database tests。

- [ ] Task 2: Add migrations and persistence operations
  - Acceptance: SMTP 配置可安全读写；挑战可创建、标记投递并在事务内一次性消费。
  - Verify: infrastructure SMTP/challenge tests pass。
  - Files: migrations、`crates/infrastructure/src/email.rs`、infrastructure tests。

### Checkpoint: persistence

- [ ] 正反迁移、约束、并发消费和 secret 不回传测试通过。

## Phase 2: SMTP admin vertical slice

- [ ] Task 3: Add encryption and SMTP transport behind a testable sender boundary
  - Acceptance: TLS 模式、凭据、超时和邮件构建均可测试；密钥缺失安全失败。
  - Verify: email module unit tests pass。
  - Files: Cargo manifests/lock、`apps/api/src/email.rs`、unit tests。

- [ ] Task 4: Add admin SMTP API and audit
  - Acceptance: read/write/test endpoints enforce capability and CSRF; password never returns.
  - Verify: admin API/OpenAPI integration tests pass。
  - Files: admin contracts、admin handlers、admin tests、OpenAPI schemas。

- [ ] Task 5: Add SMTP admin interface
  - Acceptance: 后台列表导航可进入“邮件服务”，可保存、保留/清除密码和发送测试邮件。
  - Verify: admin API/component tests、typecheck。
  - Files: `src/api/admin.ts`、tests、`AdminView.tsx`、tests、styles。

### Checkpoint: SMTP administration

- [ ] 后台 API、UI、审计和密码保护全部通过。

## Phase 3: Registration verification vertical slice

- [ ] Task 6: Add public policy/challenge endpoints and outbox handler
  - Acceptance: 泛化 202、60 秒冷却、10 分钟过期、5 次上限和重试发送生效。
  - Verify: auth/email API integration and worker tests pass。
  - Files: auth contracts/handlers、email handler、auth/worker tests。

- [ ] Task 7: Gate registration transaction on challenge consumption
  - Acceptance: 验证开启时只有正确且未消费挑战能创建用户和会话，关闭时保持兼容。
  - Verify: auth integration tests including concurrent replay pass。
  - Files: auth persistence、auth handler、auth tests。

- [ ] Task 8: Add registration verification UI
  - Acceptance: 根据 policy 展示发送按钮、验证码框、冷却和错误；提交新字段。
  - Verify: auth API/component tests、typecheck、build。
  - Files: `src/api/auth.ts`、tests、`AuthPanel.tsx`、tests、styles。

### Checkpoint: complete

- [ ] Rust workspace tests、fmt、clippy 全通过。
- [ ] Frontend tests、typecheck、build 全通过。
- [ ] 真实浏览器在 320/768/1024/1440px 验证管理与注册界面，控制台无错误。

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| SMTP 网络阻塞或临时失败 | 高 | lettre async transport、有界超时、outbox lease/retry/dead |
| 数据库/备份泄露验证码或 SMTP 密码 | 高 | AES-GCM 密文、Argon2id 哈希、outbox 仅存 challenge ID |
| 账号或邮箱枚举 | 高 | 泛化响应、复合限流、已注册邮箱不发送 |
| 注册与挑战并发重放 | 高 | 行锁和同事务一次性消费 |
| 管理员误开验证导致无法投递 | 中 | 配置完整性检查、测试发送入口、默认关闭 |
| 现有注册客户端被破坏 | 中 | 新字段可选，只有开关启用时强制 |
