# Spec: 社区富文本编辑器

## Objective

为主题发布、主题编辑、回复发布和回复编辑接入 Tiptap 3。编辑体验保持刀云现有的紧凑社区风格，支持常用结构化格式，同时继续为搜索、摘要、审核和通知提供可靠的纯文本内容。

本规格由用户确认“按 Tiptap 推荐开始接入”后生效，并在用户指出缺少图片上传后扩展草稿图片能力。第一期不实现实时协作、表格、AI 写作、视频、任意 iframe 或 Markdown 源码模式。

## Decisions

- `rich_content` 是 Tiptap JSON 文档；`content` 保留为同一文档的纯文本投影。
- Rust API 对 JSON 节点、属性、mark、链接协议、深度、节点数和文本总量做白名单校验，并从 JSON 生成纯文本投影；客户端提交的 `content` 不能绕过服务端校验。
- 公开 Web 按白名单节点渲染 React 元素，不使用 `dangerouslySetInnerHTML`。
- `topics`、`posts` 和 `post_revisions` 同步保存 `rich_content`，保证当前正文与修订历史一致。
- 旧的纯文本记录允许 `rich_content = null`；编辑器加载时将纯文本转换为一个段落文档。新写入由富文本编辑器提交结构化正文。
- 图片只引用刀云内部附件 UUID，不接受外链图片、data URL 或客户端提供的最终 src。
- 图片先上传为当前用户拥有的 24 小时草稿附件；创建或更新主题/回复时，服务端从富文本 JSON 提取附件 UUID，并在同一数据库事务内校验、绑定到目标主题。
- 放弃编辑不会公开草稿图片；未绑定草稿由现有附件生命周期清理流程回收。

## Supported Content

- block：paragraph、heading（2-4）、blockquote、bulletList、orderedList、listItem、codeBlock、horizontalRule、hardBreak。
- inline：text。
- media：image；属性仅允许 `attachmentId` 和可选 `alt`，`attachmentId` 必须为 UUID。
- mark：bold、italic、strike、code、link。
- link：仅允许 `http`、`https` 和站内相对路径；禁止脚本协议和未知属性。
- 主题最多 1,000,000 个 Unicode 字符；回复最多 100,000 个 Unicode 字符；结构化文档最多 20,000 个节点、32 层深度。

## Public API Contract

以下请求和响应新增可选 `rich_content` JSON 对象，不删除或改变现有 `content` 字段：

- `CreateTopicRequest`
- `UpdateTopicRequest`
- `CreateReplyRequest`
- `UpdateReplyRequest`
- `TopicDetail`
- `TopicReply`
- `TopicRevision`
- `ReplyRevision`

当请求携带 `rich_content` 时，服务端验证并用其生成规范化 `content`；未携带时沿用纯文本校验并保存 `rich_content = null`。所有版本化业务响应继续满足 `meta.request_id` 与 `x-request-id` 一致。

新增 `POST /api/v1/attachments/drafts`：

- 仅接受登录用户、有效 CSRF、PNG/JPEG/GIF/WebP 和现有附件额度允许的原始二进制请求。
- 单文件沿用附件模块的 50 MiB 绝对上限，编辑器前端限制为 10 MiB；每篇富文本最多引用 20 张图片。
- 响应返回草稿附件 UUID、文件名、MIME、字节数和过期时间，不返回存储 key。
- 草稿附件不可通过公开附件列表、原图或缩略图接口读取；只有绑定到已发布主题后才可访问。

## Frontend UX

- 主题与回复共用 `RichTextEditor` 展示组件和统一 extension 配置。
- 工具栏包含撤销、重做、粗体、斜体、删除线、标题、引用、无序列表、有序列表、行内代码、代码块、链接和上传图片。
- 图片按钮支持选择 PNG/JPEG/GIF/WebP，显示上传中/失败反馈；成功后在编辑区插入本地预览，保存后按内部附件缩略图展示。
- 工具栏按钮使用 Lucide 图标，图标按钮有可访问名称与 tooltip；激活态使用 `aria-pressed`。
- 编辑区为空时显示业务化 placeholder；错误、字符数和提交状态仍由父表单管理。
- 320、768、1024、1440px 不产生水平溢出；移动端工具栏可横向滚动，正文区域不横向滚动。
- 详情、回复和修订历史按结构化内容展示；纯文本旧记录保持现有显示。

