# DaoYun 用户 / 会员 / 权限重构：当前交接

状态：**M01–M08 DONE，整体 DONE**。2026-10-07 完成最终验收；2026-10-08 提交新分支，未部署。

## 当前结果

最终报告：[m08-final.md](m08-final.md)。最终计划及范围：[m08-plan.md](m08-plan.md)。原始用户 M01–M08 请求和来源存于 test-results/membership-admin-redesign/M08/original-user-request.md、original-request-provenance.json；旧 docs/tasks/admin-membership-rebuild 阶段编号仅作历史。

M08 实际完成二十项、八类角色、六种宽度（320/390/768/1024/1440/1920）。二十项浅深主题 240 张，八类账号 48 张，真实积分增加/扣减 2 张，共 **290 PNG**；288 次布局检查无整页横向溢出，96 次 WCAG 标签扫描违规 0，2 项键盘、17 项账号/权限边界检查通过。原数据库、实际 API 和 gateway 用于真实页面验收。

| 门槛 | 最终结果 |
| --- | --- |
| 完整前端 | 128 文件 / 1251 通过 |
| 完整 Rust | 532 通过 / 0 失败 / 1 ignored |
| 默认完整 E2E | 114 通过 / 0 失败 / 230 skipped / 0 flaky |
| 类型 / E2E 类型 / 生产构建 | PASS |
| fmt / clippy | PASS；workspace/all-targets/-D warnings |
| API generate/check、OpenAPI、generated zero-diff | PASS；186 paths，实际文档与导出一致 |
| 源码版本 / UTF-8 / diff | 751 个源码/配置漂移 0；PASS |

230 skipped、1 ignored 均未执行，不算通过。未做读屏软件、全浏览器组合或深色八角色全组合；到期、真实树重挂载和并发边界由最终 SQLx/API 测试验证，不冒充浏览器全矩阵。具体证据、时间、命令及未执行项见 m08-final.md 和 M08/gates-final.json。

## 阶段记录

- M01 DONE：真实基线、领域与 UI 契约，[m01-baseline.md](m01-baseline.md)。
- M02 DONE：管理壳、导航及会员一级结构，[m02-result.md](m02-result.md)。
- M03 DONE：用户列表身份、成长及权限遮蔽，[m03-result.md](m03-result.md)。
- M04 DONE：统一用户详情与同 UID 领域操作，[m04-result.md](m04-result.md)。
- M05 DONE：用户组七分类、EXP 调整/冲正与流水、积分流水、勋章回执，[m05-result.md](m05-result.md)。
- M06 DONE：原子续期、原期限保护、不可变回执、权益/商品冲突与未知结果恢复，[m06-result.md](m06-result.md)。
- M07 DONE：治理诊断、角色范围来源、六层解释、八项读取门槛与撤回遮蔽，[m07-result.md](m07-result.md)。
- M08 DONE：二十项、八类账号、六宽度及全部必需质量门槛，[m08-final.md](m08-final.md)。

未导入旧 test-results/admin-membership-rebuild/M04/T01/interrupted-draft。旧阶段报告保留原始结果；M07 的 24 例默认 E2E 失败在 M08 使用正确默认环境并局部修复后归零，不回写旧阶段数量。

## 最终局部变更

M08 只修复移动图片预览高度、选中插件小字对比度、过期的两项配色及插件安装 E2E 契约，以及实际积分扣减被管理 API 正数校验拒绝的问题。新增失败行为测试后允许管理 HTTP 单次 ±1000000 非零变更；复用原 signed 账本、原子回执、余额保护、权限复核，不改 EXP。DTO/OpenAPI/generated 同步。

M08 共 5 个生产/生成文件、3 个测试文件、3 个交接文件，详见最终报告与三类阶段 diff。M08 无新增迁移、公共接口、依赖或生产预设角色。内部/插件积分金额策略保持既有规则；管理 HTTP 的金额边界不等于全局账本边界。

## 必须保留的领域与恢复边界

