# M01：用户 / 会员 / 权限真实基线

状态：DONE（仅真实基线冻结）；2026-10-06。整体重构 NOT DONE；完成本任务后 PAUSED。以用户最新 M01–M08 定义为准。本次冻结当前工作区，不声称完成视觉重构。

## 基线范围与身份

当前工作区已有上一轮导航、会员名称与用户列表 Read Model 修改。本次没有新增生产行为、接口或数据库迁移。M04 未接入草稿保存在旧任务证据目录并移出 src；它不是当前可用功能。

- Git HEAD：06bfa627b264b72aebd28f1e06447be08ea1b25a。
- 分支：codex/daoyun-home-foundation；工作区有既有未提交修改，不是 clean checkout。本次未创建提交。
- 精确源码哈希、原始工作区状态、迁移目录清单：test-results/membership-admin-redesign/M01/source-snapshot.json。
- 数据库当前已有 79 项已应用迁移；启动前后记录核对。测试使用 SQLx 隔离测试数据库，不把测试库迁移计为本任务生产迁移。
- 参考：桌面 DaoYun_DZ风格_后台界面_分离素材中的 8 张图，文件清单保存在 reference-material-files.json。

## 当前后台导航 → 目标导航

| 当前导航 | 当前路由/实际行为 | 最新目标 | M02 边界 |
| --- | --- | --- | --- |
| 工作台 | #admin/dashboard | 管理首页 | 保留真实聚合数据、捷径与 capability 门槛 |
| 用户与会员 / 用户管理 | #admin/users | 用户管理 | 已有列表，M02 只修改管理壳，列表细节归 M03 |
| 用户与会员 / 会员体系 | #admin/membership | 会员体系 | 既有名称已更新，保留领域和六分区 |
| 用户组、成长等级、积分管理、勋章管理、会员权益、兑换商品 | 会员页六个按能力过滤的工作区 | 相同六分区、相同顺序 | 不重命名 API key 或数据库字段 |
| 权限与治理 / 角色与权限 | #admin/authorization | 角色与权限 | 不改变系统角色只读与任命作用域 |
| 权限与治理 / 权限检查 | #admin/inspect | 权限检查 | 七项读取门槛、只读后端结果不变 |
| 版块管理 | #admin/boards，选中版块后的权限页 | M07 版块权限 | M02 保留入口；普通行为矩阵与治理来源后续分开 |
| 内容治理、扩展与数据、站点设置 | 主题/评论/举报/审核/风控、插件/统计、品牌/邮件/附件/运维 | 保留 | 不删除原有业务以满足新导航 |

当前源码已将“会员经济/成长运营/积分运营/勋章运营/标准权益/积分兑换”顶层用户可见名称改为“会员体系/成长等级/积分管理/勋章管理/会员权益/兑换商品”。会员权益工作区内部仍有“标准权益”标题、标签和发放文案，版块访问主体选择器也仍显示“标准权益”；这些残留不是已完成的全量文案替换，纳入后续 M06/M07。entitlement 等领域标识和历史规格标题保留。不能用旧规格的标题推断现有 UI 仍使用旧名称。

导航事实：src/components/AdminView.tsx:90–124；模块由 /api/v1/admin/access 与版块作用域能力过滤，会员入口要求任一会员领域能力，角色入口要求 roles.read 与 assignments.read，权限检查要求全部七项读取能力。会员标签顺序/过滤：MembershipAdminPanel.tsx:681–696。

## 领域模型与不可破坏边界

