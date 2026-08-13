# Spec: 公开主题读取 API

## Objective

为已经初始化的刀云实例提供真实的公开主题列表与详情读取能力，替换 Web 首页中的
模拟主题数据。访客和已登录用户都只能读取已发布、未删除且位于公开板块中的主题。
列表必须支持板块、关键字和精华筛选，支持最新、热门和活跃排序，并使用稳定游标分页。

本切片不实现关注关系或 PostgreSQL Full Text Search：两者分别属于
`docs/project-status.md` 的 P1 用户关系和搜索任务。P0 Web 的“关注”标签不得继续展示
模拟结果，应展示尚未开放的真实空状态。

## Assumptions and Decisions

- 主题使用 UUIDv7 标识，公开 URL 为 `/api/v1/topics/{topic_id}`。
- 主题正文在 P0 作为纯文本返回并由 React 转义渲染；P1 内容版本表可替换持久化实现，
  但不改变公开字段。
- 关键字筛选仅匹配标题和摘要，`%`、`_` 和 `\` 按普通字符处理；P1 再升级为
  PostgreSQL Full Text Search。
- 游标是上一页最后一条主题的 UUID。游标只允许与生成它时相同的筛选和排序参数组合
  一起使用；不存在、不可见或不属于当前结果集的游标返回字段校验错误。
- 所有排序最后都使用主题 UUID 降序作为唯一决胜键，避免相同时间或分数下重复、漏项。
- 置顶主题在三种排序中都优先；置顶组和普通组内部再使用对应排序键。
- 时间字段返回 UTC RFC 3339 字符串；计数必须是非负整数。
- 读取详情不在请求路径同步增加浏览量，避免 GET 产生隐藏写入；浏览统计进入后续异步事件切片。

## Public API Contract

所有响应继续使用现有 `data` / `meta` 或 `error` / `meta` envelope，
`meta.request_id` 与 `x-request-id` 响应头一致，JSON 字段使用 `snake_case`。

### `GET /api/v1/topics`

查询参数：

- `board`: 可选板块 slug，格式与 `boards.slug` 一致。
- `query`: 可选关键字，去除首尾空白后为 1-100 个 Unicode 字符。
- `featured`: 可选布尔值；为 `true` 时只返回精华主题。
- `sort`: `latest`、`popular` 或 `active`，默认 `latest`。
- `cursor`: 可选 UUID。
- `limit`: 1-50，默认 20。

排序：

- `latest`: 置顶状态、`published_at DESC`、`id DESC`。
- `popular`: 置顶状态、`hot_score DESC`、`published_at DESC`、`id DESC`。
- `active`: 置顶状态、`last_activity_at DESC`、`id DESC`。

响应：

- `200`: `PageResponse<TopicSummary>`，`meta.next_cursor` 为下一页游标或 `null`。
- `422 request.validation_failed`: 查询参数、板块 slug 或游标无效。
- `503 system.database_unavailable`: 数据库暂时不可用且不暴露内部错误。

### `GET /api/v1/topics/{topic_id}`

- `200`: `ApiResponse<TopicDetail>`。
- `400 request.path_invalid`: 路径不是 UUID。
- `404 topic.not_found`: 主题不存在、未发布、已删除、作者不可用或所属板块不可公开读取。
- `503 system.database_unavailable`: 数据库暂时不可用且不暴露内部错误。

### Public DTOs

`TopicAuthorSummary`：`id`、`username`、`display_name`。

`TopicBoardSummary`：`id`、`slug`、`name`、`tone`。

`TopicSummary`：

- `id`、`title`、`excerpt`。
- `author`、`board`。
- `published_at`、`last_activity_at`。
- `reply_count`、`like_count`、`view_count`。
- `is_featured`、`is_pinned`。

`TopicDetail` 在 `TopicSummary` 基础上增加 `content`。

## Data Model

新增 `topics` 表：

- 标识与归属：`id`、`board_id`、`author_id`。
- 内容：`title`、`excerpt`、`content`。
- 生命周期：`status`、`published_at`、`last_activity_at`、`created_at`、`updated_at`、
  `deleted_at`。
- 展示与排序：`featured_at`、`pinned_at`、`hot_score`。
- 计数：`reply_count`、`like_count`、`view_count`。

数据库约束负责字段长度、非负计数、状态枚举和发布时间一致性；外键不级联删除用户或板块。
公开列表按可见性谓词和三种排序建立部分索引。迁移必须包含对应 down 文件。

## Tech Stack and Sources

- Rust 1.94.1、Axum 0.8.9、SQLx 0.9.0、PostgreSQL 16、Utoipa 5.5.0。
- React 19、TypeScript、Vite、Vitest、Testing Library。
- Axum `Path` 使用 Serde 解析路径参数：
  https://docs.rs/axum/0.8.9/axum/extract/struct.Path.html
- SQLx `query_as` 使用预处理语句并通过 `FromRow` 映射：
  https://docs.rs/sqlx/0.9.0/sqlx/fn.query_as.html
- SQLx PostgreSQL 时间类型映射：
  https://docs.rs/sqlx/0.9.0/sqlx/postgres/types/index.html
- PostgreSQL 行构造器按从左到右的 B-tree 语义比较，作为键集分页依据：
  https://www.postgresql.org/docs/16/functions-comparisons.html#ROW-WISE-COMPARISON

## Commands

```text
$env:DATABASE_URL = "postgresql://daoyun@127.0.0.1:55433/daoyun_dev"
$env:CARGO_TARGET_DIR = ".cargo-target-gnu"
cargo +1.94.1-x86_64-pc-windows-gnu test --workspace
cargo +1.94.1-x86_64-pc-windows-gnu fmt --all -- --check
cargo +1.94.1-x86_64-pc-windows-gnu clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm typecheck
pnpm build
```

## Project Structure

- `migrations/`: 主题表及索引的正向、反向迁移。
- `crates/api-contract/`: 主题 DTO、排序枚举、错误码和 OpenAPI schema。
- `crates/infrastructure/`: 参数化列表、游标校验和详情 SQL。
- `apps/api/src/topics.rs`: HTTP 边界校验、DTO 映射和错误隔离。
- `apps/api/tests/topics.rs`: PostgreSQL 集成、HTTP 和 OpenAPI 契约测试。
- `src/api/topics.ts`: 后续 Web 接入使用的运行时校验客户端。

## Code Style

```rust
let records = database
    .list_public_topics(&filters, cursor, i64::from(limit) + 1)
    .await?;
