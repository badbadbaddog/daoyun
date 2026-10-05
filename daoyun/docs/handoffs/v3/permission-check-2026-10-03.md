# DYR-013 权限检查与资源边界交接

日期：2026-10-03。本卡状态：DONE，G2 已接受。V3 已完成 DYR-001–013，整体 PAUSED；G0/G1/G2 已接受，G3–G6 尚未接受。按用户要求，仅完成 DYR-013 及交接后暂停后续任务，DYR-014–030 保持 PLANNED。

## 已完成的实现

- 新增管理团队下的独立权限检查页；选择具体用户、版块、五种社区动作与主题／附件／文件大小。文件只在本机读取大小，检查不上传内容。
- GET /api/v1/admin/permission-check 先检查七项读取能力，再查询主体与资源。使用 REPEATABLE READ / READ ONLY 事务、128 个来源上限、两秒单语句超时，返回服务端当前快照时间与一致的 request_id；no-store。
- 复用实际权限 union、额度 MAX、账号限制和策略快照；补齐主题发布／删除／作者／锁定、文件与存储临界值以及原文件下载增量额度。普通用户无法读取任何诊断来源。
- 来源详情链接可预填用户、版块、动作；目标页重新读取用户并等待显式检查。更换条件、手工搜索及能力撤销都会使旧请求和结论失效。
- 客户端校验后复制并统一 UUID 大小写，接受合法的大写输入与服务端规范化响应；仍严格核对主体、资源、动作及 request_id，不修改调用方输入。
- 修复 ready 附件仍可能被删除或扫描未通过时的读取边界：诊断、列表、原文件及缩略图均要求 clean 且未删除。没有新增迁移。
- 修复既有发布器延迟自动聚焦抢走重新登录按钮的竞争条件。组件持有并取消聚焦帧，执行时复查编辑状态及确认弹窗；保留原移动／Safari 聚焦参数、正文和草稿恢复。关联 DYR-019，提前处理以关闭 G2 回归。

## 验收结果

| 检查 | 当前结果 | 证据 |
|---|---|---|
| 前端全量 | PASS：995 项、111 文件，0 失败 | baseline-2026-10-02/logs/dyr013-test-frontend-final.log |
| 最终聚焦与草稿专项 | PASS：60 项 | baseline-2026-10-02/logs/dyr013-green-editor-final-reviewed.log |
| 最终权限检查及来源跳转专项 | PASS：89 项，含新增大写 UUID 回归 | baseline-2026-10-02/logs/dyr013-green-uuid-final.log |
| 应用／E2E 类型及生产构建 | PASS | baseline-2026-10-02/logs/dyr013-build-uuid-final.log |
| 新权限及真实附件边界 | PASS：2 个新增管理端测试及 5 个附件测试；全量中的管理端 18 项亦通过 | dyr013-green-resource-boundaries.log；dyr013-g2-rust-final.log |
| 权限检查专项浏览器（UUID 收尾前） | PASS：10 项，无跳过、失败或 flaky | dyr013-2026-10-03/browser-linked-results.json |
| Rust 全 workspace 测试／最终 API 构建 | PASS：468 通过、0 失败、2 既有 ignored；格式与严格 lint 通过 | baseline-2026-10-02/logs/dyr013-g2-rust-final.log |
| 最终运行端契约与生成客户端 | PASS：真实 OpenAPI 与导出语义一致，生成客户端校验通过 | live-openapi-final.json；dyr013-generated-client-final.log |
| 最终累计浏览器 | PASS：84 项，0 失败、跳过或 flaky；572 张截图 | browser-cumulative-results.json；browser-cumulative/ |

AC-013-01：十次检查后额度使用量／revision、存储、积分流水及审计均不变。AC-013-02：撤销唯一上传来源后，真实上传被拒绝且不扣额度，旧允许结果不能授权。AC-013-03：普通用户检查自己／他人／不存在主体均返回脱敏拒绝。三项专项与最终累计真实浏览器验证均通过，AC-013-01–03 已接受。

