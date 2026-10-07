# M08 用户 / 会员 / 权限后台最终验收

状态：**DONE**。M01–M08 均 DONE，本轮重构整体 DONE。完成日期：2026-10-07（Asia/Shanghai）。未提交、未发布。

## 授权与范围

采用用户原始 M01–M08 规格及继续指令。M08 不增加大型功能，完成二十项、八类角色、六种宽度、权限边界和现有质量门槛。原始请求及可追溯来源保存于 test-results/membership-admin-redesign/M08/original-user-request.md、original-request-provenance.json；此前旧任务阶段编号不替代本轮范围。

本阶段使用同一工作区与原 PostgreSQL daoyun_dev；没有重置业务库、替换账号或通过导入旧中断稿替代实现。M01–M07 的实现及 dirty 修改完整保留。

## 最终质量门槛

| 项目 | 实际结果 | 最终证据 job / 文件 |
| --- | --- | --- |
| 完整前端测试 | 128 文件、1251 通过、0 失败 | frontend-workspace-verified |
| TypeScript / E2E TypeScript | PASS | typecheck-final / e2e-typecheck-closeout |
| 生产构建 | PASS | production-build-final |
| 完整 Rust workspace | 532 通过、0 失败、1 ignored；81 个结果汇总 | rust-workspace-points-fixed / rust-summary-final.json |
| Rust fmt / clippy | PASS；workspace/all-targets/-D warnings | rust-fmt-final / rust-clippy-final |
| 实际 API wasm 构建 | PASS；运行独立程序副本避免测试重建覆盖 | api-build-points-fixed-wasm / api-binary-final.json |
| API generate/check | PASS；生成原字节一致 | api-generated-check-final / api-generate-final-proof |
| OpenAPI / 实际服务 | 186 paths；实际 JSON 与导出一致，raw 文档仅带 x-request-id | export-openapi-final / contract-proof-final.json |
| 最终完整默认 E2E | 344 总计：114 通过、0 失败、230 skipped、0 flaky | e2e-default-closeout-results.json |
| 最终真实浏览器 | 20 项、8 类账号、6 宽度；290 PNG | views-summary.json / roles-summary.json |
| 布局 / WCAG / 键盘 | 288 次布局检查无整页横向溢出；96 次 WCAG 标签扫描违规 0；2 项键盘通过 | views-layout.json / roles-layout.json / views-axe.json / roles-axe.json / views-keyboard.json |
| 数据收尾 / 版本一致 | 原会员业务事实不变，临时角色清理完成；751 个源码/配置漂移 0 | database-fixtures-final.json / source-consistency-final.json |

完整前端测试在局部样式修复后执行。随后积分 API 修复使生成文件仅增加 amount 的说明注释，TypeScript 的 number 形状不变；最终 typecheck、build、E2E、真实浏览器和契约检查使用最终生成版本。完整 Rust 在积分修复后重新执行，定向的 1 项通过已计入 532，不重复叠加。

所有最终任务真实退出码为 0，时间和完整命令见各 .process.json、.exit.json；十五项通过记录见 gates-final.json。被中断、命令参数错误或夹具脚本失败的早期任务保留原结果，不能计作最终通过。

## 二十项真实浏览器验收

全部使用真实 gateway 5173、实际 API 3000 和原数据库；Chromium 登录后操作现有页面/编辑入口。每项都覆盖 320、390、768、1024、1440、1920，并各跑浅色/深色，共 240 张截图及布局检查。截图命名为下表前缀-width-theme.png，完整映射见 views-screenshots.json。

| # | 验收项 | 截图前缀 | 结果 |
| --- | --- | --- | --- |
| 1 | 后台首页 | 01-dashboard | PASS |
| 2 | 用户列表 | 02-users | PASS |
| 3 | 用户详情 | 03-user-detail | PASS |
| 4 | 用户组 | 04-groups | PASS |
| 5 | 用户组编辑 | 05-group-editor | PASS |
| 6 | 成长等级 | 06-levels | PASS |
| 7 | 等级编辑 | 07-level-editor | PASS |
| 8 | EXP | 08-experience | PASS |
| 9 | 积分 | 09-points | PASS |
| 10 | 积分发放 | 10-points-grant | PASS |
| 11 | 勋章 | 11-medals | PASS |
| 12 | 勋章编辑 | 12-medal-editor | PASS |
| 13 | 会员权益 | 13-entitlements | PASS |
| 14 | 权益编辑 | 14-entitlement-editor | PASS |
| 15 | 兑换 | 15-redemptions | PASS |
| 16 | 角色与权限 | 16-roles | PASS |
| 17 | 角色编辑 | 17-role-editor | PASS |
| 18 | 版块权限 | 18-board-permissions | PASS |
| 19 | 权限检查 | 19-permission-check | PASS |
| 20 | 权限检查详情 | 20-check-detail | PASS |