Ok(Json(PageResponse::new(topics, request_id, next_cursor)))
```

公共 DTO 不暴露持久化模型；SQL 只使用绑定参数和固定排序分支；用户关键字不能拼接到 SQL；
数据库错误只写入带 `request_id` 的服务端日志。

## Testing Strategy

- 契约测试：DTO 序列化、错误码、三种排序枚举和 OpenAPI path/schema。
- PostgreSQL 测试：公开可见性、板块/关键字/精华筛选、三种稳定排序、游标翻页、详情。
- HTTP 测试：参数边界、无效/错配游标、404 隔离、数据库错误和请求 ID。
- 前端测试留到 P0 Web 真实数据接入切片，覆盖加载、失败、重试、空状态和分页。

## Boundaries

- Always: 参数化 SQL、边界校验、稳定排序、公开可见性检查、统一 envelope、OpenAPI 和测试。
- Ask first: 改为 offset 分页、引入外部搜索服务、让草稿或隐藏板块内容公开可见。
- Never: 拼接用户输入、返回密码/邮箱等作者私有字段、把不存在与不可见主题区分为不同错误、
  用模拟关注关系填充真实 API。

## Task Breakdown

- [x] 迁移与持久化查询：表、约束、索引、筛选、排序、游标和详情。
- [x] 公共 DTO 与错误码：列表、详情、时间、计数和 OpenAPI schema。
- [x] HTTP 列表端点：查询校验、分页、映射和错误隔离。
- [x] HTTP 详情端点：路径校验、可见性、404 和错误隔离。
- [x] 全量 Rust 质量门禁并更新 `docs/project-status.md`。

## Success Criteria

- [x] 列表只返回公开板块内已发布、未删除且作者启用的主题。
- [x] 板块、关键字和精华筛选均可组合，并且 `%`、`_` 不会扩大匹配范围。
- [x] 三种排序在相同值下仍稳定，连续翻页无重复且 `next_cursor` 正确终止。
- [x] 无效参数和游标返回带字段错误的 `422`，不可见详情统一返回 `404 topic.not_found`。
- [x] DTO 不包含作者邮箱、密码、内部状态或删除信息，数据库错误不泄露。
- [x] 两个端点、所有 DTO 和错误响应进入 OpenAPI，测试、格式和 Clippy 全部通过。