响应布局覆盖 320、390、768、1024、1440 CSS px，亮暗色、键盘与无横向溢出；200% 重排证据使用 720 CSS px × DPR 2 的明确模拟，不宣称原生浏览器菜单缩放或真机软键盘验证。后两项仍属于 DYR-022／全局验收。

行为 RED 已保存：新端点 404、infected ready 附件错误允许、来源链接／预填缺失、延迟聚焦抢焦点，以及合法大写 UUID 被误报返回对象不一致。最终 UUID 修复在全量 995 项之后完成，另以最终 89 项、构建及 84 条累计浏览器验证，不冒写全量 996 项。编译、类型或响应导航定位错误单独保留，不称为行为 RED。

## 版本与证据位置

- 仓库：C:/Users/111/Documents/Playground/daoyun；HEAD 40bcff25ec920912bff7f4472bc6174e63b8e2d9，分支 codex/daoyun-home-foundation。源码未提交，未部署生产。
- 本卡证据目录：artifacts/v3/dyr013-2026-10-03；20 个最终源码文件已保存到 source-snapshot，并以 source-manifest.json 标识。
- tracked-source.patch SHA256：f01e8a33bae95753df80bd773a2f3a50197abe9e2f9ad1cb3759252ef91fbc39；这是 HEAD 至当前这 20 个文件的累计差异，包含此前增量，不是仅本卡差异。新增未跟踪文件由源码快照补齐；回退须结合前序快照逐文件比较，不能整包逆向抹去此前工作。
- dist-final 保存最终前端构建；dist-reviewed 为 UUID 收尾前的已验证构建。review.json 记录代码、安全及独立聚焦核验；protected-file-check.json 记录 29 个原受保护文件。
- 本机隔离环境：PostgreSQL 15435、API 3001、前端预览 4174。最终 API PID 43696，文件 runtime/final-reviewed/daoyun-api.exe，SHA256 f7c5d5cbfe032e152595bc6d4b3dafa406c8baa458cd74a9409c1867863607ab；运行端与导出 OpenAPI 一致，导出 SHA256 c592edcdbace8a27c61851740baa1b25bf8d6c13f1fb7d3b1fea4f855c374d1c。环境密钥、Cookie 和 CSRF 不写入交接。

## 暂停与恢复入口

本卡没有待完成项。20 个源码文件与最终 source-snapshot／source-manifest.json 的 SHA256 均一致，HEAD 未变化；完整验证记录见 [verification.json](../../../artifacts/v3/dyr013-2026-10-03/verification.json)。current.md 与 execution-state.json 已同步本卡 DONE、G2 ACCEPTED 和整体 PAUSED。

按用户明确要求暂停后续任务，收到恢复指令后再从 DYR-014 开始。DYR-014–030 未完成，且没有启动实现。DYR-014 仅保存只读定位，见 artifacts/v3/dyr014-2026-10-03/source-map.json；没有修改成长规则、UTC 业务日、奖励执行器或历史账本。恢复前先阅读 DaoYun_V3 的任务方案、成长奖励规格和上述定位材料，核对工作区现状后再确定执行器互斥与水位方案。

Rust 全量保留两个既有 ignored：apps/api/tests/plugin_business_component.rs 的 official_growth_component_runs_from_outbox_through_worker_to_ledger，以及 crates/plugin-host/tests/contracts.rs 的 official_growth_component_instantiates_with_only_bounded_wasi_cli_imports。默认测试明确跳过它们；本卡没有单独运行官方成长 Wasm 组件集成，不将它们计为通过，后续相关任务仍须验证。

隔离 PostgreSQL PID 19420、API PID 43696、预览 PID 36784 保持运行，便于本机复核；进程可能在应用或设备关闭后结束，恢复时先检查端口和二进制哈希。用户原有开发环境与数据库保留。

## 回退边界

诊断入口与前端回退不撤销既有授予，不修改真实额度和账本。附件 clean／未删除修复属于安全边界，不以恢复旧漏洞作为常规回退。保留草稿和会话恢复修复，不清空用户内容；本卡没有生产迁移或数据删除。
