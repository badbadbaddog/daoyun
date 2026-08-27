# Spec: 注册邮箱验证码与 SMTP 配置

## Objective

为 DaoYun 增加可由站点管理员配置的 SMTP 邮件通道，并在管理员启用“注册邮箱验证”后，要求访客先完成邮箱验证码校验，再创建账号和登录会话。未启用时保持现有公开注册行为，避免新安装实例因邮件未配置而无法注册。

本切片只覆盖注册邮箱验证和 SMTP 测试邮件，不实现验证码登录、找回密码、营销邮件或通过邮箱绕过 MFA。

## Assumptions and decisions

- SMTP 配置与注册邮箱验证使用两个独立开关；二者默认关闭。
- 只有保存了有效 SMTP 配置后才能启用 SMTP；只有 SMTP 已启用后才能启用注册邮箱验证。
- 验证码固定为 6 位 ASCII 数字，有效期 10 分钟，重发冷却 60 秒，最多失败 5 次。
- 请求验证码返回泛化的 `202` 响应，不透露邮箱是否已注册，也不返回验证码或邮件投递结果。
- 注册请求增加可选的 `email_challenge_id` 与 `email_verification_code`。注册验证关闭时兼容现有请求；开启时两者必填。
- 挑战记录保存验证码 Argon2id 哈希；为了 outbox 重试，待发送验证码另以 AES-256-GCM 加密保存，发送成功后清除密文。
- SMTP 密码使用 AES-256-GCM 加密保存；部署密钥来自 `DAOYUN_SMTP_ENCRYPTION_KEY`，不得通过后台页面配置、接口返回或日志输出。
- 邮件通过现有 PostgreSQL outbox 和受控 worker 发送；事件 payload 只包含 challenge ID，不包含验证码、SMTP 密码或完整错误。
- SMTP TLS 支持 `tls`（SMTPS）、`starttls`（强制升级）和仅限内网调试的 `none`。管理界面默认 `starttls`，并明确提示明文模式风险。
- 任何邮箱验证都不能替代或绕过现有 TOTP/恢复码 MFA。

## Public API contract

所有版本化业务响应继续使用统一 envelope，正文 `meta.request_id` 与 `x-request-id` 相同，JSON 字段沿用 snake_case。

### Public registration policy

`GET /api/v1/auth/registration-policy`

- `200`：返回 `email_verification_required`、`code_expires_in_seconds`、`resend_after_seconds`。

### Request registration email challenge

`POST /api/v1/auth/registration-email-challenges`

Request: `{ "email": "user@example.com" }`

- `202`：返回 `challenge_id`、`expires_at`、`resend_after_seconds` 和泛化提示。
- `422 request.validation_failed`：邮箱格式或长度非法。
- `429 auth.rate_limited`：邮箱/IP 或挑战仍处于重发冷却，携带 `Retry-After`。
- `503 auth.email_unavailable`：注册验证已启用但邮件通道不可用；不返回 SMTP 内部错误。

### Register

`POST /api/v1/auth/register`

在原请求上增加可选字段 `email_challenge_id`、`email_verification_code`。

- 注册验证关闭时保持现有行为。
- 注册验证开启时，挑战必须属于规范化后的请求邮箱、已成功投递、未过期、未消费且验证码正确。
- 验证成功、创建用户、创建会话和消费挑战必须处于同一数据库事务；并发提交最多成功一次。
- 验证码错误、过期、已消费、邮箱不匹配或尝试耗尽统一返回 `422 auth.email_verification_invalid`。

### Admin SMTP settings

- `GET /api/v1/admin/smtp-settings`：需要 `admin.configuration.read`；返回非敏感配置和 `password_configured`，绝不返回密码或密文。
- `PATCH /api/v1/admin/smtp-settings`：需要会话、CSRF 和 `admin.configuration.write`；空密码表示保留原密码，显式 `clear_password` 才删除密码。
- `POST /api/v1/admin/smtp-settings/test`：需要会话、CSRF 和 `admin.configuration.write`；向请求中的收件地址发送一封测试邮件，返回统一成功或泛化失败。

所有 SMTP 写入均记录最小管理审计，只记录是否启用、host、port、TLS 模式和发件地址，不记录用户名、密码、收件人或验证码。

## Data model

### `smtp_configuration`

实例单例配置：host、port、username、加密后的 password、TLS 模式、发件邮箱/名称、SMTP 启用状态、注册验证启用状态、更新时间和操作者。数据库约束限制长度、端口和枚举值。

### `registration_email_challenges`

