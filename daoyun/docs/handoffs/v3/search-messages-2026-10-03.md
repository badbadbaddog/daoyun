# DYR-021 搜索、收藏和私信

状态：DONE；AC-021-01/02/03 PASS。G4 仍 NOT_ACCEPTED，不用测试通过替代用户门禁接受。HEAD 40bcff25ec920912bff7f4472bc6174e63b8e2d9，分支 codex/daoyun-home-foundation，工作区 DIRTY；未提交、未生产部署。

## 行为

综合搜索先显示已返回的内容，用户搜索加载/失败独立提示和重试，重试不重复请求已成功内容，URL 中筛选及刷新恢复保留。账号/会话变化使旧 feed 失效。长查询、标题在 320px 换行，保持现有导航。

收藏列表、游标及写入复用 daoyun_can_access_content：主题或版块改成受限后，列表和搜索不返受限元数据，旧链接 404、旧收藏游标 422、不可访问收藏写入 404。收藏边保留，策略重新公开后可见。取消失败保留列表，分页、取消和全局收藏响应绑定当前会话，换号晚响应不污染新账号。点赞规则未改。

私信与通知维持独立入口。服务端接受后响应丢失时，锁住原正文，保留原幂等键；切换其他会话再回来可重试。真实重试返回相同消息 ID，数据库一行、对方未读仅增加一次。初次明确拒绝可编辑，未知结果后的 401 仍保留原快照；同账号认证恢复保留缓存，新账号清空。缓存只在组件存活时有效，不新增持久消息草稿模型。种子会话和旧发起回调有明确账号归属。

## 验证

- 前端全量 1070/115，通过；应用和 E2E 类型、生产构建通过。最后构建含搜索换行修复，最后测试后仅空白整理和 CSS 改动。
- Rust workspace 串行 480 通过、2 ignored；fmt --check、clippy -D warnings 通过。两项 Wasm ignored 已在 DYR-019 单独验证，本轮未重跑。首次并行内存/产物元数据错误保留日志，-j1 完整通过，未清理业务数据或 target。
- 实际浏览器六条通过：桌面/移动分别测试用户搜索 500 独立恢复、已接受私信丢失响应幂等重试、版块访问策略变更后的收藏/搜索/旧链接。累计 132→138，70 张最终截图；五档宽度 320/390/768/1024/1440 无整页横溢，局部 Axe 检查通过。
- git diff --check 退出 0；主代理亲自视觉复核。完整搜索图另存 visual-review。物理设备软键盘/辅助技术仍 NOT_RUN，继续 DYR-022。

## 证据与保留

[验证清单](../../../artifacts/v3/dyr021-2026-10-03/verification.json)、[源码清单](../../../artifacts/v3/dyr021-2026-10-03/source-manifest.json)、task-source-diff.patch、source-before/source-snapshot、review.md、fixture-registry.json 均在独立 artifacts 目录。15 文件 SHA256：

`e8ec8050e1b40aefe87e8cadb96d5b81af21912705f76ea65827cf373d4de18c`

manifest 算法为 SHA256(JSON.stringify(files))，按路径排序、保留 UTF-8 字节。DYR-020 十三个文件中，11 个未变，两个 App 文件为本轮明确改动；既有 dirty 改动保留。OpenAPI、公共 DTO 和迁移未改，实际响应 request_id 与头一致。

仅使用 127.0.0.1 隔离 V3 数据库，新建验收 fixture；访问策略写入走原生带 CSRF/revision 的审计 API。未重置额度、未删除收藏/消息/认证凭据。早期失败留下的隔离 fixture 与策略保留，成功策略场景重新公开原 fixture。artifacts 通过父仓库本地 exclude 排除。

API 3001 为本轮专用 runtime 可执行文件（PID 37992），Web 4174 使用最新构建；旧原始 3000/5173 保留。运行日志与源码指纹可重验，不公开私有环境和安全密钥。

下一任务：DYR-022 移动后台与可访问性集成。
