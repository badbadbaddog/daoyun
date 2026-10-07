# M01 架构核对：A–G

核对方式：主代理完整读取 AdminView.tsx 与用户指定的三个领域规格；八个独立只读探子读取其余指定生产源码、对应 API/DTO、migrations 和代表测试，主代理按行号点验关键代码。未开始大规模修改。

## A. 当前信息架构
- AdminView 按 /admin/access capability 与作用域版块能力决定模块，懒加载真实面板，路由保留 query；没有权限的分类不展示。入口在 AdminView.tsx:93–211。
- 分类为工作台、内容治理、版块管理、用户与会员、管理团队、扩展与数据、站点设置。会员模块显示名仍为“会员经济”（:102），治理分组仍为“管理团队”（:118）。
- MembershipAdminPanel.tsx:555–561 的标签依次为成长运营、积分运营、勋章运营、用户组、标准权益、积分兑换；按领域 capability 过滤，初始选择同顺序（:681–700）。
- UserAdminPanel.tsx:276–286 的列表为用户/主要角色/状态/主题/回复/举报/注册/活跃/操作；详情为概览、有效权限、用户组、最近内容、相关举报、管理记录（:374–423）。用户通过 user_id 固定上下文并取消旧请求。

## B. 会员模型
| 模型 | 事实来源 | 关键不变量 |
| --- | --- | --- |
| 账号状态 | users/status、admin_revision；infra/users.rs | active/restricted/suspended，状态治理与身份不混用 |
| 社区用户组 | community_groups 与 community_group_memberships；infra/community_groups.rs:101–142 | 一个未撤销基础关系，多附加关系；来源/原因/时窗/revision/授予及撤销幂等 |
| EXP/成长 | experience_accounts、experience_ledger_entries、membership_levels；infra/experience.rs:391–571 | 追加流水，自动解析已发布等级；现状只自动升级，负向冲正不降级 |
| Points | membership_accounts、point_ledger_entries；infra/membership.rs:13–32、816–1010 | 可消费，余额非负，独立幂等账本；lifetime_points 仍驱动旧 level_*，不能当 EXP |
| 勋章 | membership_medal_rules、user_membership_medals；infra/membership.rs:411–683 | 荣誉展示；唯一 user/medal 归属；目录删除保留 ownership，不产生权限 |
| 会员权益 | 类型/版本/用户投影；infra/standard_entitlements.rs:400–530、982–1005 | 不可变 permission/quota 快照，时间生效和撤销，普通能力白名单，revision/幂等/审计/outbox |
| 管理角色 | roles/role_permissions/role_assignments；infra/authorization.rs:864–927 | 治理能力与 instance/site/board 作用域，exact/subtree 动态覆盖 |

社区组字段白名单是 13 个普通能力，不能放 moderation 等治理键（infra/community_groups.rs:1–36）。有效组/权益普通能力做并集，额度按 key 最大值（infra/community_permissions.rs:237–311）。

## C. 权限决策链
1. 真实请求检查账号状态；suspended 会话失效，restricted 阻断指定写能力。
2. 普通能力从有效组与权益快照读取，检查时窗/撤销/组状态。
3. 检查版块、祖先版块和主题/附件策略、锁定、内容状态、版块内限制。
4. 治理动作独立查询 Role/Assignment 和动态 exact/subtree；不从 EXP/积分/勋章/VIP 推导。
5. 额度由实际业务事务原子消费；只读诊断不占用额度，不是授权 token。

关键原文：infra/community_permissions.rs:145–175 的条件 UPSERT；:255–267 的账号拒绝；:270–307 的 union/max 与 restricted；migrations/202608150006_add_dynamic_governance_scopes.up.sql:1–40 动态树；202608180001_enforce_parent_board_access_policies.up.sql:1–78 父策略。

诊断边界：DTO 仅五动作 browse/topic_create/reply_create/attachment_upload/attachment_download，来源仅 group/entitlement（api-contract/permission_matrix.rs:8–39）。用户场景会检查 Role 对内容策略的匹配，但不返回治理角色 provenance。get_permission_check 在解析参数和查询资源前要求全部七个读取 capability（apps/api/src/permission_matrix.rs:269–339）。

需在 M07 测试核验的缺口：infra/permission_matrix.rs:492–506 的 browse 分支在 snapshot.denied 之前执行；不能据此声称诊断对暂停用户始终账号拒绝优先。资源检查还可能改变先前结果，需以真实后端负例确认，不能在 UI 掩盖。

