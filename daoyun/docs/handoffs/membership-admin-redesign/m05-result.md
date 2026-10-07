# M05 用户组 / 成长 / 积分 / 勋章后台：结果

状态：DONE / PAUSED。2026-10-06。M01–M05 已完成；整体重构 NOT DONE。未进入 M06。

计划：[m05-plan.md](m05-plan.md)。当前交接：[current.md](current.md)。基础事实：[m01-baseline.md](m01-baseline.md)；前阶段：[m04-result.md](m04-result.md)。证据目录：test-results/membership-admin-redesign/M05。

## 完成行为

成长工作区与用户详情固定 UID 入口读取真实 EXP 账户及分页流水。管理员可增加 EXP，或选择同 UID 原始正向流水作一次完整冲正；冲正保留已达等级。没有账户时明确显示未初始化，历史缺少操作者/人工原因/原请求号/审计关联时按真实空值显示。积分工作区和详情增加真实分页流水，复用既有 PointsLedgerEntry 与读取能力，不制造历史记录。

EXP 命令在账户行锁后复核权限与版本，ledger/account/outbox/audit 同事务提交；审计失败全部回滚。同键严格核对操作者、数额、原因、冲正对象及原 expected_revision。重放返回原流水及最新账户，界面区分原回执余额/版本与当前账户，避免误报再次增加。只允许精确抵消原正向流水一次，不允许冲正其他 UID 或冲正流水。

勋章授予、撤销与自动授予共享同 UID 状态行锁。独立不可变 receipt 保存原命令、事实、版本、审计、原请求号及素材快照；同键查找先于当前版本、目录及持有状态校验。grant→revoke→旧 grant 重放不会恢复持有，目录删除后仍可读取原 receipt。无变化命令明确 affected=false，有 receipt、无伪造审计，也不增加版本；一次自动授予事务发生持有变化只递增一次版本。

用户详情和全局勋章对话框复用相同安全操作。未知结果保留完整输入和原 key，锁定同一详情内的其他领域写入、关闭及切 UID，支持查询原 receipt 或完全相同参数重试。receipt 404 继续表示未确认，不能自动当作失败重新造 key。409 显式刷新版本并保留原因后生成新命令。读取有 abort/version fencing；固定 UID 组件由 keyed 宿主使用。

用户组配置形成七个稳定 tab/panel：基本信息、浏览与发言、互动与私信、附件与下载、资料与外链、审核要求、成员与期限。保留现有 13 个普通/审核能力与 8 个额度字段，不扩展治理白名单；支持方向键、Home/End 与错误分类定位。编辑标题为 h2，分类及预览标题为 h3；成员与期限复用现有关系入口，统计使用真实数据。

## API 与迁移

新增 6 个 API，均在 /api/v1 下；更新已有 2 个勋章写接口。公开 DTO 位于 crates/api-contract，OpenAPI 与生成 TypeScript 同步。

| 路径 | 能力及事实 |
| --- | --- |
| GET /admin/membership/users/{user_id}/points/ledger | membership.points.grant；真实空页/分页 |
| GET /admin/membership/users/{user_id}/experience | membership.rules.read；真实账户或 null |
| GET /admin/membership/users/{user_id}/experience/ledger | membership.rules.read；真实分页 |
| POST /admin/membership/experience | membership.rules.write + CSRF；版本/幂等/原因/原子审计 |
| GET /admin/membership/users/{user_id}/medal-state | membership.medals.read；一致的版本与持有快照 |
| GET /admin/membership/users/{user_id}/medal-requests/{key} | membership.medals.read；原始 receipt |
| 已有勋章 grant/revoke POST | membership.medals.grant + CSRF；必填 expected_revision 与 idempotency_key |

