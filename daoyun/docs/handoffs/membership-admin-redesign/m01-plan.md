# M01 Task Plan：真实基线、领域模型与 UI 契约

状态：DONE（仅基线任务），2026-10-06。采用用户最新 M01–M08 定义。本次仅完成 M01，验证收口后按用户要求暂停。

## 当前状态
工作区已有上一轮 M01–M03 的未提交修改：导航/会员名称与用户列表会员投影已部分完成。不能把这些改动描述为本次新增，也不能把旧 Git HEAD 当作当前界面。此前尚未接入的 M04 草稿已保存至 test-results/admin-membership-rebuild/M04/T01/interrupted-draft，生产代码及测试恢复到原状态。

## 顺序与验收
1. 核对六个指定面板和真实 API、模型、相关测试；主代理完整阅读领域规格，探子只做独立定位，主代理点验关键出处。
2. 建立当前/未来导航映射和八领域语义，列出现有覆盖与缺口；只记录事实，不把计划接口当成现有实现。
3. 冻结 Git HEAD、branch、工作区状态、关键源文件 SHA-256、生成类型哈希和迁移目录清单。
4. 运行 targeted / 全量前端、TS、e2e TS、production build、API generate --check、Rust workspace、fmt、clippy；发现既有失败只登记基线，不扩成大规模修复。
5. 用真实本地服务与管理员账号验收首页、用户列表/详情、会员六分区、角色、版块矩阵、权限检查，覆盖 320/390/768/1024/1440；保存截图、布局/控制台/网络/axe 事实。截图不伪造数据，不提交业务写入。
6. 写 current.md 和 m01-baseline.md，给出 M02 准确允许修改文件，明确结果/未运行项/局限/迁移/接口/提交状态。

## 涉及文件
只写 docs/handoffs/membership-admin-redesign/{m01-plan.md,current.md,m01-baseline.md} 与 test-results/membership-admin-redesign/M01/*；历史 M04-T01 计划仅补 INTERRUPTED 记录。禁止新生产 UI 修改与数据库迁移，不删除已有测试。无生产行为变更，因此新增失败行为测试 N/A；运行现有行为/契约门禁。

## Task Result

六面板/八领域/真实 API/导航/测试缺口核对完成，117 张真实基线截图与全部可运行门禁结果保存。前端 1131、Rust 503 通过；默认 E2E 24 失败、230 跳过，axe 11 节点，详见 m01-baseline.md；未标成全通过。生产 UI/接口/Schema 本次无新增变化。已写 current.md，M02–M08 未开始；按用户要求完成 M01 后暂停。
