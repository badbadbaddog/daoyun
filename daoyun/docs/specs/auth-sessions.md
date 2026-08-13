# Spec: 注册、登录、退出与服务端会话

## Objective

为已经完成初始化的刀云实例提供公开注册、登录、当前会话读取和退出能力。
会话由服务端保存，浏览器只持有不可逆、随机生成的 Cookie 令牌；密码始终使用
Argon2id v19 校验或生成。该切片的成功标准是用户能够注册并进入真实登录状态，
刷新页面后会话仍可恢复，主动退出或过期后不能继续访问受保护资源。

## Assumptions and Decisions

- 注册对初始化完成后的实例公开开放。
- 注册成功后立即创建会话；安装向导成功后不自动创建会话。
- 登录标识支持用户名或邮箱，用户名使用精确匹配，邮箱忽略大小写。
- 会话绝对有效期为 30 天，空闲有效期为 7 天，空闲时间不会超过绝对有效期。
- 生产环境使用 `__Host-daoyun_session`；本地 HTTP 开发环境使用
  `daoyun_session`，并且必须通过 `DAOYUN_COOKIE_SECURE=false` 明确配置。
- 会话 Cookie 为 `HttpOnly; SameSite=Strict; Path=/`；生产环境额外设置 `Secure`。
- CSRF 令牌使用独立的非 HttpOnly Cookie，同时由 `/auth/session` 返回给同源前端；
  所有带 Cookie 的状态写入请求必须发送相同的 `x-csrf-token` 请求头。
- 登录失败对不存在用户、错误密码和已停用用户使用同一错误响应，并对不存在用户
  执行哑 Argon2id 校验，避免账号枚举和明显的时序差异。
- 登录和注册使用进程内限流作为 MVP：IP 和规范化账号标识分别计算窗口；分布式
  限流属于 P2。
- 注册冲突使用不指明字段的通用冲突错误，避免泄露用户名或邮箱是否已存在。

## Public API Contract

所有响应沿用 `data`/`meta` 或 `error`/`meta` envelope，`meta.request_id` 必须与
`x-request-id` 一致。字段使用现有 Rust/JSON 的 snake_case 约定。

### `POST /api/v1/auth/register`

Request fields: `username`, `email`, `display_name`, `password`。

- `201`: 返回 `AuthenticatedSession`，同时设置会话和 CSRF Cookie。
- `409 auth.identity_unavailable`: 用户名或邮箱已经被占用，响应不指出具体字段。
- `422 request.validation_failed`: 返回非敏感字段校验错误。
- `429 auth.rate_limited`: 返回 `Retry-After` 秒数。
- `503 system.not_ready`: 实例尚未初始化或身份数据库暂时不可用。

### `POST /api/v1/auth/login`

Request fields: `identifier`, `password`。

- `200`: 返回 `AuthenticatedSession`，同时设置会话和 CSRF Cookie。
- `401 auth.invalid_credentials`: 所有失败身份情况使用相同响应。
- `422 request.validation_failed`: 标识或密码缺失/超出边界。
- `429 auth.rate_limited`: 返回 `Retry-After` 秒数。
- `503 system.not_ready`: 身份数据库暂时不可用。

### `GET /api/v1/auth/session`

读取会话 Cookie，刷新空闲时间并返回 `AuthenticatedSession`。缺少、撤销或过期会话
返回 `401 auth.unauthenticated`，同时清理无效 Cookie。

### `POST /api/v1/auth/logout`

要求有效会话和匹配的 `x-csrf-token`。成功撤销当前会话、清理两个 Cookie，并返回
`{ "logged_out": true }`。缺少会话返回 `401 auth.unauthenticated`；CSRF 不匹配
返回 `403 auth.csrf_failed`。

## Data Model

新增 `sessions` 表：`id`、`user_id`、`token_hash`、`csrf_token_hash`、创建时间、
最后访问时间、空闲过期时间、绝对过期时间、撤销时间和更新时间。令牌只保存
SHA-256 摘要；外键删除用户时级联删除会话；查询必须排除撤销和过期记录。