account status != community groups != EXP/level != points != medals != entitlements != roles/assignments。账号最终拒绝优先；restricted 阻断普通写入；社区组/权益只增强普通能力与额度；治理只来自 Role/Assignment。EXP/等级及勋章不授予治理；积分不隐式改变 EXP。版块 exact/subtree 使用当前真实树，诊断复用实际谓词，后端做最终判断。无权字段返回 null/UI“无权查看”，不能填 0。

会员权益仅未撤销、未到期的有限期可续期，待生效有限期也可续期；永久或撤销不能续期，过期通过重新授予处理。续期保留原开始时间、版本/权限/额度快照、来源、原因、授予人及原 grant key 的授予期限，原命令重放不缩短/恢复权益。回执不可变；权限、审计、事件和权益变更同事务。

M06 的 POST /api/v1/admin/entitlements/{entitlement_id}/renew、GET /api/v1/admin/entitlements/users/{user_id}/renewal-requests/{key} 和一对迁移仍保留；down 会丢弃原期限元数据与 renewal receipt，重新 up 不能恢复原命令事实，详见 m06-result.md。

浏览器刷新、直接地址栏跳转、整个管理路由卸载尚无持久命令恢复；商品 API 没有原保存 receipt，核实只展示当前事实，需显式采用已落库版本。聚合/目录不承诺跨域原子快照。治理集合读取无权限时可按资源过滤返回 200 空集合；独立管理资源和写操作仍鉴权，不能只用状态码推断治理允许。

## 数据库与服务收尾

原 demo_member 业务快照与最早 M08 快照一致，只排除登录活跃时间 last_seen_at；demo_admin 仍 active。临时角色及任命全部删除。12 个验收夹具账号全部 suspended，首批 6 个未初始化积分账户，后批有效 6 个余额均 0；真实积分对象的累计积分、4 条流水/审计保留，不删除历史。没有关闭原邮件注册验证策略，没有记录凭据。

API 3000、gateway 5173、preview 4173 已按 PID/路径/命令/创建时刻验证后停止，三个端口无监听。原 PostgreSQL 16：127.0.0.1:55433 / PID10140，数据目录 C:/Users/111/AppData/Local/DaoYun/postgresql-16，ready 且保留。没有创建空业务库替代。

Windows exec_command 有 CET 启动错误；实际验证使用 Node/原生进程入口。默认特性 Rust 测试会重建 target/debug API，继续本地 wasm 服务须重新 build --features wasm-plugins 或使用验证过的独立副本，避免特性与环境不一致。

## Git 与证据

2026-10-07 验收基线 HEAD：06bfa627b264b72aebd28f1e06447be08ea1b25a，原分支 codex/daoyun-home-foundation。

2026-10-08 按用户“推送进新的分支”指令，将已验收后端与前端提交到新分支 codex/membership-admin-redesign-20261008；实现提交 c6c7731e6a5259b6336bdb9d2fac4315eb89397a。验收文档与原始参考素材单独提交。本次推送目标 origin：git@github.com:badbadbaddog/daoyun.git；最终远程引用和推送回执见本地 test-results/membership-admin-redesign/push-20261008/result.json。

唯一既有 worktree：C:/Users/111/Documents/Playground；项目在 daoyun 子目录。没有 reset/stash/新 worktree/PR/部署，其他项目与本地临时文件保留。官方插件 public/plugins 下生成副本、缓存、测试截图与运行时数据不纳入提交；源码、迁移、测试、阶段文档及用户原始后台参考图纳入新分支。

本阶段证据：test-results/membership-admin-redesign/M08。source-before.json + before/ 原字节、source-after.json、source-changes.json 与三类 diff 可核对精确阶段范围。gates-final.json、views/roles manifests、domain-boundaries-final.json、contract-proof-final.json、database-fixtures-final.json、service-state-final.json 为最终入口；失败尝试和工具中断另行保留，不叠加到通过数。所有构建、截图、日志为 ignored 输出。
