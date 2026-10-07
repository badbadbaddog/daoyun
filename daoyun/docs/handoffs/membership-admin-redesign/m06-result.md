# M06：会员权益、兑换商品与原子续期完成记录

状态：DONE；2026-10-07。用户已确认 m06-plan.md 并要求实施，本阶段实际完成后已暂停，未进入 M07/M08。整体重构 NOT DONE。

## 行为与业务边界

会员权益新增原子续期。仅未撤销且尚未到期的有限期权益可延长，待生效的有限期权益也可延长；永久、到期、撤销记录显示真实不可续期原因。新到期时间严格晚于原期限，过期权益需重新发放。保留开始时间、原类型版本、权限/额度快照、来源、原授予原因与授予人，不扣积分、不改 EXP，不产生治理能力。

新 receipt 追加保存 UID、目标、actor、原 revision/到期时间、新期限、原因、key、结果 revision、审计号、原请求号、创建时间及快照。响应区分不可变原回执、当前权益与 replayed；之后再次续期或撤销，旧命令重放仍返回原回执与最新状态。UID/key 为作用域，actor/目标/revision/原因/规范化时间相同才重放；本次 HTTP request_id 可以变化，原 receipt.request_id 不变。

事务使用目标 UID 协调锁和权益行锁，锁后复核权限、revision、撤销状态和 clock_timestamp() 的实际时间；既有权限引擎同时持有 SHARE 锁到提交，权限撤回与写入按数据库锁序列化。更新、审计、回执和两条 outbox 同事务。新增事件 standard_entitlement.renewed 与 entitlement.changed，去重 key 包含操作/UID/原 key。审计或第二条 outbox 失败全部回滚。

## 契约与迁移

新增两条 API：

- POST /api/v1/admin/entitlements/{entitlement_id}/renew：entitlements.grants.write、Cookie/CSRF、现有近期认证；必须核对 URL 目标属于请求 UID。
- GET /api/v1/admin/entitlements/users/{user_id}/renewal-requests/{key}：entitlements.grants.read，按 UID/key 查询。404 只表示尚未找到，客户端继续保留原命令。

公开 DTO 位于 crates/api-contract；OpenAPI 路由、响应和生成类型同步。成功响应 no-store，HTTP envelope/header 使用本次同一 request_id，receipt 保存原请求号。客户端拒绝缺失/不一致请求号、不同目标/命令和与原回执矛盾的当前投影；错误或 malformed 响应仍按未知结果处理。

新增一对 202610070001_add_entitlement_renewals 迁移，共 2 文件。granted_ends_at 保存原授予期限，初次回填采用现存真实 ends_at；数据库 INSERT trigger 覆盖管理员、插件与积分兑换等所有生产入口，UPDATE 不可改写该元数据。grant replay 改为比较原授予期限和 granted_by，续期后原 grant 重放不会缩短期限或误冲突。receipt 禁止 UPDATE/DELETE，没有用可变权益行冒充原命令回执。

down 保留原权益行、实际延长后的 ends_at、audit/outbox，但丢弃原授予期限元数据与续期 receipt；重新 up 只能以当时实际期限初始化，无法恢复已删除的原命令事实。回滚不撤销已完成续期，也不承诺旧 grant/renew key 在元数据丢失后继续按原命令恢复。真实本地业务库不执行 down/up；只在 SQLx 隔离数据库验证。

