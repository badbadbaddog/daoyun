# Implementation Plan: MFA TOTP 与恢复码

## Architecture decisions

- TOTP 固定 SHA-1/6 位/30 秒/±1 窗口，使用 `totp-rs = 6.0.0` 的 RFC 6238 实现和 `gen_secret`、`otpauth`、`zeroize` 特性；不实现自定义 HMAC 算法。
- TOTP secret 使用 `aes-gcm = 0.11.0` 的 AES-256-GCM 加密，随机 96-bit nonce，密文格式为 `version || nonce || ciphertext+tag`，AAD 绑定 `mfa_totp:v1:{user_id}`。
- `DAOYUN_MFA_ENCRYPTION_KEY` 缺失时 runtime disabled；配置存在但不是严格 32-byte base64 key 时 API 进程启动失败，避免悄悄以不安全模式运行。
- MFA 高风险变更使用基础设施单事务：消费近期认证、锁定用户/MFA 行、验证并消费 TOTP/recovery、写入状态/恢复码、撤销其他会话、轮换 CSRF、写审计。
- `mfa_challenges` 使用随机浏览器绑定 token 的 SHA-256 哈希；客户端只持有 HttpOnly Cookie 和 UUID，服务端不持有可回放明文 token。

## Task list

### Phase 1: Contract and cryptographic foundation

- [x] Task 1: 固定依赖、补充 MFA spec/ADR、定义 API DTO 与 OpenAPI schemas。
  - Acceptance：所有字段、状态码、错误码和敏感数据边界写入公共契约；没有 secret/代码字段进入日志或响应之外的持久化。
  - Verify：契约序列化测试、OpenAPI schema test、`cargo audit --no-fetch`。

- [x] Task 2: 新增 MFA migrations 和 infrastructure DTO/事务接口。
  - Acceptance：表、索引、检查约束、级联删除和反向迁移；TOTP replay、恢复码消费、challenge consume 均原子且按用户范围。
  - Verify：PostgreSQL 迁移正反向、并发消费和晚期失败回滚测试。

### Checkpoint: Foundation

- [x] Rust contract/infrastructure tests, fmt and Clippy pass.
- [x] No secret material appears in database query fixtures, logs or test output.

### Phase 2: Authenticated TOTP management

- [x] Task 3: 实现 MFA runtime、AES-GCM 加密、TOTP setup/enable/disable 和状态接口。
  - Acceptance：setup secret 只返回一次；enable 必须近期认证和 code；disable 必须近期认证及当前 MFA 验证；变更撤销其他会话并轮换 CSRF。
  - Verify：RFC vectors、加密篡改、code replay、CSRF、recent-auth、rollback API tests。

- [x] Task 4: 实现恢复码生成、Argon2id 慢哈希、use/regenerate。
  - Acceptance：10 个恢复码只展示一次；并发 use 最多成功一次；regenerate 使旧码全部失效。
  - Verify：并发 PostgreSQL test、hash/input boundary tests and API integration.

### Phase 3: Login pending MFA

- [x] Task 5: 密码登录接入 pending_mfa challenge 和 verify endpoint。
  - Acceptance：MFA 开启时密码成功不创建 session/CSRF；挑战 Cookie 绑定、5 次失败上限、过期/重放/跨浏览器失败；验证成功才建 session。
  - Verify：API integration and frontend login flow tests.

- [x] Task 6: Passkey assertion 接入同一 pending_mfa service。
  - Acceptance：Passkey 第一阶段与密码共享 challenge/verify/会话收尾，不复制认证逻辑。
  - Verify：Passkey API integration, replay and browser flow tests.

### Phase 4: Web UI and release gates

- [x] Task 7: 安全设置 UI、客户端 runtime DTO 和登录 MFA 状态。
  - Acceptance：setup/enable 一次性码展示有明确确认；恢复码不可再次读取；页面不使用 localStorage/sessionStorage 保存敏感材料。
  - Verify：Vitest, typecheck, build, Chromium 390/1440 flows.

- [x] Task 8: 文档、ADR、项目状态和完整质量门禁。
  - Acceptance：README 配置、project-status、ADR 和 specs 同步；所有命令通过。
  - Verify：workspace/frontend/e2e/audit/code review.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 加密部署密钥丢失 | High | 启动时严格校验、文档化秘密管理；不支持明文 fallback |
| TOTP replay | High | DB 原子推进 matched step；同一时间步只接受一次 |
| 恢复码并发消费 | High | 行锁/条件 UPDATE，消费和变更事务原子 |
| pending challenge 被盗用 | High | HttpOnly token hash、短 TTL、attempt cap、single-use |
| 新依赖引入漏洞 | Medium | 固定版本、许可证和 RustSec 审计，拒绝 QR 图片重依赖 |

## Checkpoint: Complete

- [x] All success criteria and quality gates pass.