两类流水默认 20、最大 50，created_at/id 倒序；cursor 必须存在且属于 URL UID。未知用户 404，存在但未初始化的数据按实际空值返回。五个新 UID 读取入口的非法路径遵循认证及 422 envelope，匿名先 401。所有新业务响应保持 envelope/header request_id 一致及 no-store；原始 OpenAPI 文档仅携带 header。新客户端严格检查请求号、UID、版本和 receipt；未扩大其他旧接口解析规则。

新增两对可回滚迁移，共 4 文件：202610060001_add_admin_experience_metadata 与 202610060002_add_medal_command_receipts。旧 EXP 账本元数据保持 NULL；不修改已应用迁移。SQLx 验证 down/up 保留原账本、勋章持有及审计。down 会丢弃新增元数据、勋章版本和独立 receipt，重新 up 不会恢复这些事实；回滚后不能继续承诺原命令的独立 receipt/版本语义。

## 最终验证

| 门禁 | 实际结果与可信证据 |
| --- | --- |
| 完整前端 | 125 文件 / 1205 通过，frontend-final.log |
| 收尾前端 | 用户组 31 通过、勋章 4 通过；review-green 3 文件 / 102 通过；定向用例与全量有重叠，不累计 |
| Rust workspace | 509 通过 / 1 ignored，rust-workspace-verified.log |
| 最终 Rust operations | 10 通过，rust-operations-final.log；全量之后新增 4 个用例，包含最终路径 envelope、并发、权限撤回、迁移及契约验证；不把重复定向数累加到全量 |
| TypeScript / E2E TypeScript / production build | PASS；最终 build 包含实际 tsc 检查 |
| Rust fmt / workspace all-targets clippy | PASS，clippy 使用 -D warnings |
| API wasm-plugins build | PASS；不代表 ignored WASM 用例已执行 |
| OpenAPI / generated / 实际服务契约 | 导出与生成检查通过，HTTP 200 / request-id header 存在，实际 schema 与导出一致 |
| 默认 E2E | FAIL：344 总计，90 通过 / 24 失败 / 230 跳过，0 flaky；e2e-results.json 与 e2e-final.log |
| 最终浏览器 | PASS：192 PNG / 192 布局检查；320/390/768/1024/1440 浅深主题，整页横向溢出 0 |
| axe / 键盘 / 交互 | 90 次扫描，WCAG 规则出现 0，heading-order 0；6 项键盘、13 项交互通过 |
| 来源一致性 | 最终浏览器所用 22 个生产/迁移文件 SHA 与交付源码一致，漂移 0；source-at-browser.json / source-drift-check.json |
| 范围 / 编码 / diff | 独立范围审计完成；最终 UTF-8 与 diff 检查见 encoding-check.json / diff-check.json |

前端全量早于最后的用户组标题语义修正及类型别名整理，收尾用户组 31 项和最终 TS/build 覆盖这些修改。Rust 全量早于最后的路径错误 envelope 与文档修正，最终 operations、fmt/clippy 覆盖修改。不声称在最后每一行修改之后再次运行所有全量用例。

E2E 失败集合按 project/file/line/column/title 对比，JSON file 按 config.rootDir=e2e 统一路径；与 M04 完全一致，新增/移除均为 0。公共配色 2、图片预览高度 4（900/876）、插件对比度 8（4.26/4.5）、/b/engineering 404 为 10。独立探子核对原始报告、日志与两阶段集合，归因及计数一致；230 个条件场景仍为跳过，整体 E2E 保留 FAIL。

默认 axe 仍有 skip-link 和共用对话框表单 aria-allowed-role 两类最佳实践提示：42 次规则出现、133 次节点出现，包含尺寸/主题重复。其中 skip-link 为 10/101，aria-allowed-role 为 32/32。不能写成全部 axe 无违规，也不能与 M01 六视图的 11 个登记节点直接相减。用户组标题层级在最终截图前修复；不扩展修改共用 ModalDialog。主代理抽查桌面浅色、手机深色分类及 EXP/勋章回执四张截图，布局可读，另有 192 次机器布局检查。

## 浏览器事实与保留记录

