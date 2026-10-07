# M02 结果：管理壳、导航与会员一级结构

状态：DONE（本阶段实现及验收收口）；当前 PAUSED；2026-10-06。仅本阶段收口，未进入 M03。整体重构 NOT DONE。

## 本轮实现

复用已有蓝色顶部、上下文侧栏、搜索、折叠、主题、移动选择器和真实首页摘要。管理壳已有能力入口按原 capability 显隐，不增加第二套 Shell。

- 首页导航、移动选项、面包屑和返回入口统一为“管理首页”；#admin/dashboard、return_to/return_scroll 协议保留。
- 跳过导航链接以键盘进入当前具名 main；点击只移动焦点，不改 SPA hash。仅链接获焦时显示，使用现有后台语义 token。
- 用户组、成长等级、积分管理、勋章管理、会员权益、兑换商品六个内容区可通过 Tab 进入，Shift+Tab 返回；Arrow/Home/End 及原能力撤回行为保留。
- 每个获授权 tab 的 aria-controls 目标持续存在。未激活且原本不常驻的领域只保留空隐藏节点，避免额外挂载、请求或副作用；积分原有常驻区继续保留草稿。

本轮生产文件仅 src/components/AdminView.tsx、src/components/MembershipAdminPanel.tsx、src/styles.admin.css；测试文件仅 AdminView.test.tsx、MembershipAdminPanel.navigation.test.tsx。新增 10 个行为测试；先 RED 后 GREEN，首轮 9 个预期失败和后续控件关联 1 个预期失败分别保存在 red.log 与 panel-link-red.log。

## 最终门禁

| 项目 | 本轮结果 |
| --- | --- |
| targeted | 4 文件 / 88 通过，包含在全量中 |
| 全量前端 | 120 文件 / 1141 通过 |
| TypeScript / E2E TypeScript / production build | PASS |
| diff --check | PASS；既有 CRLF 提示不作为失败 |
| 完整 E2E，同 M01 的 5173 网关与显式 3000 API | FAIL：90 通过、24 失败、230 跳过；总 344；失败集合与 M01 完全相同 |
| 实际管理页面浏览器 | 112 张截图、110 次布局检查无整页横向溢出 |
| 管理页面 axe | 22 次桌面浅深主题扫描，0 违规 |
| 键盘 / 导航 | 9 项键盘检查；17 个获授权模块入口及 1 组桌面壳交互检查通过 |

本轮未重新运行 Rust workspace/fmt/clippy、OpenAPI generate 或官方 WASM ignored 用例。M01 历史 Rust 503 通过、1 ignored 不能冒充本轮重测。启动真实验收 API 时成功构建已有 WASM feature；源码无后端修改。

## 浏览器覆盖与实际限制

使用生产构建、真实本地 API 与现有 PostgreSQL，覆盖首页、用户列表、版块页、会员六工作区、角色与权限、权限检查，共 11 个视图；320/390/768/1024/1440，浅色与深色，共 110 张；另有 320/1440 跳过链接获焦截图 2 张。页面数据为实际当前本地数据。

键盘实测首页与用户列表跳过导航，六会员区 Tab/反向 Tab，Arrow/Home/End 和 aria-controls 目标；移动模块选择器覆盖 17 个获授权模块；桌面分类、搜索、折叠、面包屑及主题通过。生产包页面没有 pageerror 或后台读取失败；登录前 auth/session 的一次 401 是预期访客状态，保留在错误和网络证据中。

没有提交业务领域写操作，登录产生会话。真实读屏软件、1920 尺寸、八类角色完整矩阵、对话框及所有领域写入端到端场景仍未验收。本轮 22 次无违规扫描不包含 M01 登记的 11 个问题节点场景，不声称已消除这些历史问题。

## E2E 对照及过程问题

M01 完整基线为 90 通过、24 失败、230 跳过，总 344。已有失败分组为公共配色 2、图片预览高度 4、插件页对比度 8、/b/engineering 网关 404 为 10。最终完整运行仍为 90 通过、24 失败、230 跳过；失败集合逐项比对无新增或消失。E2E 门禁保持 FAIL，不记为全绿。本轮保留测试与标准，不删除断言。

首轮网关运行 89 通过、25 失败、230 跳过；原 24 项集合一致，额外一项为公共首页切到深色后即时 axe 对比度扫描。该测试和公共样式 SHA 未变；实测已有背景 140ms 过渡，即时扫描读到过渡色 #6c717a、比值 3.97。推断为原有过渡与扫描时序相交；同一未修改测试在两个项目各重复 5 次，共 10 次通过，仍保留首轮失败。

另一次 4173 Vite 预览对照为 98 通过、14 失败、232 跳过。SPA fallback 使 10 个版块 mock 场景通过；未显式配置 API 导致 2 个安全测试跳过。这不是生产修复，也不与 M01 基线直接比较。主代理从 M01 trace 的请求 URL 确认当时实际地址为 5173，纠正仅依据默认配置推断 4173 的错误。

中途运行时重置导致一次完整 E2E 被中断，已标为 INTERRUPTED，不计门禁。Windows CET 导致原终端不可用，改用现有 Node 执行通道；数据库只读查询超时也登记在 bootstrap-issues.json，未把未完成检查记成 PASS，当前数据库迁移应用数量不作新断言。

条件跳过的 live 用例仍有旧首页名称断言（e2e/v3-live-common-ui.spec.ts、e2e/v3-live-summary.spec.ts）；它们不在 M02 文件边界，后续开启相应验收前同步名称。跳过不等于通过，不使用旧文案别名绕开断言。

## 独立核验、文件边界与证据

探子仅只读定位导航/启动环境、比对 E2E 集合和独立审查。主代理完整读取即将修改代码，完成取舍、修改及最终验证。独立审查提出的 tab 控制目标缺失已以先失败测试及最小隐藏节点修复；E2E 探子“新增 axe 断言”的推断经源码点验纠正。

启动时 1092 个源码/配置/生成文件快照对比，仅上述 5 文件变化，API/Rust/generated/migrations、公共社区样式和原 E2E 文件均未改变。接口新增 0、迁移新增 0；不声称重新核实已应用迁移数量。所有源码及文档以 UTF-8 读写。

HEAD 06bfa627b264b72aebd28f1e06447be08ea1b25a；分支 codex/daoyun-home-foundation。既有未提交修改保留，无新 worktree、commit、reset 或 stash；不提交生成输出或密钥。验收临时服务收口后停止，既有 PostgreSQL 保留。

证据根目录：test-results/membership-admin-redesign/M02。入口为 gates.json、e2e-summary.json、source-changes.json、production-diff.patch、review-result.md、screenshot-manifest.json、browser-layout/accessibility/keyboard/navigation/errors/network.json。每次完整/中断运行的日志及退出事实均保留。

## 下一阶段

仅用户继续后启动 M03 用户列表：身份投影、Lv/EXP 合并与小进度，先计划及失败行为测试，继续使用真实服务端数据；不提前实现 M04 统一用户详情或后续领域接口。M04 复用已存在 membership-summary。所有领域边界与 M01 基线仍有效。
