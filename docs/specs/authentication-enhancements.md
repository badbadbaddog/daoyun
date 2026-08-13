# 认证增强规格

## 目标

为已登录用户提供可查看和撤销的设备会话管理能力，并为后续 OAuth/OIDC、Passkey 和多因素认证保留清晰的账户安全边界。首期不改变现有密码登录、Cookie 会话、CSRF 或用户身份模型。

用户可以查看当前账户的有效会话，并撤销除当前会话外的其他设备会话；会话列表不暴露原始令牌、CSRF 令牌、完整 IP 地址或精确 User-Agent。

## 技术栈

- Rust 1.94.1、Axum 0.8、SQLx、PostgreSQL 16
- React 19、TypeScript、Vite、Vitest、Testing Library
- 现有 Cookie 会话、`api-contract` DTO、统一 API envelope 和 OpenAPI 3.1

## 命令

```powershell
pnpm test
pnpm typecheck
pnpm build
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace
```

## 范围

### 首期：设备会话管理

- 会话记录新增受控设备元数据：创建时间、最后活跃时间、撤销时间和服务端归类的设备名称；首期不存储 IP 或原始 User-Agent。
- `GET /api/v1/auth/sessions` 返回当前用户未撤销的会话，按最近活跃时间降序；当前会话以服务端令牌哈希精确标记。
- `DELETE /api/v1/auth/sessions/{session_id}` 撤销其他会话；不得撤销当前会话，且不存在、已撤销或属于其他用户的会话统一返回未找到。
- 两个端点均需要有效 Cookie 会话；删除操作额外需要现有 CSRF 请求头。
- 前端在账户入口提供会话列表、当前设备标记、撤销按钮、加载、失败和空状态。

### 后续切片：外部与增强认证

- OAuth/OIDC：只接受服务端配置的受信 issuer，使用授权码流加 PKCE、`state`、`nonce` 和精确回调 URI；不把第三方 access token 交给浏览器或存入用户主表。
- Passkey：使用 WebAuthn discoverable credential，凭据公钥、sign count 和 RP ID 独立存储；注册、删除和高风险操作必须要求近期认证。
- MFA：首期评估 TOTP 和恢复码；恢复码只保存慢哈希，启用/禁用 MFA 与重置密码必须撤销其他会话。

## 非目标

- 不在本切片接入任何外部身份提供商、WebAuthn 库或 MFA 依赖。
- 不支持会话跨用户转移、管理员读取原始会话令牌或通过前端展示完整网络标识。
- 不更改现有 30 天会话时长、Cookie 名称、SameSite 策略或首次登录行为。

## 项目结构

```text
migrations/                         会话设备元数据和索引迁移
crates/api-contract/src/auth.rs     公开请求与响应 DTO
crates/infrastructure/src/auth.rs   会话查询与撤销持久化
apps/api/src/auth.rs                路由、认证、CSRF 与 OpenAPI
apps/api/tests/auth.rs              API 集成测试
src/api/auth.ts                     浏览器 API 客户端和运行时校验
src/components/                     会话管理界面与组件测试
```

## 代码约定

```rust
let record = database
    .touch_session(&token_hash(session_token))
    .await
    .map_err(|error| {
        tracing::warn!(request_id = %request_id, error = %error, "Session lookup failed");
        service_unavailable(request_id)
    })?
    .ok_or_else(|| unauthenticated(runtime, request_id))?;
```

- 公共 DTO 位于 `crates/api-contract`，持久化结构不出现在 HTTP 响应中。
- 每个业务响应使用统一 envelope，并保持正文 `meta.request_id` 与 `x-request-id` 相同。
- 路由、OpenAPI 声明和行为测试在同一实现切片中更新。
- 设备显示名必须由受限输入派生，不信任或回显任意请求头内容。

## 测试策略

- 基础设施：查询只返回账户自己的活跃会话；撤销正确更新状态；索引和回滚迁移可用。
- API：匿名访问、CSRF 缺失、其他用户会话、当前会话、重复撤销、排序和 request ID。
- 前端：运行时 envelope 校验、当前会话展示、撤销确认与错误重试。
- 浏览器：320、768、1024、1440px 下无水平溢出，键盘可到达撤销控制。

## 边界

- 必须：所有写操作使用现有 Cookie 和 CSRF 保护；令牌只以哈希形式持久化；错误不得泄露会话归属。
- 需确认：新增 OAuth/OIDC、WebAuthn、TOTP 依赖；外部身份提供商；账户恢复策略；迁移生产会话数据。
- 禁止：在 URL、日志、响应或分析事件中记录原始会话令牌、CSRF 令牌、密码、恢复码或 OAuth token。

## 验收标准

- 登录用户仅能看到自己的活跃会话，且能辨认当前会话。
- 撤销其他会话后，该 Cookie 下的下一次认证请求返回未认证并清理 Cookie。
- 当前会话不能通过会话管理端点撤销，避免用户无意中使本次安全操作失去认证上下文。
- 所有端点具有 OpenAPI、行为测试和统一错误 envelope。
- OAuth/OIDC、Passkey、MFA 未在未批准的设计前进入运行时代码或数据库模型。

## 开放问题

- 首个支持的 OIDC 提供商及部署方配置方式。
- 后续是否需要在具备部署密钥轮换策略后保留加密或密钥哈希的 IP 风险信号。
- Passkey 与 MFA 启用、恢复、丢失设备之间的近期认证和人工恢复流程。