| 领域 | 当前事实来源与语义 | 禁止混淆 / 兼容边界 |
| --- | --- | --- |
| account status | users，admin_revision；active / restricted / suspended | 状态拒绝先于允许；restricted 按受限写项；suspended 会话失效。诊断 browse 分支需单独补负例，不能宣称已验证全部动作 |
| community groups | community_groups / community_group_memberships；一个基础组、多附加组，source/reason/starts_at/ends_at/revoked_at/revision | 13 项普通能力白名单，布尔 union、额度 max；默认基础组保护；禁止放入治理 capability |
| experience / level | experience_accounts.current_level_id + EXP 追加流水；已发布动态阈值 | 只展示成长，不授予权限。负向冲正保持既有等级；不得拿积分旧 level_key 代替 EXP 等级 |
| points | membership_accounts + point_ledger_entries，可消费、余额非负，独立幂等账本 | 不改变 EXP；旧 lifetime_points/level_* 兼容字段继续保留；不变为现金/充值 |
| medals | 目录规则 revision、用户当前持有、三类操作审计 | 荣誉，不授予管理权限；目录删除保留持有历史；当前用户授予/撤销没有独立幂等键或 revision 回执 |
| entitlements | 类型、版本、不可变权限/额度快照、用户授予时间与撤销事实 | 仅普通能力白名单，不赋予治理；类型新版本不改历史快照，插件停用不隐式撤销投影 |
| roles / assignments | instance / site / board；系统只读，自定义 revision；exact / subtree | 治理能力唯一来源；subtree 以当前真实树计算，不保存静态后代清单；授权上限、系统任命保护保留 |
| board policy | 版块自身/主题/附件 any_of / all_of；祖先可见状态、账号、组、权益、角色与资源上下文参与；树层级不继承访问策略 | 使用现有 permission engine，不新建另一套 ACL；只读检查不占额度，也不是后续请求的授权凭证 |

关键证据：crates/infrastructure/src/community_permissions.rs:92–101、255–311；authorization.rs:740–797、864–927；experience.rs:400–587；membership.rs:187–223、546–682；standard_entitlements.rs:298–321、400–525、611–691。公开 DTO 留在 api-contract，snake_case 仅在 API 边界映射为 camelCase。

## 六个指定页面：当前行为与 UI 契约

| 面板 | 当前真实行为 | 后续缺口 |
| --- | --- | --- |
| UserAdminPanel | 十个业务列（另有选择列）；基础/附加组、成长等级、EXP、积分、权益、状态、注册/活跃；真实筛选、游标、当前页选择导出；详情标签为概览/有效权限/用户组/最近内容/相关举报/管理记录 | M03 目标的 Lv+EXP 合并小进度尚无实现；M04 顶部完整会员身份、会员身份/账号安全标签、所有会员写操作与流水尚未整合。当前批量能力是选中导出，没有伪造批量副作用 |
| MembershipAdminPanel | 六分区按能力显隐；等级配置、积分增减及回执、勋章配置/发放/撤销/审计、组目录/成员、权益类型/版本/发放/撤销、兑换插件产品 | 具体用户仍需在各工作区选择；全局积分记录/统计不足；权益续期缺失；M04 要将操作放入当前 UID 档案 |
| CommunityGroupAdminPanel | 紧凑目录、搜索/筛选、默认基础组、创建/编辑/复制/比较、普通能力/额度、期限附加组授予/撤销 | 用户组编辑按最新七类分区尚未完全匹配；未知响应后授予/撤销重新生成 key 的风险需补测试再修复 |
| AuthorizationAdminPanel | 系统角色只读，自定义 CRUD/revision、权限目录、模板、高危确认，成员任命 exact/subtree、任命者与系统任命保护 | M07 角色列表密度/范围/权限项解释待对齐；不能编造没有领域字段支持的角色状态或到期任命 |
| BoardPermissionMatrix | 浏览/发帖/回复/上传/下载五列，最多四组+一个用户；组场景 complete=false，最终用户 complete=true，来源/版本/额度弹层 | 没有隐藏内容与治理列 provenance；需以 Role/Assignment 显示治理来源，不能塞进 community group；不是新 ACL |
| PermissionCheckPanel | 固定或选择用户、版块、五动作；主题/附件/文件大小上下文；后端 decision/reason、来源、额度与服务器时间 | 尚无账号/基础组/附加组/权益/角色逐层人话总览及折叠技术层；不能由 UI 重算最终结果 |

UserCommunityGroupAction / CommunityGroupMembershipManager 已能接受运行时 user prop，隐藏重复搜索（UserCommunityGroupAction.tsx:8–27，CommunityGroupMembershipManager.tsx:188–192）；PointsWorkspace 已接受 selectedUser prop。这里的“固定 UID”指固定当前选中用户，不是硬编码用户。

