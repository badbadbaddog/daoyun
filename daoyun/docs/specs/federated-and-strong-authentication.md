# 联邦与强认证规格

## 目标

在现有密码登录、Cookie 会话和设备会话管理之上，增加可审计、可撤销、可逐步上线的 OAuth/OIDC、Passkey 和多因素认证能力。所有新认证方式都必须最终创建或恢复 DaoYun 自己的服务端会话，不把外部令牌、WebAuthn 私密材料或恢复码交给浏览器长期保存。

## 交付顺序

1. 先完成账户安全基础：近期认证（step-up）会话、认证事件审计、统一的会话撤销服务。
2. 再接入 OAuth/OIDC 外部身份登录和显式账户绑定。
3. 再接入 Passkey 注册、登录和凭据管理。
4. 最后接入 TOTP 与恢复码 MFA，并把高风险操作接入近期认证和全账户会话撤销。

每个阶段必须有独立迁移、API 契约、OpenAPI、集成测试和回滚方案；未完成阶段不得写入运行时代码或数据库模型。

## OAuth/OIDC

### 配置与信任边界

- provider 只来自服务端配置，使用稳定的内部 `provider_key`；客户端不能提交 issuer、回调 URI、client secret 或 scope。
- 当前已实现 `DAOYUN_OIDC_PROVIDERS` 启动配置：JSON 数组最多 16 项，每项要求唯一的小写 `provider_key`、非空 `display_name`、HTTPS issuer、client 凭据和精确回调 URI；仅 loopback 回调允许 HTTP。
- 当前已实现 `GET /api/v1/auth/providers` 公开元数据端点，只返回 `provider_key` 和 `display_name`，未配置时返回空数组；issuer、client ID、client secret 和其他协议字段不会返回。
- 服务端已实现短时、单次、容量受限的 `state`/`nonce`/PKCE 事务，并通过 HttpOnly、SameSite=Lax、生产环境 Secure 的 5 分钟 Cookie 绑定发起登录的浏览器；start/callback 已启用，回调会清除绑定 Cookie。
- 当前已实现受限 HTTPS discovery、metadata 解析与固定 TTL/容量缓存；它只接受配置 issuer 的逐字匹配、HTTPS 且无凭据/fragment 的协议端点、`code`、`S256` 和 `RS256` 能力。
- 当前已实现 JWKS 结构校验与缓存内核：只保留用途/算法一致的 RSA、EC、OKP 公钥，拒绝对称密钥和私钥字段；缓存固定 15 分钟 TTL、16 provider 容量、30 秒刷新冷却、指数失败退避，并按 provider 合并并发请求。刷新失败可继续使用尚未过期的旧值，过期值不得返回。
- 只支持授权码流加 PKCE（S256）、`state`、`nonce` 和精确预注册回调 URI；禁止 implicit、resource-owner-password 和通配回调。
- access token、refresh token、client secret 只在服务端短期内存或加密密钥存储中使用，不落 `users` 表、不返回前端、不写日志。

### 账户绑定

- 外部身份以独立 `external_identities` 记录保存 `(provider_key, subject)` 唯一键、用户 ID、issuer、邮箱快照和时间戳；邮箱仅用于提示，不用于自动合并账户。
- 当前 callback 只允许已经存在于 `external_identities` 的身份建立会话；未绑定身份不会按 provider 邮箱查找或合并本地账户，而是创建短时、单次、浏览器绑定的服务端 claim 并 302 到 `/#oidc-claim`。claim 仅由 HttpOnly、SameSite=Lax Cookie 标识，服务端保存已验证的最小身份快照，浏览器不会收到 subject、issuer、上游 token 或完整邮箱。已登录用户可在本人资料页的“登录方式”区域显式绑定、替换或解绑身份；绑定和替换 callback 不创建新会话。
- 首次 OAuth 登录必须创建新账户或进入“登录后绑定”流程；已有本地账户不能仅凭相同邮箱自动关联。
- 绑定、解绑、替换主登录方式均要求近期认证；解绑最后一个可用登录方式时拒绝操作并返回结构化冲突。
- provider 返回的 profile 视为不可信输入，只接受经过长度、字符集和 URL 校验的字段。

### 已实现端点

