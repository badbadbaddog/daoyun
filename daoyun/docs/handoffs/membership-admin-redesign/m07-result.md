# M07 结果：角色、版块权限与权限解释

状态：DONE，2026-10-07 已完成并暂停；M01–M07 DONE，M08 未开始，整体重构 NOT DONE。按用户已确认的 [m07-plan.md](m07-plan.md) 实施。当前交接：[current.md](current.md)。证据：test-results/membership-admin-redesign/M07。

## 完成行为与领域边界

保留五项普通能力检查，增加 moderation_browse、topic_pin、topic_feature、topic_lock、topic_move 五项治理只读诊断。治理查看严格对应现有 moderation.topic 的已发布、未删除主题查询条件：版块未删除，作者正常或受限；隐藏版块不等于隐藏状态主题。没有承诺读取待审、隐藏状态或已删除主题，没有增加隐藏内容能力。

治理仅来自当前角色任命，复用原权限谓词与 daoyun_board_scope_covers；instance/site/board、exact/subtree 按当前版块树判断。置顶、精华、锁定、移动使用各自独立的 permission key。移动须提供不同的目标版块，两端都须为公开、未删除版块且角色范围覆盖两端；不追加真实写端没有的策略或生命周期规则。缺少主题/移动目标返回 missing_context；纯用户组治理行不适用。普通能力和额度仍由组/权益提供，角色普通键不会进入社区动作授权，账号最终拒绝优先。

诊断在 READ ONLY / REPEATABLE READ 中读取，不写审计、额度、积分、EXP、任命或资源。共享谓词的只读调用不加写锁，真实写调用仍保留账号、任命、角色、权限共享锁及祖先 key 锁；真实操作继续复核权限、状态、范围及 revision。

来源包含真实账号状态、基础/附加组身份、权益原快照版本、角色任命 ID/角色修订/permission keys/scope/scope_mode/两端覆盖情况/授予人/系统保护/任命时刻。角色为真实长期任命，不编造期限、启停状态或权益快照版本。所有有效组、权益和全部任命合计上限 128，超过则拒绝，不能截断伪装完整。127/128/129 混合边界、类型停用但有效授予保留、过期/撤销来源排除已验证；128 夹具为基础组1+有效权益2+角色125（124自建+1注册默认）。

指定用户矩阵与检查需要原七项读取能力加 authorization.roles.read；纯用户组矩阵保留两项原读取门槛。DTO/OpenAPI/generated、request_id envelope/header 和 no-store 一致。前端严格校验十项动作、来源种类与跨域 ID、全部额度和角色元数据，不自行计算 ACL。

## 页面与恢复行为

检查与来源弹窗共用六层解释：账号 → 基础组 → 附加组 → 标准权益 → 治理任命 → 资源条件。技术详情默认折叠，展示原因码、来源 ID、权限键、角色/策略/主题修订及 scope。普通额度使用共用中文格式；治理人话层不展示社区额度。未知原因保留需核对状态，不声称允许。

角色页保留系统角色只读、授权上限、受保护任命、revision 冲突和高风险确认，说明实际作用域及长期任命。版块策略中的治理主体只是访问条件，不提供治理动作。角色读取撤回立即遮蔽目录、编辑草稿与角色确认，并清空草稿；任命入口同时依赖角色读取。原任命撤销保持独立的既有写权限。矩阵旧请求与当前 key 不匹配即隐藏，新增断言验证指定用户与结果表同时消失。

只读系统角色权限清单增加有名称、可聚焦的 region，解决所有复选框禁用时无法用键盘滚动的问题。完整前端回归还复现了正文编辑器延迟 RAF 抢走标题焦点：新增确定性失败测试后保护已聚焦的外部输入，保留默认正文自动聚焦与一次性聚焦行为。首页 Ctrl+K 测试等待原有微任务焦点稳定，未修改首页或导航实现。没有新增依赖、迁移或任命期限机制；CSS 只使用既有语义 token。

## 实际验证