## 当前已有 API 与确认缺口

1. GET /api/v1/admin/users：真实分页与会员筛选；当前页 UID 一次批量 SQL 投影，不逐用户 HTTP。来源 admin.rs:499–580、admin_user_membership_read.rs:37–66。列表权益名称要求 types.read + grants.read，不能扩大 grants.read 的敏感可读字段。
2. GET /api/v1/admin/users/{id}/membership-summary：已实现，account/groups/experience/next_level/points/medals/entitlements/readable_sections；先 users.read，再按领域裁剪。组需 groups.read + memberships.read，成长 rules.read，积分沿用 points.grant，勋章 medals.read，权益 grants.read（admin.rs:650–780）。读取不会初始化账户；无权为 null，账户未初始化也为 null但 readable_sections 可区分。当前多个独立领域查询，不承诺跨域同一事务快照。
3. API 适配器已有 getAdminUserMembershipSummary，但 UserAdminPanel 尚未调用。不能重复新建同名万能接口；写操作仍独立。
4. EXP 底层 append_experience 已有原子账户/流水/outbox、同键回放、冲正；没有管理员调整与分页流水接口。新增命令必须明确能力、reason、revision、幂等与审计，不能把普通负向冲正当任意手填等级。
5. 积分 me/points/ledger 与 DAO 分页已有；管理员当前只有账户读与 points 写，没有按 UID 管理员流水读接口。
6. 权益类型版本历史已有；用户管理员列表调用 list_standard_entitlements_for_admin，WHERE user_id 不过滤过期/撤销，已包含完整授予历史。缺失的是续期命令与统一档案 UI，不能重复发放冒充原子续期。
7. 勋章操作列表与三类审计已有；用户当前持有状态去重不等于独立操作幂等 receipt，grant→revoke→重复旧 grant 的未知结果边界未充分保护。
8. 诊断只有五个普通动作，来源 DTO 为 group/entitlement；治理 provenance/动作扩展还未实现。src/api/permissionCheck.ts 不存在，真实适配器在 src/api/boardPermissions.ts。

### 已有路径目录（均保留领域独立写入）

所有路径以下列真实适配器为准；此目录不是本任务新增接口。以 /api/v1 为前缀。

| 领域 | 当前读取 | 当前写入 | 适配器出处 |
| --- | --- | --- | --- |
| 用户 | GET /admin/users、/admin/users/{id}、/{id}/content、/{id}/membership-summary | PATCH /admin/users/{id}/status | adminUsers.ts:145、155、168、178、327 |
| 社区组 | GET /admin/community/groups、/admin/community/memberships?user_id= | POST groups；PATCH groups/{id}；PUT default-group；POST memberships 与 memberships/{id}/revoke | admin.ts:928–1032 |
| EXP/等级 | GET /users/me/experience、/membership/levels、/admin/membership/levels；兼容 GET /admin/membership/level-rules | POST/PATCH/DELETE /admin/membership/levels[/{id}]；兼容 PATCH level-rules/{key} | membership.ts:45、77；admin.ts:879、1124–1168 |
| 积分 | GET /users/me/points/ledger；GET /admin/membership/users/{id} 读账户 | POST /admin/membership/points | membership.ts:84；admin.ts:1179、1250 |
| 勋章 | GET /admin/membership/medal-rules、medal-operations，账户含持有 | POST medal-assets、medal-rules、medals、medal-revocations；PATCH/DELETE medal-rules/{key} | admin.ts:1195–1276 |
| 会员权益 | GET /admin/entitlements/types、types/{key}/versions、/admin/entitlements?user_id=；GET /users/me/entitlements | PUT types/{key} 发布新版本；POST /admin/entitlements 与 /{id}/revoke | admin.ts:1043–1113；membership.ts:103 |
| Role/Assignment | GET /admin/authorization/permissions、roles、assignments | POST/PATCH/DELETE roles[/{id}]；POST/DELETE assignments[/{id}] | admin.ts:1287–1345 |
| 访问策略/诊断 | GET /admin/content-access-policies/{type}/{id}、/admin/boards/{id}/permission-matrix、/admin/permission-check | PUT /admin/content-access-policies/{type}/{id}；矩阵/检查不写入 | admin.ts:731–744；boardPermissions.ts:46、82 |