- `GET /api/v1/auth/providers`：返回当前部署可用的公开 provider 元数据，不返回 secrets。
- `GET /api/v1/auth/oidc/{provider}/start`：从 allowlist 读取 provider、按客户端 IP 限流、获取受限 discovery metadata、创建一次性授权事务，设置浏览器绑定 Cookie，并用固定的授权码、`openid`、PKCE、state、nonce 和精确回调参数返回 302。
- `GET /api/v1/auth/oidc/{provider}/callback`：先校验并单次消费 provider/state/浏览器绑定事务，再交换 code、校验签名、nonce、issuer、audience、`azp` 和时间声明；只有已绑定且活动的本地用户会获得 DaoYun Cookie 会话，成功后 302 返回站点根路径。
- `GET /api/v1/auth/oidc/claim`：读取当前浏览器的未消费 claim，只返回 provider 名称、可选 profile 名称、可选用户名建议和脱敏邮箱提示。
- `POST /api/v1/auth/oidc/claim/account`：消费前校验新账户字段；在同一事务中创建用户、密码凭据、外部身份和 DaoYun 会话，成功后一次性消费 claim。
- `POST /api/v1/auth/oidc/claim/bind`：要求当前 Cookie 会话、CSRF 和一次性 `security.settings` 近期认证；在同一身份绑定事务中消费近期认证、绑定 claim、撤销其他会话并轮换 CSRF，成功后一次性消费 claim。
- `GET /api/v1/auth/identities`：返回当前用户已绑定身份的最小元数据，不返回 issuer、subject、邮箱或上游 token。
- `POST /api/v1/auth/oidc/{provider}/bindings`：近期认证后发起追加绑定事务；callback 成功后创建身份、撤销其他会话并轮换当前 CSRF，不创建新会话。
- `POST /api/v1/auth/oidc/{provider}/bindings/{identity_id}/replacement`：近期认证后发起指定身份替换事务；callback 在同一事务中替换目标身份并完成相同安全收尾。
- `POST /api/v1/auth/identities/{identity_id}/unlink`：近期认证后解绑外部身份，重复解绑按资源不存在处理。

解绑端点要求 Cookie 会话、会话绑定 CSRF 和一次性 `security.settings` 近期认证；身份不存在、已解绑或不属于当前账户统一返回 `auth.identity_not_found`。事务会锁定活动用户，删除前检查密码凭据或其他外部身份是否仍可用；删除最后一个当前支持的登录方式返回 `auth.last_login_method`。成功后撤销其他会话、轮换当前 CSRF Cookie，并写入只含 provider key 的 `auth.identity.unlinked` 审计事件。

授权事务须短时过期、单次使用、绑定 provider、回调 URI、浏览器会话和随机 state；当前内核已验证 provider、回调 URI、随机 state 与浏览器绑定值，HTTP 接入时必须把该绑定值设入并校验安全 Cookie；错误回调仍不得把 provider 错误原文回显给用户。

## Passkey

- 使用 `passkey-auth 0.1.3` 的 WebAuthn discoverable credential；凭据独立存储 `credential_id`、公钥、sign count、transport、创建和最后使用时间。
- RP ID、origin 和 RP name 由服务端配置并在启动和运行时校验；不接受客户端提交的 RP ID 或 origin，仅允许 HTTPS（loopback 开发环境允许 HTTP）。
- 注册和删除要求已有 Cookie 会话、会话绑定 CSRF 与一次性 `security.settings` 近期认证；登录断言成功后才创建普通 DaoYun 会话并记录最小安全审计。
- sign count 回退、用户句柄不匹配、挑战过期、绑定错配或重复使用均失败；计数器使用原子条件更新，凭据不自动删除。
- 浏览器只接收短时 challenge/options；challenge 服务端单次消费，注册挑战绑定用户和 session，断言挑战为匿名登录上下文，不能放入 localStorage。

### 已实现端点

- `POST /api/v1/auth/passkeys/registration/options`
- `POST /api/v1/auth/passkeys/registration/verify`
- `POST /api/v1/auth/passkeys/assertion/options`
- `POST /api/v1/auth/passkeys/assertion/verify`
- `GET /api/v1/auth/passkeys`
- `DELETE /api/v1/auth/passkeys/{passkey_id}`

