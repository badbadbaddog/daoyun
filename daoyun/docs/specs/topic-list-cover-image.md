# Spec: 主题列表正文首图封面

## Objective

主题列表卡片直接使用文章富文本正文中按阅读顺序出现的第一张可公开图片作为封面，使同一个编辑器发布的图文内容自动进入双列图文流，无需作者重复设置封面。

## Tech Stack

- Rust 1.94.1、Axum 0.8、SQLx/PostgreSQL 16
- Serde、utoipa 5.5
- React 19、TypeScript、Vite、Vitest

## Commands

- API 测试：`cargo test -p daoyun-api --test attachments`
- 契约测试：`cargo test -p api-contract --test response_contracts`
- Rust 格式：`cargo fmt --all -- --check`
- Rust lint：`cargo clippy --workspace --all-targets -- -D warnings`
- 前端测试：`pnpm test`
- 类型检查：`pnpm typecheck`
- 生产构建：`pnpm build`

## Project Structure

- `crates/api-contract/src/topic.rs`：公开 `TopicSummary` 契约
- `crates/infrastructure/src/topics.rs`：批量读取正文并校验封面附件
- `apps/api/src/topics.rs`：列表与详情响应映射
- `apps/api/tests/attachments.rs`：上传、发布、列表和详情集成测试
- `src/api/topics.ts`：前端响应校验与展示模型映射

## Code Style

```rust
pub struct TopicSummary {
    pub image_url: Option<String>,
}
```

- 公共 DTO 与持久化模型分离。
- 列表封面批量查询，禁止逐主题 N+1 请求。
- URL 由服务端从附件 ID 生成，不接受正文中的任意外部 URL。

## Testing Strategy

- 契约测试覆盖 `image_url` 的 JSON 与 OpenAPI schema。
- 单元测试覆盖第一张图片、隐藏回复区图片和非法附件 ID。
- API 集成测试覆盖可公开图片返回缩略图 URL。
- 真实浏览器验证首页出现 `media` 卡片且控制台无错误。

## Boundaries

- Always：只解析已校验富文本中的 `attachmentId`；重新验证附件所属主题、状态、删除状态、MIME、扫描状态和访问权限。
- Ask first：新增数据库字段、迁移或改变附件上传流程。
- Never：把外部 `src`、隐藏回复区图片、未完成扫描或不可访问附件暴露为封面。

## Success Criteria

1. `GET /api/v1/topics` 与主题详情的 `image_url` 为可空字符串。
2. 正文存在公开图片时返回 `/api/v1/attachments/{id}/thumbnail`。
3. 图片位于隐藏回复区、附件无效或文章无图时返回 `null`。
4. 一页主题只增加固定次数的批量数据库查询，不产生 N+1。
5. 首页真实数据渲染出双列图文卡片，320/768/1024/1440 响应式不回归。

## Open Questions

- 无；当前约定第一张可公开正文图片即封面。
