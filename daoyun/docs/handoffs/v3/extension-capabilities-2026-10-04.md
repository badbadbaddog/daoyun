# DYR-023 扩展能力状态统一

状态：DONE；AC-023-01/02/03 PASS。按用户要求完成当前任务后停止，V3 执行状态 PAUSED；DYR-024 及后续任务未启动。G0/G1/G2 已接受，G3–G6 仍 NOT_ACCEPTED，测试不代替用户门禁接受。工作区 DIRTY；未提交、未部署。

## 行为与冻结边界

新增只读管理员扩展能力快照 GET /api/v1/admin/plugins/capabilities，沿用 plugins.read，标准响应 request_id 与响应头一致，DTO/OpenAPI 位于 api-contract。区分构建支持、Native/Wasm 运行条件、provider 业务开关和当前用户生命周期控制；所有模块明确 target_authorization_required=true。游客 401，快照不输出组件字节或私有配置。

管理页独立显示能力状态、未配置、停用和运行时未启用；请求失败可单独重试，已安装列表保留且不重复读取。AbortController 与 csrf/revision/attempt key 防止旧快照覆盖新会话。320px 单列，宽屏双列；原有安装与启用界面保留。

投票、兑换、补充、编辑审核、运营报表的 Native 数据库业务独立于 Wasm 开关；成长奖励仍由现有 Wasm 执行器唯一写入。快照反映 provider 开关；模块自身设置、账号/资源/动作权限仍在原服务端提交路径检查。当前构建支持恒为 true 与现有构建一致，不能据此声称已完成无 Wasm 构建；构建裁剪属 DYR-025。

停用后投票停止新写入，历史遵守原结果可见规则；兑换停止新交易扣分，已完成请求可回放；补充停止新写入，旧收据与历史保留；编辑审核停止新接收，已待审事项继续经原治理授权/revision 显式处理，不自动批准；报表停用保留核心治理摘要；奖励停用保留账本、收据与队列水位。原业务事务保留 provider 行锁和提交复核。

队列认领增加 provider SHARE SKIP LOCKED，与生命周期 FOR UPDATE 协调；锁占用/停用时跳过，不增加尝试。恢复后继续未完成任务，completed 不再次认领；原 lease/收据/额度事务不变，不引入第二奖励写入者。安装和重新启用仍保留原组件校验，官方内置迁移留给 DYR-024。

## 验收与检查

| 验收 | 结果与证据 |
| --- | --- |
| AC-023-01 | 同一隔离数据库重启关闭 Wasm，快照 Native 投票 available；桌面和手机真实投票与回放均 200，每个 poll 只有一条投票。API 回归同时检查 Native 与 Wasm 成长描述。 |
| AC-023-02 | 原生 CSRF/revision API 停用 provider 后，旧页面提交 409 poll.disabled，零新增投票；历史可读，未到公开条件的计数仍隐藏；恢复后快照正常。 |
| AC-023-03 | 新 SQLx 用例验证生命周期锁占用、停用跳过、attempts=0、恢复认领和 completed 不重做；完整现有插件命令/成长收据幂等回归通过。 |

前端 1078 项/115 文件全部通过；应用类型、E2E 类型与生产构建通过。Rust workspace 482 通过、2 ignored，格式与全目标 clippy 通过。两项 official-growth component ignored 在 DYR-019 单独通过，本次未重跑。实时 OpenAPI 生成类型一致性与 git diff --check 通过。API 快照 4 项、队列 5 项与界面 27 项专项通过，新增行为保存 RED→GREEN 日志。

实际浏览器六条最终用例通过：Wasm-off 两条，Wasm-on 停用旧页面/历史保留和独立重试四条。累计 144→150，70 张最终截图；320/390/768/1024/1440 五档无整页横溢，320/1440 相关区域 Axe 通过，无页面异常。主线程亲自复核 7 张关键截图，独立探子完成服务端与界面静态核验。实体设备、软键盘、屏幕阅读器仍 NOT_RUN。

中断的初次 Rust workspace 与 Wasm-on 浏览器尝试不计入通过；完成的独立重跑均退出 0。中断留下的测试 provider 停用状态经原生审计 API 恢复。交接阶段隔离服务已关闭，第一次契约校验因连接失败未通过；恢复原隔离数据库/API 后最终校验通过，再关闭服务。失败日志保留，未跳过或弱化验收。

## 源码与保留

[验证清单](../../../artifacts/v3/dyr023-2026-10-03/verification.json)、[源码清单](../../../artifacts/v3/dyr023-2026-10-03/source-manifest.json)、[独立核验](../../../artifacts/v3/dyr023-2026-10-03/review.md)、[夹具记录](../../../artifacts/v3/dyr023-2026-10-03/fixture-registry.json) 与 task-source-diff.patch、source-before/source-snapshot、preservation.json、OpenAPI/访客边界记录和日志均保留在独立 artifacts。14 文件 SHA256：

`4bc2ff2f85e7ff33db5435be55ce213c131a2d11960b085ce978a1af9ba8e34f`

算法 SHA256(JSON.stringify(files))，路径排序，原始 UTF-8 字节。DYR-021 的 15 文件全部未改；DYR-022 的 8 文件未改，styles.admin.css 仅追加本任务状态区样式。原有 dirty 改动保留。

仅本机隔离数据：新投票 provider v3_ext_polls_7c8d0cae9d5249bb，id 01a10240-58c0-7333-8fb2-c447686f63d7，经原生 API 安装/切换，最终 enabled、revision 8；原 poll provider 列表为空。保留 5 个新 poll（含中断夹具）与 2 条真实投票、全部审计。版块/主题/投票选项通过 SQL 创建新 fixture，不能据此声称 API 建投票或建帖额度验证；投票、回放及生命周期切换实际走 API。没有重置额度、删除历史业务或凭据。私有环境/本地密钥仅留本地 private，不写交接正文。

## 停止与继续入口

本次临时 API 3001 与隔离 PostgreSQL 15435 已关闭；预览 4174 在中断后已关闭。最终 3000/5173/3001/4174/15435 均未监听，原开发服务未操作，数据库目录与历史数据保留。没有遗留本任务验证作业。

执行状态已写入 [execution-state.json](execution-state.json)，当前任务清空，last_completed_task=DYR-023，next_task=DYR-024，resume_requires_user_instruction=true。后续从已验证的 [任务计划](extension-capabilities-task-plan-2026-10-03.md) 与 V3 04 契约继续，等待用户明确恢复；本次停止，不执行 DYR-024。
