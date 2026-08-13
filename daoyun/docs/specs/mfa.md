# Spec: TOTP 与恢复码 MFA

## Objective

在 DaoYun 现有 Cookie 会话、CSRF、近期认证和安全审计边界之上，增加可选的 TOTP 与一次性恢复码多因素认证。启用 MFA 后，密码登录和 Passkey 断言的第一步只创建服务端短时 `pending_mfa` 挑战，不创建完整会话；只有有效 TOTP 或恢复码通过后才创建 DaoYun 会话。

## Assumptions

1. PostgreSQL 仍是 MFA 状态、挑战和恢复码消费的唯一事实来源；不把 MFA 状态放在 Redis 或浏览器存储中。
2. TOTP 固定 RFC 6238 SHA-1、6 位数字、30 秒时间步长和前后各 1 个时间窗口，兼容主流认证器。
3. TOTP secret 使用 `totp-rs 6.0.0` 生成和验证；数据库只保存 AES-256-GCM 加密后的 secret，部署密钥由 `DAOYUN_MFA_ENCRYPTION_KEY` 注入，缺少密钥时 MFA 保持关闭。
4. 恢复码生成 10 个一次性、分组展示的随机码；数据库只保存 Argon2id PHC 慢哈希，明文仅在生成成功响应中展示一次。
5. 启用、禁用和恢复码重新生成属于高风险操作：需要当前 Cookie 会话、会话绑定 CSRF、一次性 `security.settings` 近期认证，并撤销当前账户其他活跃会话、轮换当前 CSRF 和写入最小安全审计。
6. 禁用和恢复码重新生成还必须通过当前 TOTP 或尚未消费的恢复码；启用只需验证待启用 TOTP 和近期认证。

## Public contract

### Authenticated MFA management

- `GET /api/v1/auth/mfa`：返回 `enabled`、`setup_pending`、`recovery_codes_remaining`，不返回 secret、哈希或挑战。
- `POST /api/v1/auth/mfa/totp/setup`：当前会话和 CSRF 保护；生成或替换 10 分钟内有效的待启用 secret，返回一次 `secret_base32` 和 `otpauth_url`。
- `POST /api/v1/auth/mfa/totp/enable`：请求 `{ "code": "123456" }`；验证待启用 secret、近期认证，在同一事务启用 TOTP 并生成 10 个恢复码；响应只展示本次恢复码和轮换后的 CSRF。
- `POST /api/v1/auth/mfa/totp/disable`：请求 `{ "code": "123456" }` 或恢复码；要求近期认证和当前 MFA 验证，原子关闭 TOTP、删除恢复码、撤销其他会话并轮换 CSRF。
- `POST /api/v1/auth/mfa/recovery-codes/regenerate`：请求 `{ "code": "123456" }` 或恢复码；要求近期认证和当前 MFA 验证，原子消费旧码并生成新码、撤销其他会话和轮换 CSRF。

### Login challenge

- 密码登录或 Passkey 断言在 MFA 启用时返回 `202` 的 `MfaChallengeData`，只含短时 `challenge_id` 和过期时间，并设置 HttpOnly、SameSite=Lax 的浏览器绑定 Cookie。
- `POST /api/v1/auth/mfa/verify`：请求 `{ "challenge_id": "uuid", "code": "123456" }`；同时要求挑战 Cookie，验证码或恢复码只能成功消费一次；成功后创建普通 DaoYun 会话并清除挑战 Cookie。
- 挑战最多允许 5 次失败，过期、已消费、跨浏览器 Cookie 或超过尝试次数统一返回泛化认证错误；服务端不记录 code、恢复码或 challenge token。

## Data model

- `mfa_totp`：每个用户一行，保存加密 secret、算法/位数/步长、`enabled`、待启用过期时间、最近已消费时间步。
- `mfa_recovery_codes`：每个用户最多 10 个 Argon2id 哈希，`used_at` 原子标记；用户删除级联清理。
- `mfa_challenges`：短时、单次、容量受限的 pending MFA 挑战，保存用户、设备标签、浏览器绑定 token 哈希、尝试次数和过期/消费时间；不保存验证码。