保存规范化邮箱、验证码 Argon2id 哈希、加密的待发送验证码、投递时间、失败尝试、过期/冷却/消费时间和创建时间。挑战过期或消费后不能再次使用；用户创建事务以行锁保证一次性消费。

## Tech stack and official library decision

- Rust 1.94、Axum 0.8、Tokio 1.53、SQLx 0.9、AES-GCM 0.11、Argon2 0.5。
- SMTP 使用 `lettre 0.11.23` 的 Tokio 异步 transport 和 Rustls TLS。
- 远程连接使用 `AsyncSmtpTransport::relay` 或 `starttls_relay`；`none` 才使用不加密 builder，并设置有界超时。
- React 19、TypeScript、Vite、Vitest、Testing Library。

官方资料：

- https://docs.rs/lettre/0.11.23/lettre/transport/index.html
- https://docs.rs/lettre/0.11.23/lettre/transport/smtp/struct.AsyncSmtpTransport.html

## Commands

```text
pnpm test
pnpm typecheck
pnpm build
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings
```

## Project structure

- `migrations/`：SMTP 单例配置和注册邮箱挑战正反迁移。
- `crates/api-contract/`：公开 policy/challenge/register 与管理 SMTP DTO。
- `crates/infrastructure/`：参数化 SMTP 配置、挑战一次性消费和 outbox 写入。
- `apps/api/src/email.rs`：密钥、邮件模板、lettre transport 与 outbox handler。
- `apps/api/src/auth.rs`：公开 policy、验证码请求和注册验证编排。
- `apps/api/src/admin.rs`：SMTP 配置读取、保存和测试发送。
- `src/api/`：运行时校验的 auth/admin 客户端。
- `src/components/AuthPanel.tsx`、`AdminView.tsx`：注册验证码与 SMTP 管理界面。

## Code style

```rust
let challenge = database
    .consume_registration_email_challenge(&mut transaction, challenge_id, email, code)
    .await?;
```

公共 DTO 与持久化记录分离；边界校验外部输入；SQL 仅使用绑定参数；第三方 SMTP 错误只进入受限服务端日志并关联 `request_id`，不进入 API 响应或 outbox `last_error` 的敏感内容。

## Testing strategy

- 契约测试：DTO 序列化、可选注册字段、错误码、OpenAPI 路径/schema 和 request ID。
- 数据库测试：迁移正反向、单例配置、验证码哈希、加密篡改、冷却、过期、5 次上限、邮箱绑定和并发一次性消费。
- API 测试：匿名/权限/CSRF、密码不回传、泛化响应、限流、验证开关、注册事务和 SMTP 不可用。
- 邮件单测：使用 fake transport 验证模板、收发件人和 secret 不进入日志/错误；不连接外部 SMTP。
- 前端测试：发送验证码、冷却倒计时、错误恢复、注册 payload、SMTP 密码保留/清除和权限裁剪。
- 浏览器验证：管理 SMTP 表单和注册界面在 320/768/1024/1440px 无溢出；控制台无错误；不读取 Cookie 或浏览器存储中的敏感数据。

## Boundaries

- Always：参数化 SQL、AES-GCM 随机 nonce、Argon2id 哈希、一次性消费、CSRF、服务端 capability、泛化外部错误、受控超时和测试。
- Ask first：启用真实外部 SMTP、修改现有 MFA 语义、引入邮件供应商 HTTP API、改变公开注册默认开关。
- Never：提交部署密钥或真实 SMTP 凭据；返回/记录密码、验证码、密文；把验证码放入 outbox payload、URL、localStorage 或 sessionStorage；通过邮件绕过 MFA。

## Success criteria

- 管理员可保存、读取和测试 SMTP 配置，读取响应只显示密码是否已配置。
- 未配置部署密钥或 SMTP 不完整时不能启用注册邮箱验证，并得到可操作但不泄密的提示。
- 启用后，注册界面必须先发送并输入验证码；未验证、错误、过期、重放或邮箱不匹配均不能创建用户或会话。
- 同一挑战并发注册最多成功一次；错误尝试最多 5 次；重发至少间隔 60 秒。
- 邮件发送失败可由 outbox 自动重试，payload 与日志不含验证码或 SMTP 密码。
- 原有密码登录、注册验证关闭时的注册、Passkey/OIDC 和 MFA 行为保持通过。
- OpenAPI、Rust、前端、类型检查、构建与真实浏览器验证全部通过。

## Open questions

无。验证码登录、找回密码、邮件模板编辑与投递统计留待后续切片。
