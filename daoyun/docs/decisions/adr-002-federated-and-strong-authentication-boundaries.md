# ADR-002：联邦与强认证采用服务端事务和分阶段接入

## 状态

Accepted

## 日期

2026-08-07

## 背景

设备会话管理已经复用现有 Cookie、CSRF 和哈希会话边界。OAuth/OIDC、Passkey 与 MFA 会引入外部 issuer、浏览器挑战、恢复凭据和近期认证；如果把外部令牌或凭据直接并入用户主表，解绑、恢复和会话撤销将难以审计，也会扩大泄露影响面。

## 决策

1. 所有新认证方式都在服务端完成协议交换，成功后只创建 DaoYun 自己的会话。
2. OAuth/OIDC 使用配置 allowlist、授权码 + PKCE、`state`、`nonce` 和精确回调；外部身份单独建表，禁止仅凭邮箱自动合并。
3. Passkey 凭据与 MFA secret/恢复码分别独立存储；挑战和近期认证状态短时、单次、服务端绑定。
4. 先交付近期认证与审计基础，再按 OAuth/OIDC、Passkey、MFA 顺序分阶段实现；每阶段有独立迁移、契约、测试和回滚。
5. 高风险变更成功后撤销其他会话并轮换当前 CSRF，避免旧设备继续使用已变更的认证材料。

## 备选方案

### 将 OAuth token 存入用户主表

- 优点：查询路径简单。
- 缺点：把 provider 生命周期、密钥轮换和撤销语义耦合到核心身份表，容易误泄露。
- 结论：拒绝，使用独立外部身份和服务端短时事务。

### 允许同邮箱自动绑定

- 优点：首次登录体验更短。
- 缺点：邮箱声明不等于本地账户控制权，可能把攻击者的 provider 账户绑定到受害者账户。
- 结论：拒绝，必须在已认证账户内显式绑定并完成近期认证。

### 一次性接入三种认证方式

- 优点：功能完整。
- 缺点：依赖、迁移、恢复和测试风险耦合，难以独立回滚。
- 结论：拒绝，采用分阶段切片。

### 仅使用前端 bearer token 保存协议状态

- 优点：服务端实现较少。
- 缺点：扩大 XSS、重放和回调窃取影响，无法可靠绑定浏览器会话。
- 结论：拒绝，挑战、state、nonce 和近期认证全部服务端保存。

## 后果

- 需要新增外部身份、WebAuthn 凭据、MFA secret、恢复码、认证事务和审计事件等独立模型。
- 前端只处理短时 options 和泛化错误，不能读取长期令牌或恢复材料。
- 依赖选择必须经过许可证、维护状态、默认安全行为、RustSec 和故障测试评审；只有通过对应门槛的独立切片才能添加依赖。
- 高风险操作会复用设备会话列表和撤销能力，用户可以在一次安全变更后清理其他设备。

## OIDC 依赖技术评审

