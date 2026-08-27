# Implementation Plan: 富文本草稿图片上传

## Architecture Decisions

- 复用 `topic_attachments`，将 `topic_id` 改为可空；空值表示仅上传者拥有的短期草稿附件。
- 富文本只保存 `attachmentId` 与 `alt`，展示 URL 由前端按内部路由生成。
- 创建/更新主题与回复时，从富文本提取图片 UUID，在同一事务内校验上传者、状态、过期时间、数量并绑定到主题。
- 草稿图片上传继续复用现有 MIME、魔数、图片解码、恶意样本、额度和对象存储安全逻辑。

## Tasks

1. 数据与契约
   - Acceptance：迁移允许附件暂不绑定主题；公共 DTO 和 OpenAPI 提供草稿图片上传响应。
   - Verify：迁移测试、契约测试、OpenAPI 生成。
2. 草稿上传切片
   - Acceptance：登录用户可带 CSRF 上传四种图片；非图片、超限和未登录请求被拒绝；草稿不可公开下载。
   - Verify：基础设施与 API 集成测试。
3. 富文本绑定切片
   - Acceptance：主题/回复创建与更新原子绑定本人草稿；他人、过期、超量或不存在的 UUID 使整个写入回滚。
   - Verify：主题/回复事务测试与 API 验证测试。
4. 编辑器图片切片
   - Acceptance：工具栏可选择图片、显示进度/错误、插入预览；保存 JSON 不含 blob/data/external src。
   - Verify：编辑器、API 客户端、发布/编辑组件测试。
5. 展示与收尾
   - Acceptance：详情与修订安全展示内部缩略图；桌面和 320px 可用，无控制台错误。
   - Verify：全量测试、类型、构建、Clippy、依赖审计和真实浏览器验收。

## Risks

- 上传成功但用户放弃编辑：24 小时过期和附件清理任务回收。
- 猜测他人附件 UUID：绑定事务同时校验 `uploader_id`，不可跨用户认领。
- 客户端伪造图片地址：服务端不接受 src，只接受 UUID；渲染器自行构造内部 URL。
- 存储成功但数据库失败：沿用附件模块对象补偿删除。
