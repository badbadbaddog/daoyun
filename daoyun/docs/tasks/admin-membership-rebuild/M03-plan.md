# M03 Task Plan：用户会员 Read Model 与列表

状态：DONE（2026-10-06）。依赖 M02 DONE。

## 当前行为
用户列表/详情只含账号、角色与内容指标；现有公开会员摘要不足以读取后台来源、原因、revision。各领域已有指定用户读取函数，EXP 独立于积分旧等级。用户列表只筛选状态、角色、注册时间。

## 任务顺序
1. M03-T01：新增 GET /api/v1/admin/users/{user_id}/membership-summary，作为只读聚合，返回 account、groups、experience（含真实当前等级）、next_level、points、medals、entitlements 与 readable_sections。先写 Rust API/OpenAPI 负例与前端适配器失败测试，再接真实读取。
2. M03-T02：批量列表投影、服务端组/成长/权益/最后活跃过滤，更新核心十列和 CSV，保留内容指标于详情。禁止为列表每行调用聚合接口。

## T01 文件与边界
crates/api-contract/src/user.rs 与 exports；apps/api/src/admin.rs、lib.rs 的 route/OpenAPI；apps/api/tests/users.rs；src/api/adminUsers.ts 及测试、generated.d.ts。不改 Schema、授权决策链或领域写接口。

- 入口必须具有 admin.users.read。groups 需 community.groups.read + community.memberships.read；experience 需 membership.rules.read；points 沿用现有读取门槛 membership.points.grant；medals 需 membership.medals.read；entitlements 需 entitlements.grants.read。字段不越权，未授权为 null，不伪造 0/空数组；readable_sections 区分权限与未初始化。
- 聚合只读，不创建账户、不调整 EXP、不隐式改变积分/角色。next_level 从已发布成长目录和当前后端等级确定，不提供手填等级。
- missing session / forbidden / malformed ID / unknown user 均保持 envelope/header request_id，授权在用户存在性查询前完成。公开接口与现有独立写契约不变。

## T01 验收与收口
观察新增测试 RED；实现后 targeted Rust API、前端适配器 tests → 全量前端/TypeScript/production build → cargo test --workspace / fmt / clippy（真实测试库）→ OpenAPI 重新生成并校验 → 浏览器通过同一已登录会话读取真实聚合且现有页面零回归、保存截图 → T01-result。T01 完成后仍需 T02，M03 不提前标 DONE。

## 进度
M03-T01 DONE：见 M03-T01-result.md。M03-T02 DONE：见 M03-T02-result.md。M03 整体 DONE；按用户要求暂停，未启动 M04。