- `openidconnect 4.0.1`（MIT，MSRV Rust 1.65）使用 `default-features = false`、`reqwest`、`rustls-tls` 的独立解析结果仍引入 `reqwest 0.12.28` 和 `rsa 0.9.10`。后者命中无修复版本的 `RUSTSEC-2023-0071`；该风险主要影响可被远程观察的 RSA 私钥操作，但 DaoYun 不以“当前路径不可达”为由忽略锁文件漏洞，因此暂不采用该候选。
- `oauth2 5.0.0`（MIT OR Apache-2.0，MSRV Rust 1.65）默认 reqwest 后端固定在 `reqwest 0.12`，即使关闭其他 feature 也无法复用当前受限的 `reqwest 0.13.4`；授权码 token POST 使用现有客户端的显式表单编码实现，因此不引入该候选。
- `jsonwebtoken 11.0.0`（MIT，MSRV Rust 1.88）使用 `default-features = false` 与 `aws_lc_rs` feature，不引入 reqwest 或 `rsa`，支持 JWK RSA 组件、RS256、issuer/audience/exp/nbf 校验；最小树在 Rust 1.94 下编译成功，162 个依赖通过 `cargo-audit 0.22.2` 官方 advisory 快照且无漏洞。该库被固定为 ID Token/JWS 验证依赖。
- discovery 网络层使用直接依赖 `reqwest 0.13.4`（MIT OR Apache-2.0，MSRV Rust 1.85），固定 `default-features = false` 与 `rustls`；不启用系统代理、默认 TLS、压缩、Cookie、HTTP/2 或 JSON 反序列化 feature。
- 客户端固定 3 秒连接超时和 8 秒总请求超时、HTTPS-only、禁止自动重定向、只接受 `application/json`，并在 Content-Length 预检和逐块读取两处执行 64 KiB 上限。
- metadata 中 issuer 做逐字匹配；authorization、token、JWKS 端点只接受无凭据、无 fragment 的 HTTPS URL。1 小时缓存按 provider 合并并发首次请求，容量不超过 16 个 provider。
- RustSec Git 协议受本机网络阻断时，通过 GitHub 官方 ZIP 获取 advisory-db 快照；`cargo-audit 0.22.2` 对当前 Cargo.lock 的 303 个包报告 0 个漏洞。
- JWKS 响应复用 discovery 的传输边界，限制为 64 KiB/64 key；只缓存参数完整、用途和算法一致的 RSA、EC、OKP 公钥，拒绝 `oct`、私钥字段、重复或过长 `kid`，并要求 RSASSA modulus 至少 2048 bit。
- JWKS 缓存固定 15 分钟 TTL、16 provider 容量和 30 秒强制刷新冷却；失败从 30 秒指数退避到最多 5 分钟。刷新失败保留尚未过期的旧值，过期后不再返回陈旧密钥。
- token exchange 只向已校验的 token endpoint 发送 authorization code、精确 redirect URI、client credentials 和 PKCE verifier，要求 `application/json`、Bearer token type、64 KiB 响应上限，并以 zeroizing 容器保存短期 token 响应。
- ID Token 验证固定 RS256 和带 `kid` 的已缓存 RSA 公钥，要求 issuer、audience、exp、iat、nonce；`azp` 一旦存在必须匹配 client ID，多 audience 时强制要求 `azp`，nonce 使用恒定时间比较，验证失败不回显 provider 原文。
- HTTP start/callback 只接受 allowlist provider，使用 5 分钟 HttpOnly/Lax 浏览器绑定 Cookie 和单次事务；callback 只查找 `(provider_key, subject, issuer)` 已绑定身份，不按邮箱自动合并。成功后仅创建 DaoYun 会话并记录 provider key，不保存或返回上游 token。解绑在登录后通过独立的近期认证事务执行，并与最后登录方式保护、会话撤销和 CSRF 轮换保持原子一致。

参考来源：

- OpenID Connect Discovery 1.0：https://openid.net/specs/openid-connect-discovery-1_0.html
- `openidconnect 4.0.1` 文档：https://docs.rs/openidconnect/4.0.1/openidconnect/
- `openidconnect` crate 元数据：https://crates.io/crates/openidconnect/4.0.1
- `oauth2 5.0.0` 文档：https://docs.rs/oauth2/5.0.0/oauth2/
- `jsonwebtoken 11.0.0` 文档：https://docs.rs/jsonwebtoken/11.0.0/jsonwebtoken/
- `jsonwebtoken 11.0.0` crate 元数据：https://crates.io/crates/jsonwebtoken/11.0.0
- `reqwest 0.13.4` ClientBuilder：https://docs.rs/reqwest/0.13.4/reqwest/struct.ClientBuilder.html
- `passkey-auth 0.1.3` API 与安全边界：https://docs.rs/passkey-auth/0.1.3/passkey_auth/struct.Webauthn.html
- WebAuthn Level 3 RP ID 与 challenge 规范：https://www.w3.org/TR/webauthn-3/#sctn-rp-id
- RUSTSEC-2023-0071：https://rustsec.org/advisories/RUSTSEC-2023-0071
- RFC 7517：https://www.rfc-editor.org/rfc/rfc7517.html
- RFC 7518：https://www.rfc-editor.org/rfc/rfc7518.html
- RFC 8037：https://www.rfc-editor.org/rfc/rfc8037.html
- RFC 7636：https://www.rfc-editor.org/rfc/rfc7636.txt