兑换商品当前通过积分兑换插件管理，权益类型/用户授予是独立领域；插件停用不能抹去历史商品、兑换事实或权益快照。现有 read model 只负责解释与投影，不变成权限引擎。

### 本轮后续确需补的能力

M01 新增接口为 0。M04 所需聚合 summary 已存在，直接复用。后续确需管理员按 UID 的 EXP 流水读取、EXP 调整命令及积分流水读取；权益原子续期命令在 M06 定义。M07 如扩展治理检查，扩展现有只读 DTO/诊断来源。具体路径、能力与命令冲正语义由各阶段先补契约/失败测试后确定，本次不注册占位接口，不变更 Schema。

写入必须继续保持 session、CSRF、服务端 capability、已有 revision/幂等/audit；勋章缺独立操作 receipt、组未知结果恢复等现有缺口按上述风险补齐。409 应重新读取基线并阻断旧 revision；网络未知结果应冻结原参数和 key 核实，不盲目重复产生副作用。UI 隐藏只表示可见性，服务端鉴权仍是最终控制。

## 现有覆盖与尚缺测试

| 现有覆盖 | 测试抓手 | 未覆盖的新要求 |
| --- | --- | --- |
| 用户列表/筛选/脱敏、详情竞态、状态 409、角色操作、焦点/分页 | UserAdminPanel.test.tsx；adminUsers.test.ts；apps/api/tests/users.rs:742、1033、1086 | 详情加载聚合、六标签、统一身份顶部、同 UID 的五领域操作与成功刷新 |
| 会员标签顺序/能力撤回、余额竞态 | MembershipAdminPanel.navigation.test.tsx；MembershipAdminPanel.interactions.test.tsx | 会员身份中跨领域草稿保留与权限撤回 |
| 默认组/CRUD/期限/移除/冲突/审计 | CommunityGroupAdminPanel.test.tsx；infra tests/community_groups.rs | 组授予/撤销未知结果冻结同一 key/日期/参数，409 后阻断旧版本重试 |
| 积分增减/非透支、同键确认、不可变回执 | PointsWorkspace.test.tsx；membership 集成测试 | 管理员历史流水、离开统一详情时未知结果保护；积分不改变 EXP 的端到端负例 |
| 动态等级阈值、EXP 幂等和不自动降级 | infra tests/experience.rs:48、112；MembershipAdminGrowthV3.test.tsx | 管理员 EXP 命令/流水鉴权、revision/审计、运营原因与冲正语义 |
| 勋章上传/目录 revision/只读、授予/撤销审计 | MedalsWorkspace.test.tsx；API tests/membership.rs:1474、1608 | 独立幂等回执、同 UID 勋章操作与反向操作后重放 |
| 权益快照/类型版本/期限/撤销/409/未知授予恢复 | EntitlementsWorkspace.test.tsx；API tests/admin.rs:1593 | 原子续期、并发/同键/历史快照不变，统一用户档案 |
| 系统角色只读、授权上限、exact/subtree、角色 409/危险确认 | AuthorizationAdminPanel.test.tsx；infra tests/authorization.rs | 最新角色展示契约、八类运营角色完整入口+直接访问矩阵 |
| 五动作/八额度/request_id/来源引用、真实资源状态与不占额度 | BoardPermissionMatrix.test.tsx；PermissionCheckPanel.test.tsx；boardPermissions.test.ts；API tests/admin.rs:1747、2410、2608 | suspended/restricted + browse 专项负例、治理来源与人话/技术两层、诊断和实际请求一致性全集 |

已点验风险：permission_matrix.rs:492–505 在 snapshot.denied 前处理 browse。这里只记录分支与缺失专项断言；不能声称已证实所有账号状态的最终漏洞，也不能由 UI 掩盖。真实写动作与会话另有拒绝控制。