| 项目 | 最终结果 |
| --- | --- |
| 完整前端 | 128 文件 / 1251 通过；最终编辑器与发帖组件66项定向包含在全量，不叠加计数 |
| Rust workspace | 531 通过 / 1 ignored；新增 SQLx治理4项与API1项包含在全量 |
| TS / E2E TS / production build | PASS；最终源码先类型检查，再 Vite production build |
| Rust fmt / clippy | PASS；workspace/all-targets/-D warnings |
| OpenAPI / generated / 实际 API | PASS；实际 schema 与导出相同，十项动作与目标参数一致，请求号匹配 |
| API wasm-plugins build | PASS；完整默认特性测试后重新构建所需本地运行特性 |
| 默认 E2E | FAIL：344 总计，90通过 / 24既有失败 / 230跳过，0 flaky；与M06失败集合完全一致 |
| 真实浏览器 | PASS：72 PNG / 72布局检查，320/768/1024/1440 浅深主题，无整页横向溢出 |
| axe / 键盘 / 交互 | 40扫描，全部已扫描规则0违规，WCAG0/heading-order0；6键盘、7记录交互通过 |
| 来源 / 编码 / 差异 | PASS；751源码/配置与浏览器版本一致、漂移0；变更UTF-8；16生产、12测试、4交接文档 |

E2E既有失败保留 FAIL：配色2、图片高度4、插件对比度8、/b/engineering 404为10；按项目、文件、行列及完整标题与M06实际报告比较，无新增/减少失败。230 skipped 和1 Rust ignored不计通过，没有改跳过条件或默认测试集合。

浏览器实测角色目录、系统只读角色、长期任命、版块访问条件、十行矩阵、角色来源、治理资源缺失、移动双端与技术详情；另核对管理员治理四动作、普通会员无治理、GET失败旧结果隐藏/重试。两端移动分别在浅深主题执行允许断言。键盘检查涵盖只读权限区域Tab/滚动、来源Escape回焦、技术详情Enter开关，各两主题。管理业务写入0，角色/任命、会员领域及主题事实前后相同。原始快照保留，比较明确排除访问带来的 account.last_seen_at 与 topic.view_count；没有创建业务夹具。

浏览器预期控制台返回保留：访客session401、空版块策略两次content.access_policy_not_found404、刻意中断一次permission-check GET；404按具体接口、错误码和console location核实。无页面异常或其他控制台错误。只记录导航时长，未采集长任务，不宣称性能阈值验收。

## 失败证据与独立核验

前端、后端、浏览器入口与聚焦/启动问题均有一次性只读探子核验，最终点验、修改与验证由主线程完成。后端初次复核为partial，所涉权限路径由主线程点验并通过实际SQLx/API与全量回归；没有把通用管理查询误作普通动作入口，也没有新增第二套ACL。

首次并发内存耗尽、进程通道/验证会话中断、128夹具遗漏默认任命、数据库尚未就绪的PoolTimedOut、首次clippy宏解析异常和后续成功检查日志全部保留；不计通过。数据库从同一PostgreSQL16目录恢复，未初始化新业务库。workspace默认特性测试覆盖API程序造成InvalidConfiguration，经定位特性/配置条件后重建wasm-plugins并完成实际服务验证，无生产配置修改。

browser-attempt-1保留24截图及只读清单键盘问题/脚本动作路径错误；browser-attempt-2保留72截图及预期404/性能探针警告。最终browser-final-verified完整通过，截图不把失败轮次叠加。确定性聚焦红测、所有定向复跑与完整通过分别保留。停止服务第一次归属检查混淆wrapper/child编号，在任何停止操作前取消，按实际进程记录纠正后复核PID/命令/创建时刻再停止。

## 范围与续接

HEAD 06bfa627b264b72aebd28f1e06447be08ea1b25a，分支codex/daoyun-home-foundation；既有dirty、数据库和历史证据保留。source-before.json逐文件原字节/哈希为M07起点，source-changes.json及production-diff.patch/test-diff.patch/documentation-diff.patch只描述本阶段，不使用HEAD差异冒充M07。无commit/reset/stash/worktree/PR/发布；dist/test-results为忽略输出。

临时API与gateway已停止，3000/5173无监听。PostgreSQL 127.0.0.1:55433 / PID10140保留；数据目录C:/Users/111/AppData/Local/DaoYun/postgresql-16，版本16。原PID23140在验证会话中断时结束，本阶段恢复同一目录，未替换数据库。

未执行1920、八角色最终矩阵、读屏软件或230项条件E2E；M08负责最终二十项与完整矩阵，本阶段暂停，不自动进入M08。诊断是检查时刻快照，不能替代真实提交鉴权或承诺未来结果；治理查看范围仍是现有已发布主题规则。

证据入口：gates.json、verification.json、browser-summary.json、screenshot-manifest.json、browser-accessibility-summary.json、browser-network-summary.json、browser-fixture-baseline.json/browser-fixture-final.json、e2e-results.json/e2e-summary.json、review-result.md、source-at-browser.json/source-drift-check.json、source-changes.json、encoding-check.json、diff-check.json、service-stop.json/database-retained.json、closeout.json。
