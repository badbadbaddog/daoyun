# M02 Task Plan：管理壳、导航与会员一级结构

状态：DONE；2026-10-06。用户通过 current.md 继续指令恢复 M02；按已授权的 M01 文件边界实现，收口后不自动进入 M03。

## 目标与验收
复用已有蓝色顶栏、上下文侧栏、搜索、折叠、主题、移动选择器及真实首页摘要，不制造第二套 Shell。首页用户可见名称统一为“管理首页”；保留 #admin/dashboard 及 return_to/return_scroll 协议。键盘用户能跳过重复导航进入当前管理内容，六会员工作区内容可通过 Tab 进入，标签名称、顺序与 capability 显隐保持真实。

## 技术、命令与结构
React 19 / TypeScript / Vite / Vitest / Testing Library；命名导出、现有 Lucide 图标、后台语义 CSS token、UTF-8。代码示例：`<main id="admin-main" tabIndex={-1}>`。无需新增依赖。
测试：pnpm test -- src/components/AdminView.test.tsx src/components/AdminDashboard.test.tsx src/components/MembershipAdminPanel.navigation.test.tsx src/components/MembershipAdminPanel.interactions.test.tsx。
最终门禁：pnpm test；pnpm typecheck；pnpm test:e2e:typecheck；pnpm build；git diff --check。
浏览器：真实本地 API+PostgreSQL+生产 gateway；320/390/768/1024/1440、浅深主题；首页、会员六标签、授权入口/分类/搜索/折叠/主题/移动选择器，保存截图、布局、axe、错误/网络事实。

## Task 1：管理首页与跳过导航
依赖：M01。文件：AdminView.tsx、AdminView.test.tsx、styles.admin.css。
验收：导航/移动选项/面包屑使用管理首页；返回链接语义相同，原路由不变；跳过链接实际将焦点移入 main，页面无额外 Tab 停靠。
验证：先跑新增行为测试并保存 RED，再最小实现跑 GREEN；真实键盘验收。

## Task 2：会员内容区键盘入口
依赖：Task 1。文件：MembershipAdminPanel.tsx、MembershipAdminPanel.navigation.test.tsx、styles.admin.css（仅焦点样式）。
验收：六标签按能力顺序保留；Tab 从当前标签进入具名内容区，反向 Tab 可返回；切换后隐藏区不参加焦点序列；每个获授权 tab 的 aria-controls 对应节点持续存在，未激活领域只保留空隐藏节点、不挂载其组件；保留成长/积分/治理领域说明与所有写入 handlers。
验证：先失败行为测试，再实现并跑会员交互回归；真实六标签键盘/截图。

## Checkpoint：收口（DONE）
主代理负责代码修改、方案取舍和最终验证；探子仅独立只读探索/核验。targeted/全量/类型/build 通过；与 M01 相比分类浏览器与既有 E2E 失败，不能删除测试或放宽标准换 PASS。保存 m02-result.md / current.md 和机器可核对证据。

## 边界与风险
始终：保留所有获授权入口、服务端鉴权、领域独立性和既有未提交修改；截图读取真实数据，业务写操作不在本阶段范围。
需要新授权：扩大到后端/数据库、增加依赖或改变本阶段定义。
禁止：改用户列表领域、API/Rust/generated/migrations、领域写命令、公共社区样式；不提交密钥、构建产物；不将旧历史 DONE 代作当前验收。
M01 默认 E2E 24 个既有失败、axe 11 节点保留作对照；处理 M02 引入或管理壳范围内问题，其余按所属阶段登记。

## 实际收口

Task 1、Task 2 及独立审查问题均完成。新增 10 个先失败行为测试；targeted 88 / 全量 1141 通过，类型与构建通过。最终同地址 E2E 为 90 通过、24 失败、230 跳过，失败集合与 M01 一致，保留 FAIL。真实浏览器 112 截图、110 布局、22 axe 无违规、9 键盘与 18 导航检查通过。结果及限制见 [m02-result.md](m02-result.md)。本阶段收口后 PAUSED，未进入 M03。
