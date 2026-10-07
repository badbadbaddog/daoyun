# M03：用户列表身份与成长展示

状态：DONE；2026-10-06。用户继续 M02 交接，授权恢复本阶段；按最新 M01–M08 顺序，收口后 PAUSED，不进入 M04。

## 目标与验收

用户在一列查看当前服务端等级 Lv、等级名称、真实 EXP 与小进度；基础/附加身份、积分、会员权益、账号状态、注册/活跃与操作维持独立。不能把角色当社区身份或用积分推算 EXP。

复用列表已有 getAdminGrowthLevels 目录请求及 GrowthProgress，当前等级阈值由 id 匹配；下一等级仅为已发布、序号更高、阈值大于真实 EXP 的最小序号，与现有详情接口选择语义一致。当前账户等级以列表投影为准，存在下一等级时冲正低于当前阈值显示 0% 而不降级；无下一等级按既有共享组件显示当前最高成长阶段，100% 表示没有后续目标，不能解读为 EXP 必定达到保留等级阈值。目录尚未加载/失败或当前等级不在目录时，不伪造完成度，保留等级/EXP 并提示进度暂不可用。无会员档案、未初始化、无权查看各自区分。

## 技术、目录与风格

React 19 / TypeScript / Vite / Vitest / Testing Library。生产修改限定 src/components/UserAdminPanel.tsx 与 src/styles.admin.css；复用 src/features/membership/GrowthProgress.tsx，不改其全局语义。行为测试 src/components/UserAdminPanel.test.tsx。后台语义 CSS token，命名组件、UTF-8，无新依赖。示例：<GrowthProgress experience={experience} currentThreshold={current.requiredExperience} nextThreshold={next?.requiredExperience ?? null} />。

## 命令及验证

- targeted：pnpm test -- src/components/UserAdminPanel.test.tsx src/api/adminUsers.test.ts src/components/AdminView.test.tsx src/features/membership/MemberCenterPage.test.tsx
- 全量：pnpm test
- 类型：pnpm typecheck；pnpm test:e2e:typecheck
- 构建：pnpm build
- 差异：git diff --check
- 完整 E2E：DAOYUN_WEB_URL=http://127.0.0.1:5173 与 DAOYUN_API_URL=http://127.0.0.1:3000 环境，pnpm test:e2e --workers=2 --output=test-results/membership-admin-redesign/M03/e2e-final
- 浏览器：真实本地 API/PostgreSQL 与生产 gateway，用户列表在 320/390/768/1024/1440、浅深主题下截图/布局/axe；实际搜索、筛选、选择导出、分页与键盘进入详情并返回，记录请求及错误事实。当前用户数据不足的分支用先失败行为测试覆盖，不伪造生产数据。

## Task 1：合并成长列

依赖 M02。先补失败测试：列顺序 10 列（含选择），Lv/EXP/进度同列，真实阈值、草稿等级排除、最高等级及冲正不降级、目录异常/未初始化/脱敏不伪造进度。再以最少代码复用现有目录及进度条。保留 CSV 独立等级与 EXP 字段和无权限裁剪，补实际下载内容测试。

## Task 2：紧凑响应式

依赖 Task 1。合并桌面 grid 列，窄屏成长内容单区展现；保留全部身份/权益/状态/日期字段及可访问选择与详情入口。使用既有语义 token，进度条宽度不产生整页溢出。targeted 通过后运行全量、类型与构建。

## Checkpoint：收口

主代理执行全部代码修改及最终验证；探子只读探索/核验。独立审查本轮差异；真实浏览器+截图并保留网络、控制台、布局、axe、键盘记录；E2E 失败与 M02 的 90/24/230 基线逐项对照，不改公共场景断言换 PASS。保存 m03-result.md/current.md 与 gates/source-changes 等证据。

## 边界

始终：服务端真实数据、capability、筛选/游标/脱敏/已加载页导出/状态竞态和已有 dirty 修改保留。无 API 或 Schema 改动，不初始化用户成长账户、不提交业务写操作、不以旧阶段 DONE 代替验收。
需新范围：后端/迁移/依赖/统一详情契约扩展；当前现有目录已覆盖，无此需求。
禁止：M04 会员 summary 接入、用户详情重构、领域写入、权限重算、API/Rust/generated/migrations、公共社区样式、删除失败断言、提交产物或秘密。

已知：条件 live 用例首页旧名称在 M02 记录，仍不纳入本阶段；M01 对话框 11 个 axe 问题节点、八类角色/1920 完整矩阵归后续。

## 实际收口（DONE）

Task 1/2 完成。新增 9 项行为/保留回归测试；校正 RED 11失败/35通过，targeted135通过，最终全量1150通过，TS/E2E TS/build/diff-check通过。完整 E2E90通过/24失败/230跳过，与 M02失败集合一致，门禁保持FAIL。真实浏览器15截图及布局、13axe无违规、5键盘和8交互通过；仅3用户导致实际游标续页不可触发，单独登记，不能算PASS。临时服务已停止，既有PostgreSQL保留。详情见 [m03-result.md](m03-result.md)。本阶段收口后PAUSED，不进入M04。
