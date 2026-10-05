# DYR-023 扩展能力状态统一

状态：DONE。按已授权 V3 执行方案/04 契约实施；不新建市场，不切换奖励执行器，不提前删除旧 provider 或裁剪宿主依赖。

## 契约与验收

新增只读管理员能力快照，复用 plugins.read 鉴权和标准 request_id；轻量静态描述区分构建支持、Native/Wasm 运行条件、数据库业务启用与当前用户生命周期控制。针对具体内容/动作的授权仍由原服务端端点核验，快照明确需要目标上下文，不作预授权。只公开管理员已可读的状态，不给游客安装私有详情。

内置数据库投票、兑换、补充、编辑审核、运营报表按既有 provider 状态运行，独立于 Wasm 开关；当前成长奖励唯一写入者仍为 Wasm，运行时关闭时停止执行。安装/启用组件的原校验仍保留，官方模块迁移归 DYR-024。

停用规则冻结：投票停止新建/修改/投票，历史按原结果可见规则读取；兑换停止新交易扣分，已完成幂等请求可返回旧结果；补充停止新写入，旧请求回放和历史保留；编辑审核停止接收扩展新审核，已待审事项继续经原治理授权/revision 显式处理，绝不自动批准；统计停止扩展报表，不带走基础治理摘要；奖励停止新执行，账本与幂等/队列水位保留。Wasm 停用只停外部执行。

队列认领与 provider 生命周期行锁协调：状态改变持锁时跳过，不消耗尝试次数；停用期间不认领，恢复后仅继续未完成任务，已完成任务/奖励不重做。原执行 lease/command 收据事务继续复核状态；在途事务按原一致边界完成或拒绝，不新增 epoch/中间件。

AC-023-01：同库重建/重启关闭 Wasm，内置投票快照和实际业务一致。AC-023-02：关闭 provider 后旧页面新动作被服务器拒绝，历史仍可访问。AC-023-03：关闭/恢复后 completed 任务不会再认领，奖励原幂等回放不重复。

## 分步与检查

1. API DTO/只读端点/OpenAPI RED→GREEN；生成 TS，保持旧列表响应兼容。
2. 管理页独立状态区域与失败重试，区分停用/未配置/运行时未启用，不阻塞插件列表。
3. 队列持锁并发 RED→GREEN，验证 pending/completed 恢复。
4. 前端全量、类型/生产构建、Rust workspace -j1/fmt/clippy；隔离真实 API/浏览器/重启、五档截图与来源对账。

代码沿用 React named exports、语义 CSS tokens，公共 DTO 只放 api-contract。测试走 Vitest、SQLx/Axum、Playwright。命令：pnpm exec vitest run --maxWorkers=2 --minWorkers=1；pnpm typecheck；pnpm build；cargo test --workspace -j1；cargo fmt --all -- --check；cargo clippy --workspace --all-targets -j1 -- -D warnings。

边界：只本机隔离 V3 库、新 fixture，原生带 CSRF/revision API 管理状态；保留旧业务、审计、凭据和额度，不提交、不生产部署，不新增依赖/不可逆迁移。实际设备/辅助技术仍 NOT_RUN。

最终验收和暂停记录：[2026-10-04 交接](extension-capabilities-2026-10-04.md)。按用户要求完成 DYR-023 后停止；DYR-024 及后续未启动。
