# Spec: 发布主题 API

## Objective

为已初始化实例中的已认证用户提供发布公开主题的最小闭环。主题直接以纯文本发布到
公开板块，创建请求使用 Cookie 会话、绑定 CSRF 令牌和可选幂等键，服务端在单一事务中
写入主题并递增板块主题计数。

## Public API Contract

`POST /api/v1/topics` 接收 JSON：

- `title`：去除首尾空白后 1-160 个 Unicode 字符，不得包含控制字符。
- `content`：去除首尾空白后 1-1,000,000 个 Unicode 字符，不得包含除换行、回车、制表符
  以外的控制字符；请求体上限为 256 KiB。
- `board_id`：可选 UUID；省略时选择排序最前的公开、未删除板块。

请求必须携带有效会话 Cookie、CSRF Cookie 和相同的 `x-csrf-token` 请求头。
`Idempotency-Key` 可选，长度为 1-255 个 ASCII 字符。相同用户、接口和幂等键再次提交
相同请求返回同一主题（`200`），不会重复递增计数；相同幂等键提交不同请求返回
`409 request.idempotency_conflict`。

成功返回 `TopicDetail`：首次创建为 `201`，幂等重放为 `200`。主题状态立即为
`published`，摘要由正文规范化空白后截取前 500 个 Unicode 字符生成。

错误：

- `401 auth.unauthenticated`：缺少或失效会话。
- `403 auth.csrf_failed`：CSRF Cookie 与请求头缺失或不匹配。
- `404 topic.not_found`：指定板块不存在、隐藏或已删除。
- `409 request.idempotency_conflict`：幂等键复用但请求内容不同。
- `422 request.validation_failed`：JSON、字段、请求体或幂等键无效。
- `503 system.database_unavailable`：数据库不可用或持久化记录无法读取。

## Persistence Rules

- 初始化事务创建 `general` 公开板块，确保新实例可直接发布内容。
- 主题、幂等记录和 `boards.topic_count` 更新在同一 SQL 事务中。
- 幂等记录绑定 `user_id`、端点、请求 SHA-256 摘要和主题 UUID；只保存摘要，不保存正文。
- 公开读取继续使用 `GET /api/v1/topics` 的可见性谓词和 DTO，不暴露邮箱、内部状态或
  删除信息。

## Frontend Acceptance

- 首页主题列表使用真实列表 API；搜索和最新、热门、精华筛选转为服务端查询。
- 关注标签不使用模拟关系，显示未开放空状态。
- 登录会话存在时发布弹窗提交真实 API，自动发送 CSRF 和幂等键；成功后将返回主题加入
  当前列表并关闭弹窗。
- 未登录、加载、失败、空列表和提交错误均有可见且可重试的状态。
