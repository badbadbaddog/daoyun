# 依据与证据口径

访问/整理日期：2026-10-02。源码链接固定到本次参考SHA。源代码事实是静态审阅；任何性能、运行故障复现、权限泄露或可用性结论都需要真实测试。本包不声称完成全仓安全审计。

本轮用户对功能、轻量化、DZ式管理操作的反馈是产品依据。旧《DaoYun_UI_V2_完整方案与执行方案.md》（2026-09-30）只作为单编辑器、图片上限、版块层级、隐私与兼容的历史约束；没有原样沿用其任务状态、代理要求或菜单分组。概念图低于文字契约优先级，不当作实际API、数据或工期证据。

## [S1] 分支基线

来源：https://api.github.com/repos/badbadbaddog/daoyun/commits?sha=codex%2Fdaoyun-home-foundation&per_page=1

用途与边界：2026-10-02只读复核HEAD，未读用户实时工作树。

## [S2] 前后台组件懒加载

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/app/AppRoot.tsx

用途与边界：已存在AdminApp lazy；CommunityApp另有多个lazy页面，不宣称需要从零拆包。

## [S3] 页面数据装配

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/app/CommunityApp.tsx

用途与边界：会员加载和feed启用路径；路由与现有侧栏关联需执行前复验。

## [S4] 会员七类数据加载

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/api/membership.ts

用途与边界：Promise.all聚合；不能把局部失败当整个会员不可用。

## [S5] 后台入口

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/components/AdminView.tsx

用途与边界：管理权限与品牌/版块/SMTP共同等待；已有模块分组。

## [S6] 草稿保存

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/components/TopicComposer.tsx

用途与边界：writeComposerDraft捕获失败；关闭提示与实际持久状态需对应。

## [S7] 通知已读

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/components/NotificationsView.tsx

用途与边界：前端已加载items过滤与单条已读后的局部计数。

## [S8] API直接插件依赖

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/apps/api/Cargo.toml

用途与边界：plugin-host非optional；其他候选依赖裁剪须分析。

## [S9] S3已可选

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/crates/infrastructure/Cargo.toml

用途与边界：default=[]，s3 feature引用optional object_store。

## [S10] 宿主与任务启动

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/apps/api/src/main.rs

用途与边界：插件worker有总开关；运维worker当前无同样条件。

## [S11] 权限与额度原始实现

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/crates/infrastructure/src/community_permissions.rs

用途与边界：有效来源合并、MAX、缺省0、过期条件；daily_quota路径有写副作用。

## [S12] 版块设置

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/components/BoardAdminPanel.tsx

用途与边界：手输ID/Key；就地配置改进；已有合并影响和回滚。

## [S13] 工作台

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/components/AdminDashboard.tsx

用途与边界：对象定位与摘要+口径；不把摘要当完整总数。

## [S14] 侧栏统计

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/components/RightSidebar.tsx

用途与边界：个人数值来自传入topics，不能当全量个人统计。

## [S15] 官方投票guest

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/plugins/official-polls/src/lib.rs

用途与边界：静态面板及空事件/任务，与核心投票业务分离不完整。

## [S16] 核心投票实现

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/crates/infrastructure/src/polls.rs

用途与边界：provider_key和数据库enabled检查；保留历史与可见性。

## [S17] 成长奖励guest

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/plugins/official-growth-rewards/src/lib.rs

用途与边界：真正奖励规则与幂等ExperienceAppend；迁移不能双发。

## [S18] 执行脚本

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/package.json

用途与边界：本计划pnpm命令来自已读取脚本，运行环境仍需核实。

## [S19] 现有hash路由

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/router/hashRouter.ts

用途与边界：新公开路径为条件任务，旧深链接仍需兼容。

## [S20] 搜索展示

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/src/features/search/SearchPage.tsx

用途与边界：已有局部错误显示，整体loading仍需拆分。

## [S21] 插件运行时

来源：https://github.com/badbadbaddog/daoyun/blob/40bcff25ec920912bff7f4472bc6174e63b8e2d9/daoyun/apps/api/src/plugins.rs

用途与边界：disabled不创建宿主，但与内置业务启用不是同一语义。

## [S22] Cargo features官方文档

来源：https://doc.rust-lang.org/cargo/reference/features.html

用途与边界：可选依赖、feature统一与default-features边界。

## [S23] OWASP Authorization Cheat Sheet

来源：https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

用途与边界：每请求验证、默认拒绝、权限测试和避免前端判权。

## [S24] W3C WCAG2.2 Target Size Minimum

来源：https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

用途与边界：24 CSS px相关最低要求及例外；本方案44px是设计目标，不冒充规范唯一阈值。

## [S25] Google JavaScript SEO Basics

来源：https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics

用途与边界：公开路径、可爬取链接、渲染；不保证收录。

## 证据分级

SOURCE：代码/官方文档可直接支持的事实。INFERENCE：基于调用链的场景推导，待运行。DESIGN：本方案提出的目标与候选契约。PROTOTYPE_TEST：仅静态原型的页面与模拟交互验证。APP_TEST：本轮未执行。计划、图册和原型中的值均不可充当APP_TEST。
