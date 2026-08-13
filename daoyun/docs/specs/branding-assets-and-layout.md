# 品牌资产与公开布局扩展规格

## 目标

补齐站点 Logo、Favicon 的安全二进制上传与删除，扩展默认主题封面、导航链接、页脚文本和页脚链接，并让公开 Web、Mobile Web/PWA 与 Admin Web 通过同一 `SiteBranding` 契约消费这些字段。

## 技术栈

- Rust/Axum 原始字节上传与现有会话、CSRF、capability 边界。
- PostgreSQL 16 保存品牌字段和资产元数据；现有本地/S3 对象存储保存字节。
- utoipa/OpenAPI、TypeScript 运行时响应校验、React 19 管理与公开界面。

## 命令

```text
Rust 测试：cargo test --workspace
Rust 格式：cargo fmt --all -- --check
Rust 检查：cargo clippy --workspace --all-targets -- -D warnings
前端测试：pnpm test
类型检查：pnpm typecheck
生产构建：pnpm build
OpenAPI：pnpm generate:api -- --check
浏览器：pnpm test:e2e
```

## 项目结构

```text
migrations/                         品牌字段和资产元数据正反向迁移
crates/api-contract/src/admin.rs    公共品牌 DTO 与上传种类
crates/infrastructure/src/admin.rs  品牌事务、对象存储与审计
apps/api/src/admin.rs               API、校验、字节响应和 OpenAPI
src/api/                            TypeScript DTO 映射和上传客户端
src/components/                     管理表单及公开导航、封面、页脚消费
```

## API 契约

- `SiteBranding` 加法扩展：`default_cover_url`、`navigation_links`、`footer_text`、`footer_links`。
- `PATCH /api/v1/admin/site-branding` 保留现有字段；新增字段缺省时保留数据库值，避免旧客户端清空配置。
- `PUT /api/v1/admin/site-branding/assets/{kind}` 接收原始字节，`kind` 仅为 `logo` 或 `favicon`，成功返回完整 `SiteBranding`。
- `DELETE /api/v1/admin/site-branding/assets/{kind}` 删除当前资产并返回完整 `SiteBranding`；无资产时幂等成功。
- `GET /api/v1/site-branding/assets/{kind}` 公开读取当前资产字节；不存在返回统一 `404`。
- 上传成功后的 `logo_url`/`favicon_url` 为服务端生成的同源路径；仍允许管理员配置 HTTPS 外部 URL。

## 代码风格

```rust
pub struct BrandLink {
    pub label: String,
    pub url: String,
}

pub enum BrandAssetKind {
    Logo,
    Favicon,
}
```

所有外部输入在 API 边界校验，内部只接收已验证类型；SQL 始终参数化。React 只渲染文本和经过验证的 `https://` 或站内 hash/绝对路径，不使用 HTML 注入。

## 测试策略

- 迁移正反向测试验证字段、JSON 类型约束和资产表生命周期。
- 基础设施集成测试验证上传、替换、删除、对象清理、审计和 Outbox 的原子边界。
- API/OpenAPI 测试验证 capability、CSRF、体积、MIME、魔数、稳定错误、读取缓存头与请求 ID。
- TypeScript/组件测试验证响应防御、表单提交、上传交互和公开页面消费。
- 桌面/移动 Chromium 验证导航、默认封面、页脚、无障碍、溢出和控制台。

## 安全边界

- Logo：PNG 或 WebP，最大 2 MiB；Favicon：PNG，最大 512 KiB。
- MIME 与魔数必须同时匹配；拒绝 SVG、HTML、脚本、空文件和超限文件。
- 上传和删除要求有效管理会话、`admin.configuration.write` 与 CSRF；公开端只能读取当前资产。
- 存储键由服务端根据种类、SHA-256 和 UUIDv7 代际标识生成，不使用文件名或客户端路径；代际标识隔离并发替换与旧对象清理。
- 外部链接仅允许 HTTPS；站内链接仅允许 `/` 或 `#` 开头且禁止 `//`、控制字符和反斜杠。
- 审计只记录资产种类、MIME、大小和摘要，不记录原始字节、外部 URL query 或用户输入文本。

## 实施任务

- [x] 任务 1：扩展迁移与公共品牌契约。
  - 验收：字段为加法扩展，旧更新请求不会清空新字段。
  - 验证：契约和迁移测试。
- [x] 任务 2：实现安全品牌资产存储与 API。
  - 验收：上传、替换、读取、幂等删除及失败清理均通过。
  - 验证：基础设施与 API 集成测试、OpenAPI 漂移。
- [x] 任务 3：实现管理端与公开端消费。
  - 验收：管理员可上传/删除资产和编辑字段；公开页显示导航、默认封面和页脚。
  - 验证：Vitest、TypeScript、生产构建、桌面/移动 Chromium。
- [x] 任务 4：完成全量质量和安全门禁。
  - 验收：Rustfmt、Clippy、依赖审计和全部测试通过。

## 成功标准

- Logo/Favicon 不依赖外部 CDN 即可配置，且上传边界拒绝伪造与主动内容。
- 新品牌字段通过公共 API、缓存、管理端和公开端形成完整闭环。
- 旧字段、旧客户端和现有主题行为不被破坏。
- 数据库、对象存储、审计和缓存失效在故障时保持可解释、可恢复状态。

## 开放问题

- 独立原生移动应用不在当前仓库；其原生导航和资源打包留到客户端立项，本规格覆盖当前 Web/PWA/Admin。