## M02 可以修改的准确文件清单

- src/components/AdminView.tsx：同文件内 AdminShell、adminModules、adminGroups、导航、面包屑、搜索、移动选择器。保留全部入口和 capability。
- src/components/AdminView.test.tsx：分类授权显隐、原入口路由、搜索、折叠、主题、键盘、移动选择器行为。
- src/components/AdminDashboard.tsx 与 src/components/AdminDashboard.test.tsx：仅首页分区、密度、真实快捷入口/帮助；不得增加假统计。
- src/components/MembershipAdminPanel.tsx：只一级标题/六标签与可访问性，不重写领域写入 handlers。
- src/components/MembershipAdminPanel.navigation.test.tsx：标签顺序、键盘、能力撤回；src/components/MembershipAdminPanel.interactions.test.tsx 作为保留回归门禁，只有名称变化影响断言时同步。
- src/features/admin-membership/MembershipAdminPage.tsx：仅容器/标题/布局，保留领域边界提示。
- src/styles.admin.css：管理后台作用域内的高密度蓝白布局、section、表格、响应式与帮助区；不改公共社区样式。
- packages/design-tokens/tokens.css：仅确有需要的后台语义令牌，不给组件硬编码颜色；核验公共页面不回归。
- docs/handoffs/membership-admin-redesign/current.md、m02-result.md 与对应截图证据。

M02 不修改 UserAdminPanel 领域逻辑、六领域工作区命令、src/api、Rust、generated.d.ts、migrations；列表/详情/领域接口分别归 M03/M04/后续。若管理壳已满足既有要求，验证并做必要的小改动，不重做已通过的入口。

## 新阶段定义（后续按顺序）

M01 基线；M02 壳/导航；M03 用户列表（身份+成长 Lv/EXP/进度）；M04 统一用户详情最高优先；M05 用户组/成长/积分/勋章后台；M06 会员权益/兑换；M07 角色/版块权限/权限检查；M08 二十项最终验收与八类角色矩阵、六尺寸（另加 1920）。旧 docs/tasks/admin-membership-rebuild 的阶段编号是历史记录，不作为最新范围。

## 门禁与截图

本次门禁真实运行结果如下。M01 的 DONE 表示基线已完整记录，并不表示全部门禁通过或视觉重构完成。

| 门禁 | 结果 | 数量 / 证据 |
| --- | --- | --- |
| targeted tests | PASS | 13 文件、154 项；targeted.log，包含下方全量测试，不相加 |
| pnpm test | PASS | 120 文件、1131 项；frontend.log |
| pnpm typecheck | PASS | typecheck.log |
| pnpm test:e2e:typecheck | PASS | e2e-typecheck.log |
| pnpm build | PASS | build.log，真实生产包用于截图 |
| pnpm generate:api --check | PASS | api-generate.log 与最终 api-generate-final.log；generated.d.ts 哈希无变化 |
| cargo test --workspace | PASS，1 ignored | 503 passed、0 failed、1 ignored；rust-workspace.log；77 个结果块含 doc tests |
| cargo fmt --all -- --check | PASS | fmt.log；实际 GNU 1.94.1 工具链 |
| cargo clippy --workspace --all-targets -- -D warnings | PASS | clippy.log；exit 0 |
| 会员静态素材校验 | PASS | package 脚本等价执行 node scripts/verify-membership-assets.mjs；20 等级资产、17 勋章资产，非实时目录数量 |
| WASM 依赖闭包校验 | PASS | 默认 / base / wasm 三种 feature 组合；wasm-feature-closure.log |
| git diff --check | PASS | diff-check.log |
| 默认 pnpm test:e2e | FAIL | 344 项：90 passed、24 failed、230 skipped；e2e-default.log 与 e2e-summary.json |
| 真实浏览器基线 | 已执行 | 117 张独立 PNG；117 次布局检测无整页横向溢出；22 次桌面 axe 扫描，9 个规则出现项/11 个节点，不能标成全通过 |