3 位真实用户的 UID/摘要绑定通过。对 demo_admin 执行实际 EXP +1、同原流水 -1，等级保持；实际勋章授予响应在服务端提交后被验证脚本中断，界面冻结并查询原 receipt 确认，然后真实撤销。每次运行结束核对原 EXP 余额、等级及勋章持有均已恢复。账本、审计及 revision 是真实操作事实，仍留在本地开发数据库，没有删除或伪造；本轮未写积分、用户组、权益或角色。

前两次浏览器运行因验证脚本过早观察异步摘要而结束，原业务事实已完成，分别核对并恢复原状态；保留 browser-attempt-1/2 日志及材料。脚本改为等待摘要后，browser-delivery 最终一次全部通过，192 张为该最终运行截图。此处不把脚本失败隐藏为产品通过，也不把前次截图累计入最终数。

## 独立核验与边界

三个领域探子核验 EXP、勋章及前端恢复，主代理裁决并修复实际问题：EXP CSRF 契约、勋章错误 header、EXP 未知状态联动写锁、新客户端请求号校验及 UID 路径 envelope。并发同键、目录删除后重放、编码 key、权限撤回、审计回滚、迁移 down/up 均有定向证据。另两个收尾探子独立核验范围/最终日志与原始 E2E，未发现范围遗漏或结果错误。详细裁决见 review-result.md。

浏览器刷新、直接地址栏跳转或整个管理路由卸载没有持久化命令恢复；当前未知锁与同键核实在已挂载工作区内成立。权限撤回后服务端仍拒绝重放。固定 UID 组件继续在 keyed 宿主中使用，不宣称任意独立 rerender 可迁移未确认命令。

非零/最高等级、真实分页边界、409、无权、权限撤回与完整并发矩阵主要由行为/SQLx 测试覆盖，没有宣称都在真实浏览器执行。未执行 1920、八角色矩阵、读屏软件、被忽略的 WASM 测试及 230 个条件 E2E；这些保持明确边界。

账号状态最终拒绝；社区组/权益仅提供普通能力，治理来自 Role/Assignment；EXP 与积分独立，勋章不授予权限。聚合和目录仍为独立领域读取，不承诺跨域原子快照。复用动态成长与最新勋章目录，不加入旧论坛兼容层。

## 工作区与关闭

相对阶段开始前快照，22 个生产/迁移文件、11 个测试文件及 3 个交接文档发生变化。无新增依赖，无公共主题样式改动。source-changes.json 列出逐文件哈希，production-diff.patch / test-diff.patch 保存相对阶段基线的差异；采集范围之外的既有脚本/素材不冒充本阶段新增。

HEAD：06bfa627b264b72aebd28f1e06447be08ea1b25a；分支 codex/daoyun-home-foundation。全部既有 dirty 文件保留，无 commit/reset/stash/worktree/PR/发布；test-results 和 dist 为忽略输出，不提交构建、截图或秘密。

本轮 API/gateway 已核对 PID、启动时间及命令行后停止，3000/5173 无监听；PostgreSQL 127.0.0.1:55433 / PID 34960 保留。详情见 service-stop.json。最终 closeout.json 标记 M05 DONE / PAUSED，M06 未开始。

## 下一阶段

仅用户继续后启动 M06：权益/兑换及原子续期。先读取最新基础规范、本结果与当时工作区，制定 M06 验收并补失败行为测试。M07 为角色/版块权限/治理来源与两层解释，M08 为最终二十项验收、八角色及 1920。M05 不代替整体完工验收。

官方依据：[Axum 0.8.9 Query](https://docs.rs/axum/0.8.9/axum/extract/struct.Query.html)、[PostgreSQL 16 行锁](https://www.postgresql.org/docs/16/explicit-locking.html)、[React useEffect](https://react.dev/reference/react/useEffect)。SQLx 0.9.0 官方在线页不可访问，使用本机同版本官方源码核对事务接口。