## D. 已有 API
| 领域 | 方法与端点 | 现状边界 |
| --- | --- | --- |
| 用户 | GET /api/v1/admin/users；GET /users/{id}；GET /users/{id}/content；PATCH /users/{id}/status | 列表只有文本/账号状态/role_id/注册日期/cursor；DTO 无会员字段。见 apps/api/src/admin.rs:93、398–516，src/api/adminUsers.ts:7–66、127–185 |
| 用户组 | GET/POST /api/v1/admin/community/groups；PATCH /groups/{id}；PUT /community/default-group | 更新 expected_revision，默认基础组不可停用/归档；API admin.ts:927–993 |
| 组成员 | GET/POST /api/v1/admin/community/memberships；POST /memberships/{id}/revoke | GET 按 user_id；授予/撤销幂等，撤销 revision；API admin.ts:996–1040 |
| 成长配置 | GET/POST /api/v1/admin/membership/levels；PATCH/DELETE /levels/{id} | 独立 EXP 阈值/顺序配置；API admin.ts:1123–1155 |
| EXP | GET /api/v1/users/me/experience | 仅当前用户，无管理员按用户流水/调整端点；apps/api/src/users.rs:276–400 |
| 积分 | GET /api/v1/admin/membership/users/{id}；POST /membership/points；GET /users/me/points/ledger | 管理读取要求 points.grant；写入含幂等键，冲突目前 422；私有流水只有 me；admin.rs:2143–2244 |
| 勋章 | 规则 GET/POST/PATCH/DELETE /api/v1/admin/membership/medal-rules；POST /medal-assets；POST /medals；GET /medal-operations；POST /medal-revocations | 规则 revision；授予/撤销请求无通用 revision/幂等字段，由唯一归属和事务审计去重；admin.rs:2463–2804 |
| 权益 | GET /api/v1/admin/entitlements/types；GET /types/{key}/versions；PUT /types/{key}；GET/POST /entitlements；POST /{id}/revoke | GET 按用户有效权益；版本/撤销有 revision；授权/撤销幂等。没有续期；admin.rs:1212–1323、1539–1700 |
| 兑换 | GET /api/v1/admin/redemption-products；PUT /{id}；用户 POST /api/v1/users/me/redemptions | 已有 provider、产品版本、幂等兑换 receipt；不引入资金；src/api/redemptions.ts:62–86 |
| 角色 | GET /api/v1/admin/authorization/permissions/roles/assignments；角色 POST/PATCH/DELETE；任命 POST/DELETE | 系统角色只读，自定义角色修改 revision；任命保留 scopeMode；src/api/admin.ts:1286–1348 |
| 诊断 | GET /api/v1/admin/boards/{id}/permission-matrix；GET /api/v1/admin/permission-check | 五种普通动作，真实资源上下文，七个读取 capability；src/api/boardPermissions.ts:40–95 |

路径说明：表格省略部分同级前缀以便阅读，实现时使用原适配器完整路径。src/api/permissionCheck.ts 不存在；真实实现与 DTO 映射在 boardPermissions.ts，permissionCheck.test.ts 从该文件导入。公开 /users/{username}/membership-summary 只含公开字段，不能代替后台档案。

## E. 复用组件
- 身份：UserAvatar、AdminUserPicker、UserCommunityGroupAction/CommunityGroupMembershipManager；同一个 UID 由用户详情传入，不重复搜索。
- 领域：GrowthWorkspace、PointsWorkspace、MedalsWorkspace、EntitlementsWorkspace、RedemptionWorkspace。
- 治理：UserStatusAction、UserRoleAction、TeamAppointmentForm、BoardPermissionMatrix、BoardPermissionPresets、PermissionCheckPanel。
- 交互：Drawer、ModalDialog、AdminActionDialog、ConfirmDialog、RevisionConflictNotice、MutationResult、RelatedAuditLog。
- 现有草稿/竞态/焦点/确认/幂等测试保留，不通过调整断言降低标准。

## F. 确认需要补的契约
1. 后台 GET /api/v1/admin/users/{id}/membership-summary：真实 account/groups/experience/level/points/medals/entitlements 聚合，按能力分区；未授权/不可用与空数据区分。只读一致快照，统一 request_id/OpenAPI。
2. 扩展管理员用户分页 Read Model：组/成长/EXP/积分/当前权益字段，服务端基础组/附加组/等级/权益/注册时间/活跃时间筛选；避免列表 N+1 和当前页客户端冒充全量筛选。
3. 管理员用户维度 EXP/积分分页流水、权益完整历史读取；当前只有 me 或 active 查询不够。
4. 独立管理员 EXP 调整命令：原因、幂等、权限、事务审计和明确 revision 处理；等级由后端现有解析规则决定。
5. 独立权益续期命令：保留不可变快照与授予历史，revision/幂等/审计。不得用撤销后随意重建代替原子续期。
6. 扩展治理诊断 Read Model：账号状态、基础/附加身份分类、权益、角色任命、资源/策略/额度来源；治理动作单独检查 Role，不用组矩阵的 not_provided 表示最终拒绝。

以上是需求所需缺口，不是已交付接口。具体新增读取 capability、DTO 和端点在对应阶段先用契约/隐私负例测试确定；不能默认为 admin.users.read 自动获得所有敏感领域读取/写入权限。首阶段不修改 Schema，不合并写操作为万能接口。

## G. 兼容与安全边界
- 原公开接口、独立领域表/写命令、事务审计/outbox、权限白名单、动态作用域继续保留。
- 所有写操作保留 session/CSRF/capability 与该领域既有 revision/幂等；不得因 UI 改版去掉近期认证或审计。
- 409 保留草稿并刷新基线；网络未知结果锁定参数并复用同一幂等键；不自动换键制造新副作用。
- 角色部分成功后的重新读取、系统角色只读、成员时窗、默认基础组保护、权益快照与 provider 关闭后历史保留不能退化。
- 不修改积分为现金，不引入支付，不让成长/积分/勋章/权益产生治理权限。

## 相关测试抓手
UserAdminPanel.test.tsx：用户上下文、用户组懒加载、旧请求丢弃、状态409；MembershipAdminPanel.interactions.test.tsx：余额竞态；PointsWorkspace.test.tsx：同键重试/未知输入锁定；EntitlementsWorkspace.test.tsx：快照/409/未知授权；MedalsWorkspace.test.tsx：上传/冲突/只读；AuthorizationAdminPanel.test.tsx：角色409/删除/作用域；BoardPermissionMatrix.test.tsx 与 PermissionCheckPanel.test.tsx：来源、输入、竞态与能力门槛。后端 experience/community_groups/standard_entitlements/authorization/membership tests 保留并针对新契约扩展。