所有 WebAuthn 请求和响应均由服务端 DTO 校验；credential ID 使用 base64url 传输，禁止把公钥材料或 sign count 暴露给公开资料 API。

## MFA

### TOTP

- 每个用户最多一个启用中的 TOTP 记录；secret 使用部署密钥加密后保存，明文只在 setup/verify 的短生命周期内存中存在。
- 启用流程为生成 secret、展示二维码/手动密钥、输入一次性验证码确认；仅生成 setup 不算启用。
- 验证使用 RFC 6238、30 秒时间步长、允许一个前后窗口，并对失败尝试限流；成功验证码不能在同一时间步重复使用。
- 禁用、重置密码、删除最后一个 Passkey 和解绑最后一个外部身份都要求密码或 Passkey 近期认证及当前 MFA 验证。

### 恢复码

- 生成至少 10 个一次性恢复码，只保存慢哈希和使用时间；明文只展示一次，不能通过 API 再次读取。
- 使用恢复码会原子标记已消费并撤销其他活跃会话；剩余数量低于阈值时提示重新生成。
- 重新生成会使旧恢复码全部失效，并要求近期认证和当前 MFA 验证。

### 端点草案

- `GET /api/v1/auth/mfa`
- `POST /api/v1/auth/mfa/totp/setup`
- `POST /api/v1/auth/mfa/totp/enable`
- `POST /api/v1/auth/mfa/disable`
- `POST /api/v1/auth/mfa/recovery-codes/regenerate`
- `POST /api/v1/auth/mfa/recovery-codes/use`

登录挑战在服务端记录 `pending_mfa` 状态；密码或 Passkey 第一步成功但 MFA 未完成时，不创建完整会话，也不返回 CSRF token。

## 近期认证与会话语义

- 近期认证是服务端短时状态，绑定用户、当前会话、认证方式和过期时间；默认有效 10 分钟，单次高风险操作可消费。
- `POST /api/v1/auth/recent-auth` 使用当前 Cookie 会话、CSRF 和密码建立近期认证；浏览器客户端只允许服务端 allowlist 中的 `security.settings` 操作，不接收或保存 bearer token。
- `POST /api/v1/auth/password` 只接收新密码，要求有效 Cookie 会话、CSRF 和一次性 `security.settings` 近期认证；成功后返回并设置轮换后的 CSRF token。
- 同一会话和操作的并发建立使用数据库原子替换，始终只有一个活动状态；消费通过用户、会话和操作原子更新，成功后不能重放。
- 数据库使用用户/会话复合外键防止跨账户错配；已撤销、过期或停用账户的会话不能消费已有近期认证。
- 近期认证成功后仍沿用现有 Cookie、CSRF 和 SameSite 策略，不向浏览器发放额外 bearer token。
- 启用/禁用 MFA、解绑身份、删除最后一个 Passkey、重置密码和恢复码使用成功后，撤销除当前会话外的全部会话，并轮换当前会话 CSRF token。
- 密码哈希更新、近期认证消费、其他会话撤销、当前 CSRF 哈希轮换和 `auth.password.changed` 审计写入在同一 PostgreSQL 事务中完成，任一步失败全部回滚。
- 每次认证、绑定、解绑、失败挑战、会话批量撤销都写入最小化安全审计事件；事件不得包含密码、令牌、完整邮箱、IP 或原始 User-Agent。

## 错误与隐私

- 统一使用现有 `error` / `meta` envelope；provider、credential、身份和恢复码不存在或不属于当前用户时分别使用不泄露归属的 `404` 错误。
- 验证失败使用泛化消息，日志只记录 request ID、内部事件类型和可脱敏的 provider key。
- 公开 API 不返回 issuer 的 token endpoint、JWKS 地址、client ID、credential 公钥、TOTP secret、恢复码或认证挑战。

## 依赖评估门槛

