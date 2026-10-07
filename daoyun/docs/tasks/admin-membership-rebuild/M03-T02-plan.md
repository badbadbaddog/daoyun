# M03-T02 Task Plan：用户列表会员字段与服务端筛选

状态：DONE（2026-10-06）。依赖 M03-T01 DONE；验证见 M03-T02-result.md。完成后按用户要求暂停。

## 当前行为
列表以主要管理角色、主题/回复/举报数量为核心；尚无社区身份、成长、积分、权益列。筛选支持搜索、状态、角色、注册时间。统计/分页/勾选/CSV/详情前后导航已实现，必须保留。

## 文件
crates/api-contract/src/user.rs；crates/infrastructure/src/users.rs 与新增 admin_user_membership_read.rs、lib.rs；apps/api/src/admin.rs/lib.rs；apps/api/tests/users.rs 及 infra 用户测试；src/api/adminUsers.ts/tests/generated.d.ts；UserAdminPanel.tsx/tests；src/styles.admin.css；受用户列表列变更影响的 e2e。

## 验收
- 列表通过一次批量读取页面 UID 的会员投影返回有效基础/附加组、独立 EXP/当前等级、积分、当前有效权益、勋章数量及 readable_sections。不能逐行调用聚合接口，不能从主要管理角色推导社区身份，不能从积分旧等级推导成长。
- 按账号状态、基础组、附加组、成长等级、会员权益、注册范围、最后活跃范围服务端筛选；仍保留角色高级筛选。所有条件也约束游标，时间区间 inclusive start/exclusive end，期限与撤销遵循现有语义。
- 未授权会员字段不返回真实值；私有字段筛选需同领域读取能力，不能通过筛选侧漏。成长目录需 rules.read；组需 groups.read + memberships.read；权益名称/类型筛选需 types.read + grants.read；积分沿用 points.grant 读取门槛。
- 十个核心业务列 + 勾选列；原内容统计保留在详情/导出的高级信息，不再占主表。所有原选择、CSV、分页、错误、深链接、日期校验、详情操作测试保持有效，按新列契约更新断言。
- 筛选使用真实目录，目录失败可恢复；无权限与未初始化显示区分，不伪造 0/普通成员。桌面密集表格，窄屏保留全部字段/操作，无整页溢出。

## 测试与执行
先 API/Rust 的字段与筛选/游标/越权失败测试，以及列表展示/筛选/URL/CSV前端失败测试 → 实现 DTO、批量读取与筛选 → 客户端适配与界面 → targeted → 全量前端 → TypeScript/e2e类型 → build → Rust workspace → fmt → clippy → 浏览器五宽度/双主题、筛选/分页/详情与截图 → result。测试未完成不标 DONE。此 Task 完成后才能收口 M03 并进入 M04。
