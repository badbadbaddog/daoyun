# M01 Task Plan：架构核对与验证基线

## 当前行为
后台按 capability 懒加载；用户列表以治理角色和内容指标为主；会员工作区按领域分开。统一后台会员档案与管理员 EXP/流水/权益续期接口尚缺。权限矩阵目前只有五个普通动作，来源只含组/权益。

## 涉及文件
本阶段只新增 docs/tasks/admin-membership-rebuild/{plan,architecture,M01-plan,M01-result}.md，不修改生产代码、DTO、Schema 或现有有效测试。test-results/admin-membership-rebuild/M01 保存忽略的基线输出与浏览器截图。

## 步骤与验收
- 实际阅读用户指定源码：主代理读取入口及三个规格全文；8 个只读探子分范围读取其他生产源码、API、migrations 和相关测试，主代理点验关键结论。permissionCheck.ts 缺失，记录真实适配器位置。
- 输出并保存 A–G 结论和阶段依赖；核实积分历史等级与 EXP 等级隔离、诊断快照边界、现有写契约。
- 执行 targeted 与完整前端测试、TypeScript、production build；浏览器核验五种宽度/浅深主题、真实 session 与 API，无提交副作用。
- 本阶段无新增行为，失败测试不适用；沿用已有行为测试建立基线，不新增镜像测试。无 Rust 生产改动，Rust tests/fmt/clippy 标 N/A，后端实施阶段必须执行。
- 记录运行结果与截图路径，全部基线通过才将 M01 标 DONE。
