# Spec: 主题编辑与标签

## Objective

为已发布主题增加作者可控的纯文本编辑、乐观并发冲突和公共标签筛选。编辑必须追加
`post_revisions`，同步更新兼容字段 `topics.content` 与首帖 `posts.content`；标签关系与
内容更新处于同一事务。修订正文历史仅对主题作者开放，公共详情只暴露当前修订号。

## Decisions

- 编辑接口为 `PATCH /api/v1/topics/{topic_id}`，请求必须带会话 Cookie、CSRF 和
  `base_revision`；主题作者以数据库中的 `topics.author_id` 判定。
- `base_revision` 不等于当前首帖 `revision_count` 时返回 `409 topic.revision_conflict`，
  不写入任何内容、标签或修订版本。
- 标题和正文均为纯文本，服务端拒绝除换行、回车、制表符以外的控制字符；React 继续转义
  内容，不引入 HTML 渲染器。
- 标签由 `slug`、`name` 组成；slug 为 1-40 位 ASCII 小写字母、数字和连字符，name 为
  1-40 个 Unicode 字符；每个主题最多 5 个标签。编辑请求提供 `tags` 时完全替换关系，
  未提供时保持原关系。
- `GET /api/v1/tags` 只返回至少关联一个公开主题的标签，按使用次数降序再按 slug 正序。
- `GET /api/v1/topics` 支持 `tag` slug 筛选；主题列表和详情返回公开标签。
- `GET /api/v1/topics/{topic_id}/revisions` 仅主题作者可读，返回版本号、编辑者公开身份、
  时间和正文；其他用户与不可见主题统一返回 `404 topic.not_found`。

## Success Criteria

- 编辑事务追加版本且计数恰好加一；冲突、无权限和数据库异常不产生部分写入。
- 标签创建、去重、替换和公开筛选稳定；用户输入不拼接 SQL。
- API、OpenAPI、前端运行时校验、作者编辑 UI、冲突重试和浏览器验收全部通过。