## Security invariants

- secret、恢复码明文、挑战 token 不进入日志、响应以外的持久化字段、localStorage、sessionStorage 或 URL。
- AES-GCM nonce 每次加密随机生成；密文带版本和用户绑定 AAD，篡改或错误密钥只能返回泛化服务不可用错误。
- TOTP 验证成功后必须在 PostgreSQL 事务中原子推进 `last_used_step`，同一时间步不可重放；恢复码使用在行锁下只成功一次。
- 任何 MFA 高风险变更失败全部回滚，包括近期认证消费、MFA 状态、恢复码、会话撤销、CSRF 轮换和审计。
- 所有外部输入在 API 边界验证：code 只能是 6 位 ASCII 数字或固定恢复码格式，challenge UUID、字段长度和请求体均有限制。

## Commands

```text
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo audit --no-fetch
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```

## Project structure

- `migrations/`：MFA 表、索引、约束和反向迁移。
- `crates/api-contract/src/auth.rs`：MFA 状态、setup、变更、挑战 DTO。
- `crates/infrastructure/src/mfa.rs`：MFA 状态、一次性消费和原子事务。
- `apps/api/src/mfa.rs`：TOTP、恢复码、加密和 API handler。
- `apps/api/src/auth.rs`：密码/Passkey pending MFA 接入。
- `src/api/mfa.ts`、`src/components/MfaSettingsPanel.tsx`：客户端和安全设置 UI。

## Testing strategy

- RFC 6238 官方向量、code/恢复码边界、密钥缺失/错误和 AES-GCM 篡改使用单元测试。
- PostgreSQL 集成测试覆盖迁移回滚、TOTP replay、恢复码并发消费、挑战过期/跨浏览器绑定、变更事务回滚和会话撤销。
- API 集成测试覆盖认证、CSRF、近期认证、统一错误 envelope、OpenAPI 和 request ID。
- 前端测试覆盖 setup/enable、一次性恢复码展示、失效挑战、错误重试和 CSRF 更新；Chromium 测试验证登录 MFA 主流程无敏感数据进入浏览器存储。

## Boundaries

- Always：参数化 SQL、固定 TOTP 参数、恒定时间敏感比较、错误泛化、审计最小化、依赖 RustSec 审计。
- Ask first：改变现有登录响应状态、添加 MFA 依赖、引入部署密钥轮换或人工恢复策略。
- Never：明文保存 secret/恢复码、把 MFA challenge 放进 localStorage、通过邮箱自动绕过 MFA、管理员代取恢复码、在日志中输出验证码或 token。

## Success criteria

- TOTP setup/enable/disable 和恢复码 regenerate/use 都有完整 API、OpenAPI、数据库事务和回滚测试。
- 启用 MFA 后密码与 Passkey 登录都必须完成 pending MFA，不能提前创建有效会话或 CSRF token。
- 同一 TOTP 时间步和同一恢复码在并发请求中最多成功一次。
- MFA 失败不泄露账户存在性、secret、恢复码、挑战 token 或内部加密/数据库错误。
- 全量 Rust、前端、浏览器、OpenAPI、格式、Clippy 和 RustSec 门禁通过。

## Sources

- RFC 6238 TOTP：<https://www.rfc-editor.org/rfc/rfc6238.html>
- `totp-rs 6.0.0` API：<https://docs.rs/totp-rs/6.0.0/totp_rs/>
- `totp-rs` Builder/Totp：<https://docs.rs/totp-rs/6.0.0/totp_rs/struct.Builder.html>
- `aes-gcm 0.11.0` AEAD API：<https://docs.rs/aes-gcm/0.11.0/aes_gcm/>