## Tech Stack And Sources

- React 19、TypeScript 5.7、Vite 6、Vitest、Testing Library。
- Tiptap 3：`@tiptap/react`、`@tiptap/pm`、`@tiptap/starter-kit`、Image、Link、Placeholder、CharacterCount。
- Rust 1.94.1、Serde JSON、Axum 0.8、SQLx 0.9、PostgreSQL JSONB。
- Tiptap React：https://tiptap.dev/docs/editor/getting-started/install/react
- Tiptap JSON persistence：https://tiptap.dev/docs/editor/core-concepts/persistence

## Project Structure

- `src/components/RichTextEditor.tsx`：编辑器、工具栏、链接输入。
- `src/components/RichTextContent.tsx`：只读白名单渲染。
- `src/api/attachments.ts`：草稿图片上传客户端与进度。
- `src/editor/richContent.ts`：JSON 类型、纯文本转换和旧内容适配。
- `crates/api-contract/src/topic.rs`：添加公共 JSON 字段。
- `apps/api/src/topics.rs`：HTTP 白名单校验、规范化和 OpenAPI。
- `crates/infrastructure/src/topics.rs`：JSONB 当前内容和版本持久化。
- `migrations/`：三个正文表的 additive JSONB 字段。

## Testing Strategy

- 先写失败测试，再实现每个切片。
- TypeScript 单元测试覆盖纯文本提取、旧内容适配、恶意节点降级、工具栏命令、提交 JSON 和只读渲染。
- Rust 契约/HTTP/数据库测试覆盖 JSON 序列化、白名单、危险链接、深度/节点上限、版本持久化和幂等摘要。
- 真实浏览器覆盖主题发布、回复发布、刷新后格式保持、键盘工具栏、320/768/1024/1440px、axe 和零控制台错误。

## Implementation Tasks

1. 契约与安全规范化：定义 JSON 字段、Rust 白名单验证和纯文本投影。
2. 持久化：为当前主题、帖子和修订版本写入/读取 JSONB。
3. 前端基础：安装 Tiptap 3，实现共享编辑器、只读渲染和单元测试。
4. 主题闭环：发布、编辑、详情、修订历史使用结构化内容。
5. 回复闭环：发布、编辑、列表、修订历史使用结构化内容。
6. 图片闭环：草稿上传、事务绑定、编辑器预览、安全渲染和过期清理。
7. 质量门禁：OpenAPI 生成、全量测试、格式、Clippy、依赖审计、构建和浏览器验收。

## Boundaries

- Always：服务端白名单、参数化 SQL、版本历史一致、React 安全渲染、统一 envelope、测试先行。
- Ask first：开放非图片文件、开放外链图片、增加实时协作、引入付费 Tiptap 服务。
- Never：执行用户 HTML、允许 `javascript:` URL、信任客户端纯文本投影、把附件上传权限扩展到未发布资源。

## Success Criteria

- 用户能在主题和回复中创建、编辑并刷新后看到支持的格式。
- 结构化正文、纯文本投影和历史修订保持一致；搜索和摘要不包含 JSON 或 HTML 标记。
- 恶意节点、属性、链接和超限文档在 API 边界返回 `422 request.validation_failed`。
- 纯文本旧记录继续可读可编辑。
- 用户可以在发布或编辑主题/回复前上传图片；未提交的图片不公开并会过期清理，提交成功的图片刷新后可见。
- 全量 Rust/Web 测试、类型检查、构建、格式、Clippy、生产依赖审计和浏览器验收通过。

## Commands

```text
pnpm test
pnpm typecheck
pnpm build
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```
