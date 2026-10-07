# 用户、会员与权限后台重构：M01–M08

## 当前进度（2026-10-08）

**M01–M08 DONE，8/8 阶段完成，整体 DONE；实现已提交，未部署。**

2026-10-08 按用户指令提交并推送新分支 codex/membership-admin-redesign-20261008；实现提交 c6c7731e6a5259b6336bdb9d2fac4315eb89397a，完整版本记录与推送回执入口见当前交接。

当前阶段划分与完整事实见 [当前交接](../../handoffs/membership-admin-redesign/current.md)，最终验收、未执行项及限制见 [M08 最终报告](../../handoffs/membership-admin-redesign/m08-final.md)。本目录保留旧计划与旧阶段结果；下方历史阶段编号、19 页定义和暂停状态记录的是 2026-10-06 的进度，后续执行采用当前交接中的最新划分。

| 阶段 | 当前状态 | 完成内容 | 结果入口 |
| --- | --- | --- | --- |
| M01 | DONE | 真实基线、领域模型及 UI 契约 | [基线](../../handoffs/membership-admin-redesign/m01-baseline.md) |
| M02 | DONE | 管理壳、导航与会员一级结构 | [结果](../../handoffs/membership-admin-redesign/m02-result.md) |
| M03 | DONE | 用户列表、身份及成长展示 | [结果](../../handoffs/membership-admin-redesign/m03-result.md) |
| M04 | DONE | 统一用户详情与同 UID 领域操作 | [结果](../../handoffs/membership-admin-redesign/m04-result.md) |
| M05 | DONE | 用户组七分类、EXP/积分流水及勋章回执 | [结果](../../handoffs/membership-admin-redesign/m05-result.md) |
| M06 | DONE | 权益原子续期、不可变回执及冲突恢复 | [结果](../../handoffs/membership-admin-redesign/m06-result.md) |
| M07 | DONE | 治理来源、版块权限与六层权限解释 | [结果](../../handoffs/membership-admin-redesign/m07-result.md) |
| M08 | DONE | 20 项、8 类账号、6 宽度及最终质量门槛 | [最终报告](../../handoffs/membership-admin-redesign/m08-final.md) |

最终验收：前端 1251 通过；Rust 532 通过、1 ignored；默认 E2E 114 通过、0 失败、230 skipped；真实浏览器 290 张截图。ignored/skipped 未执行，不计通过。临时服务已停止，原 PostgreSQL 保留。

## 授权与约束
依据本轮用户指令实施；使用桌面分离素材的密度与蓝白视觉，不复制旧论坛实现。账号状态、社区组、EXP/成长、积分、勋章、权益、管理角色始终分离。业务读取与写入接真实接口；不使用假数据、静态动作或前端授权推导。首阶段不修改 Schema，后续优先增加后台 Read Model。旧公开接口、领域写入、快照与审计保留。

## 执行规则
严格 M01 → M08。每阶段先保存计划、当前行为、文件、验收，再写失败行为/契约测试，实现后先 targeted 再全量前端测试、TypeScript、production build；涉及后端时增加真实 PostgreSQL Rust 测试、fmt、clippy、OpenAPI 生成检查。浏览器覆盖 1440/1024/768/390/320 与浅深主题，保存截图和结果。未执行验证不得写 DONE。阶段内复杂工作拆小任务并串行执行，不跨阶段并行修改。代码修改和最终验证只由主代理执行，探子仅作只读定位。

## 历史阶段定义（2026-10-06）
| 阶段 | 可验收结果与页面 | 主要文件/依赖 |
| --- | --- | --- |
| M01 | 完成 A–G 源码架构核对、接口清单、缺口与边界；建立基线，生产行为不变 | 本目录 architecture.md、M01-plan.md、M01-result.md；无前置依赖 |
| M02 | 管理首页与分类导航：用户与会员/权限与治理；会员体系六标签按用户组/成长等级/积分管理/勋章管理/会员权益/兑换商品排列，搜索/路由/权限门槛仍有效 | AdminView、MembershipAdminPanel、AdminDashboard、对应测试与 scoped CSS；依赖 M01 |
| M03 | 用户列表会员 Read Model、后端分页筛选，列表十个核心字段、折叠高级内容指标；聚合 membership-summary 供详情使用 | 用户 DTO/infra/users/API admin、adminUsers 适配器、UserAdminPanel 与各层测试；依赖 M02 |
| M04 | 用户详情概览与统一会员身份：固定同一个 UID，组/EXP/积分/权益/勋章读取与独立写操作、流水、历史；概览/会员身份/有效权限/内容/账号安全/管理记录页签 | 用户详情、会员动作组件、聚合与 EXP/流水/权益续期契约；依赖 M03 |
| M05 | 用户组列表/编辑、成长列表/编辑、积分管理/发放弹窗、勋章管理/编辑、会员权益管理/编辑、兑换商品：紧凑列表/fieldset/tab、真实配置、来源/期限/原因及冲突恢复 | 六 admin-membership 工作区、CommunityGroupAdminPanel、对应测试与样式；依赖 M04 |
| M06 | 角色目录/编辑与版块权限：左版块树、中普通组矩阵、治理列来自 Role/Assignment，最终结果标来源 | AuthorizationAdminPanel、BoardPermissionMatrix/BoardAdminPanel、治理诊断 DTO/API/infra 与测试；依赖 M05 |
| M07 | 权限检查/详情人话优先，账号/基础组/附加组/权益/版块策略/治理角色/资源/额度解释，技术详情折叠；服务器结果权威 | PermissionCheckPanel、boardPermissions 适配器、诊断 DTO/API/infra 与测试；依赖 M06 |
| M08 | 19 页完整端到端验收、权限负例/409/未知结果/会话与请求 ID 回归，最终截图与交接清单 | 各层测试、e2e、截图和任务结果；依赖 M07 |

## 小任务边界
- M03 分用户聚合档案读取与用户分页筛选两个纵切；每个契约带鉴权、request_id 与 OpenAPI。
- M04 分固定用户上下文和组/积分/勋章复用、EXP 流水/调整、权益历史/续期；各写入保持独立端点。
- M06 分角色目录/任命和版块矩阵/治理来源；不把治理 capability 加到社区组。
- M07 先完善诊断契约与后端原因，再实现人话视图；不能在客户端重算授权。

## 必须保持的语义
1. 账号状态具有拒绝优先级；restricted 仅按已有限制项拒绝，suspended 会话失效。
2. 一个基础组、多附加组；有效普通权限 union、额度 max。
3. 成长来自 experience_accounts，不能读取 membership_accounts.level_* 当 EXP；不提供手填等级。
4. 旧 EXP 负向冲正不自动降级，本轮新命令必须明确返回真实后端等级，不能 UI 自行推算。
5. Points 与 EXP 无隐式联动；勋章/权益不能授予治理权限。
6. 聚合读取不会扩大 capability：未授权字段不返回真实数据，不用零值冒充。
7. 网络未知结果保留原幂等键与参数；409 保留草稿、刷新 revision。
8. 治理 exact/subtree 动态覆盖及权益版本快照、有效期、审计/outbox 保留。
9. 不引入支付、真实资金或充值。

## 历史状态（2026-10-06）
M01、M02、M03 DONE（2026-10-06，见对应 result.md）；M04–M08 NOT DONE。上一轮视觉底稿仅表示样式基础完成，不代表本轮 19 页业务重构完成。


## 历史暂停（2026-10-06）
用户要求“完成当前任务就暂停任务”。M03-T02 已完成并验证，整体工作现已暂停；未经用户继续指令不进入 M04。恢复入口：M03-result.md 与 M03-handoff.md。