## 实施前检查

- [x] 完成 OIDC provider 配置与授权事务内核。
- [x] 完成 OIDC 运行时依赖的初步许可证、维护状态、feature 和传输边界评审。
- [x] 完成当前 Cargo.lock、`reqwest 0.13.4` 与 `openidconnect 4.0.1` 候选依赖树的 RustSec 审计；拒绝含未修复漏洞的候选树。
- [x] 完成 discovery metadata 的 issuer、HTTPS 端点、授权码、S256、RS256 和响应大小校验，以及固定 TTL/容量缓存内核。
- [x] 完成受限 discovery 网络客户端、连接/总超时配置，以及总请求超时、重定向、响应类型/大小和并发请求合并测试。
- [x] 完成 JWKS 结构校验、缓存刷新、密钥轮换、失败退避、过期拒绝和刷新频率故障测试。
- [x] 完成授权码交换、RS256 ID Token 验证、HTTP start/callback、浏览器绑定 Cookie 和单次 callback 测试。
- [x] 完成 `external_identities` 独立模型、精确身份查找、本地会话创建和 OIDC 成功审计。
- [x] 完成登录后显式绑定与指定外部身份替换；产品设置页交互留给后续前端切片。
- [x] 完成登录后外部身份解绑、最后登录方式保护、会话撤销和 CSRF 轮换。
- [x] 完成授权码 token exchange 与 JSON/Bearer 响应边界测试，以及 RS256 ID Token 的 header、kid、issuer、audience、nonce 和时间声明验证内核。
- [x] 完成 WebAuthn RP/origin、discoverable credential 和 sign count 的库评估。
- [ ] 完成 TOTP 加密密钥轮换、时间窗口和恢复码慢哈希的库评估。
- [ ] 确认近期认证有效期、人工恢复政策、审计保留期和生产密钥管理方案。

## Passkey 依赖评审

- 采用稳定版 `passkey-auth 0.1.3`，许可证为 MIT OR Apache-2.0，MSRV Rust 1.85；隔离 Cargo probe 的 101 个依赖通过 `cargo audit --no-fetch`，未引入 `openssl` 或 `rsa`。
- 拒绝稳定版 `webauthn-rs 0.5.5` 作为本项目默认依赖：其 `webauthn-rs-core` 强制引入 `openssl`/`openssl-sys`，与本项目 Rust-only、Windows GNU 和容器最小运行时边界冲突；该候选 probe 的 117 个依赖虽无 RustSec 报告，但构建受 `link.exe` 缺失阻断。
- `passkey-auth` 的 `Webauthn::new` 固定服务端 RP ID 与 origin；注册使用 discoverable/resident key 偏好，认证可以发送空 `allowCredentials`；`finish_registration`/`finish_authentication` 校验 challenge、origin、RP ID hash、用户存在/验证和签名，认证计数回退返回错误。
- 运行时配置只允许服务端提供裸 RP ID、精确 origin 和显示名；客户端不能提交或覆盖这些值。应用设置 `strict_base64(true)`、`require_user_verification(true)` 和 `require_user_handle(true)`，挑战状态不启用危险序列化到浏览器的路径。
- 该 crate 不验证 FIDO Metadata Service 根信任，也不支持 RSA/TPM 等非本阶段能力；本项目只接受 `none` attestation、ES256/EdDSA，并把 AAGUID 作为不公开的审计字段保留。

## 关联文档

- [认证增强规格](../specs/federated-and-strong-authentication.md)
- [ADR-001：认证增强分期](adr-001-authentication-enhancement-phasing.md)