这一组页面检查没有提交领域业务写入：编辑器使用现有对象或新版本草稿，不把打开表单当成保存成功。实际写入行为由前阶段和本次全量 API/SQLx 测试验证；本阶段另有下面的真实积分增减操作。20 项产生 80 次 WCAG 标签扫描，涵盖 320/1920、浅深主题；实际箭头键切换、Enter 打开编辑和 Escape 退出共 2 项。views-errors.json 无浏览器错误记录，版本化业务请求的 envelope/header 请求号一致。

## 八类账号与服务端边界

八类账号均实际登录、读取入口，并检查六种宽度，共 48 张账号截图、48 次布局检查、16 次 WCAG 扫描。另保存真实积分增加/扣减回执 2 张，总数为 240 + 48 + 2 = **290**。角色矩阵、逐项 permission keys、scope、用户 ID 和截图文件见 roles-matrix.json、roles-screenshots.json。

| 角色 | 验收配置 | 可见模块数 | 结果 |
| --- | --- | --- | --- |
| 超级管理员 | 原 demo_admin / super_admin | 17 | PASS |
| 用户管理员 | 用户读取/状态管理、角色读取和任命读写；instance | 3 | PASS |
| 会员运营 | 用户读取、组/等级/勋章/权益/兑换现有运营权限；instance | 3 | PASS |
| 积分运营 | 用户读取 + membership.points.grant；instance | 3 | PASS |
| 内容审核 | moderation.topic + 举报读取/处理；instance | 5 | PASS |
| 版主 | 六项版块治理权限；general 版块 exact | 4 | PASS |
| 只读运营 | 现有用户/配置/审计/会员/权限/运维/插件等读取；instance | 12 | PASS |
| 普通用户 | 原 demo_member / member，无后台能力 | 0 | PASS |

中间六类是受控验收配置，不新增生产预设角色政策。所有 permission keys 都以实际目录核对，不过滤掉非法 key 后假装角色创建成功。每个账号逐项检查用户、用户组、等级、勋章规则、权益类型、角色、版块及积分流水读取；无能力的独立资源读取返回 403。完整有效的角色创建命令只有超级管理员成功，其余七类返回 403；成功的探测角色立即删除。

无权会员字段返回 null；积分运营用户详情的成长字段显示“无权查看”，不能填 0/默认身份；只读运营没有积分入口，因为现有目录没有独立积分只读能力，不以写权限伪造只读身份。只读写入口缺失或禁用，服务端仍独立鉴权。

治理列表采用按资源过滤的既有契约：缺少治理权限的账号可得到 200 空集合，不能仅以 HTTP 200 推断获准。八类账号对同一真实 general 主题的 moderation_browse 诊断与实际列表中该主题可见性逐一一致；超级管理员、内容审核、版主可见，其余五类不可见。roles-requests.json 保存 223 次业务/认证请求记录，其 envelope/header 请求号全部一致；真实浏览器积分 POST +1、-1 都为 200，余额 0 → 1 → 0。

## 领域边界证据

浏览器 roles-boundary.json 的 17 个检查全部通过，包括八类治理诊断/资源比较、无权字段、积分操作、restricted 和 suspended。以下数据库/API 行为测试在最终完整 Rust 日志中逐项确有 test ... ok，详见 domain-boundaries-final.json。

| 领域边界 | 实际证据 |
| --- | --- |
| suspended 最终拒绝 | 临时账号停用后旧会话真实读取 401，browse 诊断 account.inactive；community_permissions.rs:99 账户权限/额度为空；permission_matrix.rs:199 治理最终拒绝 |
| restricted 覆盖普通允许 | 临时账号仍有普通来源 permission_provided=true，但 topic_create 为 account.restricted；community_permissions.rs:99 阻断普通写入而保留读取；治理不误套普通限制 |
| 到期组不生效 | community_groups.rs:245 历史到期 partner 组不进入 active，仅 registered_member；本次 Rust 日志确实通过 |
| 到期/撤销权益不生效 | standard_entitlements.rs:11 到期边界及撤销后 active 权益为空 |
| 积分不改 EXP | 实际 +1/-1，EXP 账户未变；admin_membership_operations.rs:120 验证扣减、重放、透支、越界、权限撤回及 EXP/revision/current level 不变 |
| 等级不授予治理 | 成长 DTO 只有 EXP/等级展示字段，没有权限字段；authorization.rs:908-944 共用治理谓词只读取 Role/Assignment；真实 Lv1 普通用户 topic_pin denied；permission_matrix.rs:78 验证 ordinary 来源不进入治理 |
| 权益不授予治理 | standard_entitlements.rs:11 创建含 moderation.topic.pin 的权益返回 InvalidBenefits；共用治理谓词不读取权益 |
| exact/subtree 随真实树变化 | permission_matrix.rs:78 exact 不覆盖子版块、subtree 覆盖、重挂载立即撤回；诊断与同一 has_permission 谓词一致 |
| 诊断与真实请求一致且无写副作用 | 八类浏览器实际资源比较；permission_matrix.rs:199 验证移动两端权限、检查不写业务、撤回任命后真正 govern_topic 返回 Forbidden |