## Tech Stack and Commands

- Rust 1.94.1、Axum 0.8.9、SQLx 0.9.0、Argon2 0.5.3、Tokio 1.53.1、Utoipa 5.5.0。
- React 19、TypeScript、Vite、Vitest、Testing Library。

```text
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm typecheck
pnpm build
```

## Project Structure

- `migrations/`: 会话表正向和反向迁移。
- `crates/api-contract/`: 注册、登录、会话 DTO、错误码和 OpenAPI schema。
- `crates/infrastructure/`: 参数化 SQL、事务和会话查询。
- `apps/api/src/auth.rs`: API 边界验证、Cookie、CSRF、限流和密码校验编排。
- `apps/api/tests/auth.rs`: PostgreSQL 集成和 HTTP 契约测试。
- `src/api/auth.ts`: 运行时校验的前端会话客户端。
- `src/components/AuthPanel.tsx`: 注册、登录和退出 UI。

## Code Style

```rust
let session = database.create_session(user_id, token_hash, csrf_hash).await?;
Ok((StatusCode::OK, set_auth_cookies(session, response)))
```

公共 DTO 不暴露数据库模型；所有用户输入在 API 边界校验；SQL 使用绑定参数；
内部错误只记录 `request_id` 和服务端日志，不返回 SQLx、密码、令牌或堆栈信息。

## Testing Strategy

- 契约单测：DTO 序列化、错误码和 OpenAPI 路径/schema。
- PostgreSQL 集成测：注册唯一性、Argon2id 校验、会话创建/刷新/过期/撤销、事务回滚。
- HTTP 测试：Cookie 属性、CSRF、错误 envelope、限流、账号枚举隔离、请求 ID。
- 前端单测：响应运行时校验、注册/登录/退出状态、刷新恢复、失败重试和无 token 存储。
- 浏览器验证：真实 API 下注册、刷新、退出和受保护请求；检查控制台、网络和 Cookie。

## Boundaries

- Always: 参数化 SQL、边界校验、Argon2id、HttpOnly/SameSite Cookie、CSRF 校验、
  不记录敏感值、运行测试和构建。
- Ask first: 更换认证方案、放宽 Cookie/CORS/CSRF 策略、增加外部身份提供商、把限流
  改为分布式服务。
- Never: 把会话令牌或密码存入 localStorage、返回密码哈希、用用户输入拼接 SQL、
  通过错误信息区分不存在用户和错误密码、提交密钥或真实 Cookie。

## Task Breakdown

- [x] 会话迁移、DTO、错误码和 OpenAPI schema。
- [x] 注册 API：校验、Argon2id、唯一性冲突、限流和会话创建。
- [x] 登录/当前会话/退出 API：哑校验、过期、撤销和 CSRF。
- [x] 前端会话客户端与注册、登录、退出交互。
- [x] 浏览器、安全和代码质量审查，更新 `docs/project-status.md`。桌面/移动真实浏览器、刷新恢复、退出、撤销、安全响应头和全量质量门禁均已完成。

## Success Criteria

- [x] 未初始化实例不能注册或登录，初始化后可以注册第一个普通用户。
- [x] 注册和登录成功响应只包含公开用户信息与 CSRF 令牌，不包含密码、哈希或会话令牌。
- [x] 会话 Cookie 具有规定的名称、HttpOnly、Secure（生产）、SameSite=Strict、Path 和过期属性。
- [x] 页面刷新可通过 `/auth/session` 恢复会话；退出、撤销或过期后返回未认证。HTTP 与桌面/移动真实浏览器流程均已通过。
- [x] 所有 Cookie 状态写入请求缺少或伪造 CSRF 头时被拒绝。
- [x] 不存在用户、错误密码和停用用户的登录响应状态、错误码和消息一致。
- [x] 重复注册、并发登录、数据库故障、限流和 OpenAPI 契约均有自动化测试。
