# Spec: Content Governance Reports

## Objective

为刀云增加最小可用的内容治理举报闭环。登录用户可以举报公开主题或回复；超级管理员可以按状态分页查看举报，并在一个事务内驳回、隐藏目标内容、暂停目标作者或将举报标记为处理中。所有管理处理写入现有 `admin_audit_log`，客户端继续使用现有响应 envelope、Cookie 会话和 CSRF 约束。

## Commands

- Rust tests: `cargo +1.94.1-x86_64-pc-windows-gnu test --workspace`
- Rust format: `cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check`
- Rust lint: `cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings`
- Frontend tests: `pnpm exec vitest run --maxWorkers=1 --minWorkers=1`
- Type check: `pnpm typecheck`
- Production build: `pnpm build`

## Project Structure

- `migrations/`：举报和内容治理持久化迁移。
- `crates/api-contract/`：公开请求、响应和错误 DTO。
- `crates/infrastructure/`：事务、分页和治理数据访问。
- `apps/api/`：Axum 路由、输入校验和 OpenAPI。
- `src/api/`、`src/components/`：后续接入用户举报入口和管理员列表。

## Code Style

```rust
let session = authenticate_state_change(&database, &runtime, &headers, request_id).await?;
let report = database
    .create_report(session.user.id, input)
    .await
    .map_err(|error| map_report_error(request_id, error))?;
```

- 公共 DTO 不暴露数据库模型。
- 外部输入在 API 边界校验；SQL 使用参数绑定。
- 列表接口使用稳定 UUID 游标和 `PageResponse`。
- 管理动作先锁举报，再锁目标内容，最后写审计记录。

## Testing Strategy

- PostgreSQL 迁移测试验证表、约束、索引和反向迁移。
- Infrastructure 测试验证目标可见性、重复举报、事务处理和内容状态计数。
- API 集成测试验证 Cookie/CSRF、权限、字段错误、分页、处理动作和审计写入。
- OpenAPI 测试验证新增路径和 schema 已公开。

## Boundaries

- Always: 校验输入、使用参数化 SQL、隐藏数据库错误、沿用 `request_id` envelope。
- Ask first: 新增外部对象存储、异步队列、第三方风控服务或新的管理员角色。
- Never: 接受客户端直接指定操作者、返回密码/会话/内部错误、绕过 CSRF 修改内容治理状态。

## Success Criteria

- [x] 登录用户可以提交主题或回复举报；同一用户对同一目标重复提交不会产生重复记录。
- [x] 不可见、已删除或不存在的目标统一返回 `404 report.target_not_found`。
- [x] 非管理员不能读取或处理举报；管理员读取使用稳定游标分页。
- [x] 处理动作在事务内更新举报、目标内容/作者状态和 `admin_audit_log`，失败时全部回滚。
- [x] 所有新增 endpoint 有统一错误 envelope、OpenAPI 和集成测试。

## Open Questions

- 举报通知、自动风控评分和对象存储附件属于后续切片，不在本切片内。
