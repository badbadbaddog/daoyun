# UI V2 第八增量：统一发布入口与附件权限

日期：2026-10-01。对应 DYV2-010 的 P-02 / P-07。两项本轮接受，P-01/P-04/P-08/P-09 回归通过；DYV2-010 与整体方案仍 IN_PROGRESS，G0–G5 全部 NOT_ACCEPTED。冻结九文件未修改；FastSpider_FS 未调用。

## 实现与契约

- 首页、版块、云草稿沿用 TopicComposer / createPost / 同一富文本模型。真实验证全局默认版块、版块入口默认当前版块、跨上下文恢复草稿时保留原版块；均直接发布，无强制预览。
- 使用现有 getBoard viewer 能力。版块、账号、CSRF 作用域变化重新查询，旧结果不能覆盖新权限。未知/失败期间限制写入，可重试；标题、正文及已选图片保留。不允许附件时可移除图片后发布纯文本，不允许创建主题时限制发布。拖拽、重试与表单提交均执行权限检查。
- 服务端 bind_rich_content_attachments 对新未绑定图片重新检查标准 attachment.upload 和目标版块对应限制。已有同主题图片可继续编辑；仍检查 ownership、ready、clean、deleted、expiry/草稿引用，不重复收费上传配额。失败沿用事务回滚，SQL 错误原样传播。
- 独立补充契约：publisher-permissions-contract-2026-10-01.md。沿用 422 request.validation_failed / 403 board.posting_restricted / 409 draft.attachment_unavailable，无新端点、DTO、迁移或依赖。

## 验证

- 有效失败测试：原服务端在 attachment.upload 版块限制下仍返回 201；三个前端权限用例原实现失败。修复后发布器与应用 96 项通过。
- 前端全量 103 文件 / 835 项通过；应用/E2E 类型和生产构建通过。
- 真实生产页面 + 本轮重建 API：入口两项、权限两项、九图回归两项、草稿冲突/账号隔离六项，共十二项，两个 Chromium 项目，未模拟业务响应。五宽度 320/390/768/1024/1440，105 张截图与 12 份网络证据。主代理亲自复核权限场景 320/1440 截图。
- Rust workspace：454 通过、0 失败、2 项沿用已有 ignored 标记（官方增长插件 wasm32-wasip2 构建依赖；不计入本轮接受证据）。格式检查与全 workspace/all-targets clippy -D warnings 通过。
- 新附件 SQLx 用例覆盖群组/版块上传权限拒绝与回滚、既有图片编辑，以及 foreign / upload_pending / scan_pending / infected / scan_error / expired / deleted / bound 八种不可用状态。主题/正文/草稿/附件引用/配额计数不产生失败提交副作用。MIME 与签名拒绝另行覆盖；有效 PNG 后附 EICAR 独立验证扫描拒绝。
- 两个最终一次性探子核验客户端权限作用域及服务端绑定 guard，未发现具体问题；主代理复核精确代码、实际 diff 和全部验证。较早的两项核验在中断时未交卷，不计入完成结果。

## 环境与清理

- 专用 cluster：artifacts/ui-v2/fifth-increment-2026-10-01/isolated-postgres。原 55434 被系统拒绝绑定，通过 CLI 覆盖到 15434；新数据库 daoyun_ui_v2_capabilities。原开发数据库与前几轮数据库保留。
- 夹具：本地测试成员/管理员；成员额外建立既有 established_member 身份供九图回归；每批重置仅本数据库成员配额。feedback 对该成员禁止附件上传；另建只读权限验收版块，限制仅该成员。
- API 3001 使用本轮重建二进制的 artifact 副本，避免 Cargo 替换运行中程序冲突；4174 预览生产构建，附件写入本轮目录。
- API、页面预览与专用 PG 均已停止。初始与最终 3000/5173/3001/4174 均未监听；未管理原服务。
- 中断后 REPL 重置、专用 PG 停止，恢复同一 cluster 后继续。初次前端全量与 Rust 链接同时运行时出现无关超时，终止后单 worker 完整重跑通过。运行中二进制占用、上传测试等待阶段、类型夹具错误均已修正；失败日志保留，不把它们当作通过记录。

## 来源与证据

- HEAD：40bcff25ec920912bff7f4472bc6174e63b8e2d9；最近业务源码提交：3f81a93513bb69662c91d50a08854b66c18dbd63。本轮及前几轮未提交改动保留，未创建提交。
- 28 项源码清单 SHA256：b6cdec4342ae8475ecea9a2afb1432dff7edd1d74fb1a87d6b630326004021df。
- 被测 API 副本 SHA256：2c7180d8d749baca3a4b310dcfeb1f3db70f0ec952ab38cc1016b1d80934e328。
- 证据目录：artifacts/ui-v2/eighth-increment-2026-10-01。source-manifest.json、production-assets.json、screenshots-manifest.json、network-evidence-manifest.json、logs-manifest.json 与四份浏览器结果 JSON；完整命令/退出码见 eighth-increment-verification.json。
- 源码、86 项生产资源和冻结计划哈希在验证结束后再次确认一致；所有编辑采用 UTF-8。

## 后续

- 当前接受 33 项、未执行 168 项；任务完成数仍为 0，11 项进行中，不将局部验收冒充全局完成。
- 下一步优先 P-10 服务端撤销会话与上下文恢复、P-11 重复提交/未知结果、P-12 真机软键盘。真实手机未验证。
- 其余角色/插件 G0、前台和后台链路、性能、候选构建与 G5 干净检出验收继续按 execution-state.json；未改变冻结计划或其注册表状态。