没有在真实业务库反复调整原用户 EXP、重挂载原版块或制造到期权益冒充浏览器全矩阵。到期、重挂载、并发与回滚边界明确归于真实 SQLx/API 行为验证；本阶段未单独执行高 EXP 账号的浏览器写入矩阵。

## 本阶段局部修复

1. 图片预览在移动端被后面的通用键盘 dialog 高度规则挤去 24px。增加仅匹配图片预览的高度规则，继续使用实际可见视口变量；其他 dialog 规则保持原行为。
2. 选中插件列表项的小字对比度不足。采用已有 text-soft 语义 token，仅调整选中条目，不降低 WCAG 阈值。
3. responsive E2E 的两个配色预期仍是旧值。对齐 M01 之前已接受的设计 token #f5f7fb / #18243b，其余 token 和控件状态断言保留。
4. 插件 E2E 后续旧“官方插件”流程在对比度通过后暴露过期。对齐当前“内置模块”及安装向导，实际选择能力、上传、确认安装，并断言提交能力/组件字节、CSRF/revision 与安装状态。能力目录响应保持 coherent mock。空 Component 字节只用于 UI route mock，不能证明真实 WIT/宿主安装有效；真实宿主仍由 Rust 合约/runtime 测试验证。
5. 真正积分扣减原来返回 422：界面支持扣减、底层账本支持 signed amount，但管理 HTTP 入口只接受正数。先新增失败行为测试复现，再将该入口改为 [-1000000,1000000] 的非零整数，DTO/OpenAPI/generated 同步。既有行锁、余额下限、checked_add、幂等回执、权限复核、累计积分和审计事务全部复用，不改 EXP。

±1000000 是既有管理 HTTP 的单次输入上限，未把它扩展成插件/内部账本的全局策略。OpenAPI min/max 为机器边界，amount 的公开说明明确非零；零值由运行时验证，测试确认 422。没有引入新权限、依赖、公共接口或迁移。

M07 的 24 例 E2E 失败中，14 例在项目既定 preview 环境真实复现并修复；另 10 例 /b/engineering 的旧失败来自 gateway SSR 查询真实库与 route mock 的不一致，默认 mock E2E 使用项目配置的 Vite preview 4173 后通过。实际服务安全检查仍访问 API 3000，全部真实管理页面仍在 gateway 5173 验证。没有添加工程版块假数据或修改 SSR 来掩盖失败，没有新增 skip。

## 独立核验与版本核对

只读子代理分别核验 Rust/DTO/测试、CSS/E2E、领域边界；主代理复读即将修改的代码并核实关键出处。结论与取舍见 independent-review-final.json。关于插件金额上限的建议属于原有独立策略，本阶段不改变；关于“零值”的校验已在接口说明及运行时测试明确。探子漏报的组到期测试 PASS 由主代理在最终日志找回。

主代理实际查看 7 张选定 PNG：320 深色用户组编辑、320 浅色等级编辑、320 深色权限详情、1920 只读账号、真实积分增加与扣减、320 积分运营账号。没有将 7 张人工查看说成 290 张全部人工检查。visual-review-final.json 记录具体文件及 SHA。

751 个源码/配置文件在最终浏览器和 E2E 后再次核对哈希，漂移 0。交接文档在冻结后完成，另列文件；逐文件 UTF-8 及 diff 检查通过。source-before.json、before/ 原字节与 source-after.json、source-changes.json、production-diff.patch、tests-diff.patch、documentation-diff.patch 可以独立复核阶段范围，不用整个 dirty Git diff 冒充 M08。

## 数据库与临时服务

