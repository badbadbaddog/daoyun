# M03 结果：用户列表身份与成长展示

状态：DONE（本阶段实现及验收收口）；当前 PAUSED；2026-10-06。整体重构 NOT DONE；不进入 M04。

## 实现与依据

用户列表保留基础/附加身份、积分、会员权益、账号状态、注册/活跃和操作，把等级与 EXP 合并为“成长等级 / EXP”一列，桌面总计 10 列（含选择列）。窄屏成长区跨内容宽度，不隐藏领域字段。

Lv、等级名、EXP 均来自已有用户列表投影；进度只复用原成长筛选目录 getAdminGrowthLevels 和共享 GrowthProgress，没有新增读取请求、逐 UID 详情请求或 API/Schema。当前阈值按等级 id 匹配；下一等级为 published、order 更高、requiredExperience 大于真实 EXP 的最小 order，与 apps/api/src/admin.rs 既有详情语义一致。列表及目录仍是独立读模型，不承诺跨请求原子快照。

EXP 冲正后当前等级保持服务端结果，存在下一等级时进度最低 0%；无下一等级按共享组件表示当前最高成长阶段，100% 表示没有后续成长目标，不等于当前 EXP 一定达到保留等级阈值。目录缺失/加载/失败时保留 Lv/EXP 并提示“进度暂不可用”，不伪造满进度。未初始化、无会员档案、无权查看分别保留。新进度在目录权限撤回后立即停止显示；目录请求仍由原 capability 控制。

CSV 保留独立等级和 EXP 字段，以及原身份/积分/权益权限裁剪与安全编码。真实搜索、状态/注册/会员 facets、游标分页、当前已加载数据导出、脱敏和状态竞态 handlers 未改。

## 代码与测试边界

生产仅 src/components/UserAdminPanel.tsx、src/styles.admin.css；测试仅 UserAdminPanel.test.tsx。9 个新增行为/回归测试，覆盖目录排序/草稿排除、冲正/积分独立、最高阶段、目录等待/失败重试/缺当前等级、未初始化、能力撤回、分页复用及实际 CSV 下载裁剪。既有 3 个列/文案断言同步新合并契约。

先 RED：首轮 12 失败/34 通过，其中 1 个为新增 CSV 夹具误期待未加引号；按既有 encodeCsv 校正后，11 个真实行为失败/35 通过。GREEN targeted 135 通过。CSV 测试等待已有对象 URL 释放后再恢复 stub，避免延迟清理与测试 teardown 竞态。没有删除测试或放宽业务断言。

1092 个源码/配置/生成文件快照对比仅以上 3 文件变化；API、Rust、generated、migrations、公共社区样式和 M02 管理壳源码未变。新增接口 0、迁移 0、依赖 0；UTF-8 读写。

## 最终门禁

| 项目 | 结果 |
| --- | --- |
| targeted | 4 文件 / 135 通过，包含在全量中 |
| 全量前端 | 120 文件 / 1150 通过，含最终下载资源释放检查 |
| TypeScript / E2E TypeScript / production build | PASS，最终测试版本复核完成，生产代码与浏览器验收版本一致 |
| diff --check | PASS |
| 完整 E2E，同 M02 的 5173 网关与显式 3000 API | FAIL：90 通过、24 失败、230 跳过；总 344；失败集合与 M02 完全一致 |
| 真实浏览器 | PASS；15 张新截图、15 布局检查无整页横向溢出 |
| axe | 13 次扫描无违规，未扫描旧详情对话框 |
| 键盘 / 交互 | 5 个键盘及 8 个交互检查通过；1 个实际游标续页不可触发 |

完整 E2E 既有失败仍为公共配色 2、图片预览高度 4、插件对比度 8、/b/engineering 网关 404 为 10；逐项集合比对无新增或消失，保留 FAIL，不宣称全绿。条件跳过的 live 测试旧首页名称仍按 M02 记录留待启用前同步。

本轮没有重跑 Rust workspace/fmt/clippy、OpenAPI generate 或 ignored WASM 用例，后端及生成/迁移源码哈希无变化。M01 的 503 Rust 通过/1 ignored 只作历史事实。复用 M02 已构建的真实 API，无本轮后端生产修改。

## 实际浏览器与限制

生产 gateway+真实 API+现有 PostgreSQL，当前真实列表 3 位用户，EXP=0、当前等级阈值=0、下一等级阈值=100，3 个实际进度与响应绑定正确；目录初次仅读取 1 次，初始无逐用户详情读取。非零进度、冲正、最高阶段、无权限及目录异常由组件行为测试覆盖，不伪造当前数据库账户数据。

用户列表 320/390/768/1024/1440 × 浅深主题，共 10 张；选中列表 1 张；既有详情在 320/1440 各 1 张；空搜索在 320/1440 各 1 张，共 15。全部布局无整页溢出；列表/选中/空态 13 次 axe 无违规。主代理查看桌面浅色与窄屏深色截图确认列密度和身份字段。

键盘跳过导航、搜索到筛选 Tab、空格选择、两宽度详情 Enter/Escape/原焦点恢复通过。实际选中 CSV 下载为 1 数据行且包含独立等级/EXP 字段；真实成员搜索、空结果、状态/基础组/成长等级/注册日期筛选及 50 行设置通过。当前只有 3 用户，没有 next_cursor，实际“加载更多”标记 NOT_AVAILABLE_IN_CURRENT_DATA；不能把它计为通过，组件分页请求/复用/竞态仍有回归覆盖。状态 restricted 筛选实际为 0 结果，不能代作真实受限账号负例。

浏览器监控没有 pageerror 或后台读取失败；登录前 auth/session 一次 401 为预期访客状态。没有提交领域业务写入；登录产生会话和活跃事实。真实读屏、1920、八角色、历史对话框 11 个 axe 问题节点、跨领域写命令继续留待后续。

## 审查与过程记录

三个探子只读定位列表/契约/需求，主代理读取基础文档与即将修改的代码。独立审查仅本轮 before 快照对照及共享组件，无阻塞发现；主代理完成最终取舍、修改与验证。参考原八图在 Desktop/DaoYun_DZ风格_后台界面_分离素材，已逐一查看，探子只搜仓库没有找到不能推断文件不存在。八图无原始用户列表图，M03 按交接要求和现有表格视觉完成，不引入图中的旧论坛权限模型。

首轮浏览器脚本错误等待既有详情 h2，原标记实际是 h3；只修正验收定位，保存 browser-first 的未完成记录及完整重跑结果。终端 CET 限制继续用现有 Node 执行通道与持久任务包装器；过程问题见 bootstrap-issues.json。

HEAD 06bfa627b264b72aebd28f1e06447be08ea1b25a；分支 codex/daoyun-home-foundation。既有 dirty 修改保留，没有 worktree/commit/reset/stash 或外部发布。test-results/dist 为忽略输出，不提交截图、构建或秘密。临时服务收口后停止，既有 PostgreSQL 保留。

证据根：test-results/membership-admin-redesign/M03；gates.json、e2e-summary.json、source-changes.json、production-diff.patch、review-result.md、screenshot-manifest.json、browser-layout/accessibility/keyboard/interactions/growth/network/errors.json 与 service-stop.json。

## 下一阶段 M04

仅用户继续后启动统一用户详情。先读取 M01 聚合 DTO 与现有档案，复用已存在 GET /api/v1/admin/users/{id}/membership-summary；明确会员身份/账号安全等标签与同 UID 的领域操作、流水和成功刷新契约，再补失败测试，不导入旧未接入草稿、不重造同名聚合接口。缺失管理员 EXP/积分流水等契约需按领域单独定义。
