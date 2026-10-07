# M03-T02 Task Result：用户列表会员字段与筛选

状态：DONE。日期：2026-10-06。按用户“完成当前任务就暂停任务”的要求，本 Task 收口后暂停；不启动 M04。

## 实现
- GET /api/v1/admin/users 增加紧凑 membership 投影：有效基础/附加组、EXP 与真实当前成长等级、独立积分余额、有效会员权益、勋章数、readable_sections。页面 UID 一次批量查询，未初始化账户不创建，不从管理角色或积分旧等级推导社区身份/成长。
- 服务端支持基础组、附加组、成长等级、权益类型与最后活跃区间；保留搜索、状态、管理角色、注册区间、排序和分页。相同静态 SQL 谓词约束列表与游标；时间 inclusive start/exclusive end，撤销与期限按当前领域规则读取。
- 入口仍要求 admin.users.read。组字段/筛选要求 groups.read + memberships.read，成长要求 rules.read，积分沿用 points.grant，勋章要求 medals.read，权益名称与类型筛选要求 types.read + grants.read。不可读字段为 null，私有筛选无对应能力返回 403，防止筛选侧漏。
- 主表为十个核心业务列 + 勾选列；原治理角色和内容指标保留在详情/CSV 高级信息。全部筛选来自真实目录；失败可重试。URL 恢复、重置、分页条件、选择和 CSV 均保留。不可读、未初始化、未提供档案三种情况明确区分。
- 桌面密集表格，窄屏保留十一字段与真实详情、导出、批量选择；日期筛选区标明注册/活跃。

## 文件
- DTO：crates/api-contract/src/user.rs、lib.rs、tests/response_contracts.rs。
- 查询：新增 crates/infrastructure/src/admin_user_membership_read.rs；users.rs、lib.rs、tests/users.rs。
- API/OpenAPI：apps/api/src/admin.rs、lib.rs、tests/users.rs。
- 前端：src/api/adminUsers.ts、adminUsers.test.ts、generated.d.ts；src/components/UserAdminPanel.tsx、UserAdminPanel.test.tsx；src/styles.admin.css。
- E2E 探子只读核对，没有发现需因主表列调整而修改的既有浏览器断言。现有测试未删除；原角色刷新断言更新为确认真实列表重载及会员字段呈现。

## RED → GREEN
- 前端新增字段/脱敏/筛选分页测试先失败；目录错误恢复测试先失败。
- 后端准备数据最初撞 display_order 唯一约束，修正测试组排序和撤销幂等键后重跑，三项测试真实失败于缺失会员投影、附加组筛选无效、OpenAPI 缺参；不是以准备数据错误作为 RED。
- 实现后定向测试与完整测试全部通过。共享 DTO 测试补齐新增可空字段，保留私有信息排除断言。

## 验证
| 检查 | 结果 | 证据（test-results/admin-membership-rebuild/M03/T02） |
| --- | --- | --- |
| 前端 targeted | 2 文件 / 52 项 PASS | targeted-frontend-final.log |
| 前端全量 | 120 文件 / 1131 项 PASS | full-frontend-verified.log |
| TypeScript | exit 0 | typecheck.log |
| E2E TypeScript | exit 0 | e2e-typecheck.log |
| Production build | exit 0 | build-layout-final.log（此前 tsc -b 已通过） |
| 真实 OpenAPI 生成及一致性 | exit 0 | generate-api.log / api-types-check.log |
| Rust 用户接口 targeted | 10 项 PASS | targeted-rust-list-2.log |
| Rust workspace | 503 项 PASS | rust-workspace-final.log |
| fmt --all -- --check | exit 0 | fmt-check.log |
| clippy workspace all-targets -D warnings | exit 0 | clippy-final.log |
| git diff --check | exit 0 | diff-check.log |
| 浏览器 | 20 组布局无整页横向溢出、10 组 axe 零违规 | browser-results.json |

测试环境使用已安装 Rust 1.94.1 GNU 工具链与真实本地 PostgreSQL；未改依赖或数据库 Schema。并行编译期间前端备份脚本原 5 秒测试曾超时；停止编译负载后按原标准独立全量重跑，1131 项通过，未加超时、跳过测试或降低断言。预览服务更新构建时曾被运行中二进制锁阻止，停止该服务后重建并恢复原 wasm-plugins 开启配置。

## 浏览器验收与截图
同一真实管理员会话、真实 API，未伪造接口响应：基础组/成长筛选返回真实三用户，附加组/权益筛选返回实际空集；未来活跃日期返回空集；limit=1 真实游标分页返回不同 UID，request_id 与响应头一致。人为中断目录网络后，重试重新读取真实目录。勾选三用户导出 CSV 含会员核心字段与高级内容指标，详情可打开返回；320px 全选可用。列表逐行 membership-summary 请求数为 0。最终页面运行错误、console error、失败网络请求均为 0。

截图：users-{1440,1024,768,390,320}-{light,dark}.png 与 user-detail-{1440,1024,768,390,320}-{light,dark}.png。最终截图使用完成构建后的文件；users-1440-initial.png 仅是过程记录。

## 边界与暂停交接
本 Task 仅增加只读投影和筛选，所有领域写接口、会话/CSRF/capability/revision/idempotency/audit、治理角色/社区能力分离、权益快照和 EXP/积分独立性保持现有实现。M03-T01 + T02 均 DONE，M03 整体 DONE。统一用户详情和会员身份写操作属于 M04，配置页面、矩阵、权限人话解释和全套十九页验收属于 M05–M08，尚未实施。等待用户明确继续后再从 M04 的计划与失败测试开始。