锁和当前时间依据 PostgreSQL 的[行锁文档](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS)；客户端迟到读取保护沿用 React 的[Effect 清理规则](https://react.dev/reference/react/useEffect#fetching-data-with-effects)。没有新增依赖或兼容旧论坛代码。

## 固定 UID、目录与恢复

当前 UID 用户详情和会员权益工作区共用续期动作。弹窗展示原期限/版本/快照，成功显示原回执并刷新当前权益及会员摘要。普通能力和额度使用中文标签；管理作用域统一“会员权益”。版块治理选择器和成员中心既有文案留给所属后续范围。

续期请求中禁止重复提交、关闭、切 UID 及同详情其他领域写入；未知结果冻结日期、原因、revision 和 key，可读取原 receipt 或完全相同命令重试。404、读取失败、权限拒绝及后续重试的 4xx 不证明首次未成功。旧显示期限在等待期间到期仍可重试原命令，由后端原 receipt 判定。409 保留日期/原因，显式读取当前目标，更新 revision 后生成新命令。回执找到而当前投影滞后或矛盾时继续冻结。

类型发布增加权限撤回和续期写锁的入口校验；类型读取权限撤回清空并遮蔽目录/历史，拒绝迟到冲突刷新。既有未知撤销弹窗本来已有 busy 关闭保护，本阶段补齐其他触发按钮的命令锁；没有把先前定位中的“可关闭后丢恢复入口”误推断当作事实。

兑换商品 409 通过已有分页目录读取原目标，保留名称、价格、期限、限额、上下架与权益选择，只更新 revision；读取失败不解除冲突。分页核实设置 100 页上限并拒绝重复 cursor，未找到时保留原草稿。

未知商品 PUT 保留原 UUID/输入/expected_revision，冻结关闭和字段，同 UUID/原输入重试；后续 409 仍未知。已有 API 不提供原保存 receipt，因此仅展示当前商品事实。读到更高已落库 revision 后，管理员显式采用该版本才解除冻结，继续编辑原 UUID，不声称已证明原保存成功。保存响应校验原目标、结果 revision 和规范化输入；读取权限撤回不能继续提交商品草稿。

目录显示真实价格、时长、上限、上下架、商品/权益版本和权限/额度快照。插件停用说明保留历史与已获得有效权益；既有兑换事务、不可变兑换历史、积分消费语义不变，没有新增管理员全站订单 API，也没有把兑换改成付费续期。

## 最终实际验收

| 项目 | 结果 |
| --- | --- |
| 前端交付全量 | 127 文件 / 1239 项通过 |
| TS / E2E TS / 生产构建 / generated | PASS，当前交付源码 |
| 续期事务定向 | 11 项通过；并发、锁后实际时间、权限序列化、两类失败回滚、不可变元数据、down/up |
| 续期 API 定向 | 2 项通过；已进入当前完整回归 |
| 升级不变量 | 修正后的 1 项通过，保留全部旧业务字段并单独验证有限/永久回填和空 receipt |
| Rust 完整回归 / fmt / clippy / wasm build | PASS；workspace 526 通过 / 1 ignored，fmt --check、clippy workspace/all-targets/-D warnings、API wasm-plugins 构建通过 |
| 真实服务 / OpenAPI | PASS；实际 /api/v1/openapi.json 与本轮导出相同，header request_id 有效 |
| 最终真实浏览器 | PASS；68 张 PNG / 68 次布局检查，五宽度浅深主题、无横向溢出；32 次 axe 扫描 WCAG 0 / heading-order 0，3 项键盘 / 3 项真实恢复与冲突流程 |
| 最终默认 E2E | FAIL；344 总计，90 通过 / 24 既有失败 / 230 跳过，0 flaky；与 M05 失败集合完全一致，无新增失败 |
| UTF-8 / diff / 源码一致性 | PASS；14 个生产/迁移文件、8 个测试文件、3 个交接文档；748 个源码/配置哈希与最终浏览器相同，漂移 0 |
| 临时服务 / 数据库 | API PID 27292、gateway PID 22324 已核实归属并停止，3000/5173 无监听；既有 PostgreSQL 55433 / PID 23140 保留 |
| 独立只读核验 | 后端、前端与浏览器入口三份核验已返回；主代理完成修正与增量验证 |

不得叠加重复定向用例到全量计数。默认 E2E 已按 project/file/line/column/title 对照 M05 的原始报告，24 项失败集合完全一致：配色 2、图片高度 4、插件对比度 8、/b/engineering 404 为 10。既有 FAIL、230 skipped 和 1 Rust ignored 保留原状态。

最后文案修正后重新执行全量前端、TS/E2E TS/build/generated、默认 E2E 及真实浏览器；Rust 最终全量和严格检查晚于最后 Rust 源码变更，后续只修改前端展示及相应断言，没有重复执行不受影响的 Rust 检查。门禁包装器和各子进程的真实开始/退出时间保存在对应 process/exit.json，gates.json 引用最终轮次。

axe 仍有 aria-allowed-role 最佳实践提示：8 次规则 / 8 次节点，含尺寸/主题重复；不能声称全部无违规。PNG 是 960px 高视口截图；类型历史和原回执显式滚动到可见位置，其他长内容不冒充整页全量截图。

真实浏览器使用 demo_member 固定 UID：发布类型 v1、授予临时有限期权益、发布 v2 后确认续期仍沿用 v1 原快照，续期响应提交后丢失再核实原 receipt；竞争续期 409 保留日期/原因，刷新后提交。商品响应丢失后同 UUID/原输入重试仍未确认，读取当前 revision 后明确采用；竞争商品变更后保留本地草稿再保存至 revision 4。EXP 草稿仅用于验证跨领域写锁，没有提交 EXP/积分。

每轮 finally 均恢复兑换插件原停用状态，并在撤销前核对未撤销、未来到期权益仍保留；随后撤销临时权益，比较原 EXP、积分和其他权益。最终只读数据库清点保存 7 个临时类型、6 条已撤销权益、4 个未上架商品、13 条真实续期回执，审计/revision 同样保留；不删除事实，不把重复验收写入计作更多测试通过数。

## 失败证据与修正

最初新增事务测试因实现不存在而编译失败；新增 API 路径/OpenAPI 和前端恢复测试均保存实际红灯。数据库初轮 PoolTimedOut 后恢复原保留数据目录，没有新建空业务库替代。API RequestId 私有字段编译错误已改为公开转换；busy 回调时序、旧显示期限过期阻止原重试、回执/当前投影矛盾、权限撤回后迟到读取及商品目标/版本关联均有失败用例和修正。

人工复核首轮通过的浏览器截图发现，类型版本历史/权益记录仍使用原始能力键和额度值；补充失败断言后复用共用中文标签和额度格式，26 项定向、前端 1239 项全量及当前 TS/build/generated 通过。原截图与失败用例保存，最终浏览器重新验证当前构建。

首轮完整 Rust 在 v3_upgrade_invariants 失败：整行 to_jsonb 比较包含新增 granted_ends_at。修正只从旧业务快照排除新增元数据，并独立断言有限/永久期限正确回填、没有伪造 renewal receipt；原 ID/revision/时间戳、余额/流水、授予与授权逐项不变量继续比较。严格检查同时发现同步键校验返回大型 ApiError，改为布尔校验，未添加 lint 豁免。

权限撤回等待测试最初由主测试持用户锁并等待权限删除，形成测试自身等待环；权限引擎的 SHARE 锁本来会阻止删除直到续期提交。保留失败日志，改为验证撤回确实等待、写入提交后撤回完成、下一次重放 Forbidden。仅取消已确认的隔离测试查询，没有停止或清空数据库。

门禁包装器原本只保存 child 退出码，未向自身传递失败；本阶段修正退出码传递。验收依据每个实际子检查的 exit.json 和日志，不以父包装器 0 代替通过。所有中间失败日志保留。

浏览器前四次中断分别由结束时间 aria-label、嵌套 select 标签精确匹配、跨领域锁使 EXP 表单隐藏、采用已落库版本后弹窗从“新增”改为“编辑”的脚本定位造成；均已修正验收脚本并保存 browser-attempt-* 材料，没有据此改动正常产品行为。首轮通过截图的类型历史/原回执落在屏幕下方，后续显式滚动并重新保存最终可见截图；最后截图人工复核记录见 browser-visual-review.json。

## 暂存边界与交接

M06 已完成并暂停，M07/M08 未进入。未执行 1920、八角色矩阵、读屏软件或完整条件 live E2E。浏览器刷新、直接地址栏跳转及整个管理路由卸载没有持久恢复；页面内冻结不代表全应用持久命令保护。

HEAD 及分支保留；所有既有 dirty 修改保留，没有 worktree、commit、reset、stash、PR 或发布。读取/写入 UTF-8；本阶段不修改公共主题或依赖。test-results、dist 是忽略输出，保存源码 SHA、实际日志/请求/截图、审查与服务归属证据，不提交构建或秘密。

证据目录：test-results/membership-admin-redesign/M06。最终以 gates.json、browser-summary.json、screenshot-manifest.json、e2e-summary.json、source-changes.json、source-drift-check.json、review-result.md、fixture-inventory.json、service-stop.json、closeout.json 为准。