- OAuth/OIDC：`openidconnect 4.0.1` 的最小候选依赖树仍引入 `rsa 0.9.10` 并命中无修复版本的 `RUSTSEC-2023-0071`，同时形成 `reqwest 0.12`/`0.13` 双栈；`oauth2 5.0.0` 也固定 reqwest 0.12，因此两者均不引入。`jsonwebtoken 11.0.0` 使用 `aws_lc_rs`、不引入 reqwest/rsa，最小树在 Rust 1.94 下编译并通过 162 个依赖的 RustSec 审计，已作为 ID Token/JWS 验证依赖固定。
- discovery 客户端直接使用 `reqwest 0.13.4`，固定 `default-features = false` 与 `rustls`，不启用系统代理。客户端设置 3 秒连接与 8 秒总请求超时、HTTPS-only、禁止自动重定向，只接受 `application/json`，并在响应头和逐块读取时限制 64 KiB。
- discovery metadata 拒绝 issuer 不匹配以及非 HTTPS、有凭据或带 fragment 的协议端点；1 小时/16 provider 缓存按 provider 合并并发首次请求。
- 当前 Cargo.lock 和 `reqwest 0.13.4` 已通过 `cargo-audit 0.22.2` 的 RustSec 官方快照审计，报告 0 个漏洞；依赖变更后必须重新审计。
- JWKS 响应复用 discovery 的 HTTPS-only、超时、重定向、媒体类型和 64 KiB 读取边界；单个集合最多 64 个 key，`kid` 长度和唯一性、公钥参数、算法/用途一致性均在缓存前验证。
- 当前已实现受限 token exchange 与 ID Token 验证：token endpoint 仅发送固定授权码表单字段，响应限制为 JSON/Bearer/64 KiB；ID Token 固定 RS256，使用带 `kid` 的缓存 RSA 公钥验证签名，并检查 issuer、audience、`azp`、nonce、`iat` 与时间声明。HTTP start/callback、`external_identities` 查找、DaoYun 会话创建和最小化 `auth.oidc.succeeded`/`auth.oidc.failed` 审计已接通；外部 access/refresh token 不持久化、不返回浏览器。解绑事务、CSRF 轮换、会话撤销和 `auth.identity.unlinked` 审计也已接通。
- Passkey：评估 `webauthn-rs` 的 RP/origin 校验、discoverable credential 和 sign count 行为。
- MFA：评估 `totp-rs` 或等价实现的 RFC 6238 兼容性、加密存储和恒定时间比较。

依赖只有在许可证、维护状态、默认安全行为、RustSec 和故障测试均通过评审后才能进入 Cargo workspace。

评审来源：

- OpenID Connect Discovery 1.0：https://openid.net/specs/openid-connect-discovery-1_0.html
- `openidconnect 4.0.1` 文档：https://docs.rs/openidconnect/4.0.1/openidconnect/
- `openidconnect` crate 元数据：https://crates.io/crates/openidconnect/4.0.1
- `reqwest 0.13.4` ClientBuilder：https://docs.rs/reqwest/0.13.4/reqwest/struct.ClientBuilder.html
- RUSTSEC-2023-0071：https://rustsec.org/advisories/RUSTSEC-2023-0071
- RFC 7517：https://www.rfc-editor.org/rfc/rfc7517.html
- RFC 7518：https://www.rfc-editor.org/rfc/rfc7518.html
- RFC 8037：https://www.rfc-editor.org/rfc/rfc8037.html
- RFC 7636：https://www.rfc-editor.org/rfc/rfc7636.txt

## 验收标准

- OAuth/OIDC 只能使用 allowlist provider、精确回调和 PKCE，重复 callback 不能建立第二个会话。
- 近期认证错误密码受独立限流，成功状态绑定当前会话和操作并只能消费一次。
- 相同邮箱的本地账户和外部账户不会自动合并；绑定和解绑均具备近期认证与最后登录方式保护。
- Passkey challenge 单次消费且过期，sign count 回退被拒绝；删除最后凭据受保护。
- MFA secret 不出现在响应、日志或数据库明文中；恢复码只可显示一次且原子消费。
- 高风险认证变更撤销其他会话并保留当前操作上下文；所有端点有 OpenAPI、集成测试和安全审计覆盖。

## 非目标

- 本阶段不选择具体外部 provider、不实现运行时代码、不迁移生产数据。
- 不支持第三方 access token 代理、自动邮箱合并、短信 MFA、管理员代取恢复码或人工绕过近期认证。