证据根目录：test-results/membership-admin-redesign/M01。gates.json 汇总实际结果；source-zero-diff.json 核对 19 个关键源码和 generated；迁移 before/after 的 79 行一致。首次 Rust/E2E 运行因验收运行时重启中断，保存为 interrupted 日志且不计最终结果；上表是完整重跑。会员素材 shell 启动失败单独保存 bootstrap 记录，直接执行同一 package 脚本成功。没有降低断言或删除测试。

### 截图基线

screenshot-manifest.json 列出准确文件名。23 种当前视图 × 5 宽度 = 115 张浅色图，另加角色页 320/1440 深色图 2 张，总计 117。五个宽度为 320、390、768、1024、1440，高度 960；截图 fullPage，抽屉内部按实际滚动区域记录，矩阵另有结果与来源视图。

当前视图包括首页、用户列表、详情概览/用户组、会员六分区（积分另有已选真实用户）、角色、版块矩阵/结果/来源、权限检查入口/真实结果、用户组编辑、等级编辑、勋章编辑、权益发布下一版本、角色编辑、系统角色只读。当前不存在统一“会员身份”详情或账号安全页，不能伪造相应截图。

真实本地数据库与现有管理员会话；未在验收中提交发放、撤销、调整等业务写操作。一次真实检查返回注册会员在社区广场可发帖、发帖额度 10/已用 0；矩阵的回复/上传/下载仍显示缺少资源上下文。截图里的用户与目录由 API 读取，无页面假数据。

browser-layout.json 无整页溢出；browser-network.json 中 56 次被监控 API 读取均无 4xx/5xx；browser-errors.json 无 pageerror。键盘记录 browser-keyboard.json：会员 tab 方向键切换并聚焦积分管理，用户组编辑 Escape 关闭并恢复原按钮焦点。颜色/内容密度仍按当前实景记录，320px 个别标题/按钮换行或截断、矩阵在抽屉内滚动，不因此声称视觉验收已通过。

### 已有失败与后续处理

1. 默认 E2E：公共配色断言 2 项（background/text 令牌与断言不同）、图片预览高度 4 项（期待 900，实际 876）、插件页对比度 8 项（4.26，要求 4.5）、版块路由控制台 10 项（/b/engineering 404）。这些来自当前工作区与此本地环境，本任务没有修复或放宽测试；后续需要分别确认产品回归/测试契约/网关路由。完整附件在 e2e-default 子目录。
2. axe 基线：用户详情 heading-order/skip-link；用户组、等级编辑 aria-allowed-role/heading-order；权益版本编辑 aria-allowed-role；系统角色只读 scrollable-region-focusable。合计六视图、11 节点。skip-link 包含 SPA hash 内容链接，需实测焦点语义，不直接宣称所有链接不可用。准确 DOM target 见 browser-accessibility.json。
3. 未运行：230 个条件跳过的 live/local/UI-v2 E2E 场景未执行，不能算 PASS；1 个 Rust ignored 的 official_growth_component_instantiates_with_only_bounded_wasi_cli_imports 需构建 official-growth-rewards 后专项运行；1920 与八类角色完整矩阵归 M08，未宣称已验证。
4. 领域缺口：用户详情未接入 summary；管理员 EXP 命令/EXP 与积分流水、权益原子续期、治理来源和两层解释、未知结果恢复等仍 NOT DONE。上面的 API/测试缺口是后续阶段入口。

## 收口与暂停

- DONE：六面板和真实领域/API/覆盖核对；导航映射；五尺寸基线；门禁全部实际执行并记录通过/失败/跳过；M02 文件边界。
- NOT DONE：整体视觉/交互重构与最新 M02–M08。
- 本次新增接口 0，数据库迁移 0，生产源码修改 0，已有迁移/生成类型零变化；仅文档和验收证据。M04 未接入草稿保存并移出生产目录的清理记录在旧计划中，不作为完成实现。
- Git HEAD/分支如开头；本次 commit SHA 无（未创建提交），工作区保持既有未提交修改，没有 stash/reset、没有工作树切换、没有覆盖用户修改。
- 完成本任务后按用户要求 PAUSED；后续必须由用户继续指令启动 M02，不自动进入下一阶段。