使用 PostgreSQL 16、127.0.0.1:55433、daoyun_dev，原数据目录 C:/Users/111/AppData/Local/DaoYun/postgresql-16、PID 10140 保留并确认 ready。公开注册因现有邮件验证策略拒绝，没有关掉全局邮件验证；中间六类账号以本地受控夹具创建，只有原 salted hash 被复用，不记录或导出凭据。最终六个有效账号按真实注册的初始化约定补建积分账户。

前两次探索夹具共留下 12 个测试账号：全部 suspended、任命 0、临时角色 0。首批 6 个未初始化积分账户，未使用其冒充最终有效角色；后批 6 个积分余额均 0。真正积分测试对象累计积分及 4 条不可变流水/审计保留，不重置或删除历史；这些测试账号不能删除的事实在 database-fixtures-final.json 逐项记录。原 demo_member 的账号/组/EXP/积分/勋章/权益业务快照与最早 M08 快照一致，仅排除实际登录活跃时间 last_seen_at；demo_admin 仍 active。

验收临时 API 3000、gateway 5173、preview 4173 已按实际 PID、程序路径、命令和创建时刻核对后停止。service-state-final.json 确认这三个端口无监听，只保留原 PostgreSQL 55433。默认 Rust 测试会覆盖 target/debug API 程序，恢复本地 wasm 服务时须重新 build --features wasm-plugins 或使用已验证的独立副本。

## 未执行与已知限制

- 默认 230 条条件 E2E 没有启用各自外部夹具；全部保持 skipped，不能计作通过。本次自建真实 20 页/8 类账号矩阵独立完成，不能说原 230 条都已执行。
- Rust 1 项 ignored：official_growth_component_instantiates_with_only_bounded_wasi_cli_imports，需要另行构建 wasm32-wasip2 官方插件；未执行，不计通过。
- 未运行实际读屏软件、全浏览器组合、完整深色八角色组合或每个编辑器的每项提交/网络中断。六宽度二十项有浅深主题；八角色矩阵为浅色。
- WCAG 结果来自指定 wcag2a/wcag2aa/wcag21aa 标签扫描，不代表所有最佳实践规则或所有可访问性能力都检查完毕。
- M06 既有命令恢复只覆盖当前挂载管理界面；浏览器刷新、直接地址栏跳转、整个管理路由卸载没有持久命令恢复。商品接口仍无原保存 receipt；核实当前事实后显式采用已落库版本，不声称拥有原命令回执。
- 聚合/目录仍为独立领域读取，不承诺跨领域原子快照。治理列表无权限时按资源过滤为空；独立管理资源与写操作由服务端权限拒绝。
- Windows exec_command 有 CET 启动错误；实际操作经已验证 Node/原生进程入口完成。运行会话早期中断及所有修正尝试保留，未算通过。

这些项目明列为未执行/既有边界；本轮原始 M08 的全部必需验收已完成。

## 修改文件、接口、迁移与 Git

M08 共 **11 文件**：5 个生产/生成文件、3 个测试文件、3 个交接文档。

| 类型 | 文件 |
| --- | --- |
| 生产 | apps/api/src/admin.rs |
| 生产 DTO | crates/api-contract/src/membership.rs |
| 生成契约 | src/api/generated.d.ts |
| 生产样式 | src/styles.css |
| 生产样式 | src/styles.admin.css |
| 行为测试 | apps/api/tests/admin_membership_operations.rs |
| E2E | e2e/community-responsive.spec.ts |
| E2E | e2e/plugin-admin-redesign.spec.ts |
| 交接 | docs/handoffs/membership-admin-redesign/m08-plan.md |
| 交接 | docs/handoffs/membership-admin-redesign/current.md |
| 最终报告 | docs/handoffs/membership-admin-redesign/m08-final.md |

M08 数据库迁移：**0**。新增公共接口：**0**。修改既有 POST /api/v1/admin/membership/points 的 signed 非零请求范围；186 个 OpenAPI paths 不增加。M06 的续期两接口及迁移仍属 M06，不重复算本阶段。

commit SHA / HEAD：06bfa627b264b72aebd28f1e06447be08ea1b25a，分支 codex/daoyun-home-foundation。唯一既有 worktree 为 C:/Users/111/Documents/Playground，项目位于其中的 daoyun 子目录；没有创建或归档 worktree。没有 commit/reset/stash/PR/发布。原 dirty 修改保留，本阶段新改动仍在工作区。构建、日志、截图及脚本在 ignored test-results 下，未提交生成构建输出或凭据。

证据根：test-results/membership-admin-redesign/M08。继续入口：[current.md](current.md)。M01–M07 的范围、数量和历史限制仍见各阶段 result，不用本次最终数量改写旧阶段事实。
