# DYR-024 官方内置扩展解耦交接

状态：DONE；AC-024-01/02/03 全部 PASS。用户已恢复 DYR-024；DYR-025 尚未启动。HEAD 40bcff25ec920912bff7f4472bc6174e63b8e2d9，分支 codex/daoyun-home-foundation，工作区保留前序未提交修改。未提交、未部署。G0/G1/G2 保持 ACCEPTED，G3–G6 保持 NOT_ACCEPTED。

## 行为和边界

后台“内置模块”直接配置投票、积分兑换、运营报表、帖子补充、编辑审核；新记录 disabled、空组件，启用仍需显式操作。新增 POST /api/v1/admin/plugins/builtins/{key} 与 Plugin.execution，固定五个 key，复用会话/CSRF、plugins.install、事务行锁和配置审计。重复配置不改变原行，不重复审计；同名 Wasm 返回 409 并保留整行。既有启停 revision、锁、权限、受控记账和审计复用，native 禁止通用卸载保护历史。

数据库 execution 默认 wasm；历史转换严格限定官方 key、schema 1、0.1.0、空 scopes/events、单一业务能力加 ui.panel。只修改 execution 与 revision（+1）；保留 id/key、字节/hash、安装者、时间戳、status 和 provider_key。活跃 lease/receipt 阻断转换，单能力、混合能力和第三方历史不转换。新 native 仅申请自身能力，CHECK 同时允许历史 ui.panel 清单。native 排除于 Wasm 装载、UI contributions、执行 lease、队列认领和命令复核。未增加奖励写入者或市场。

会话 token 改变时重新挂载管理面板，清除私有列表、详情、工具和草稿；旧回调留在卸载实例。新增失败回归已转为通过。

## 历史与回退

原 DYR-023 数据库保留；本轮写入仅限隔离克隆、新库和 SQLx 临时库。旧版真实安装五个官方组件、投票写入 1 票、全部停用后升级。最终整行比对确认仅 execution/revision 改变。DAOYUN_PLUGINS_ENABLED=false 时，历史读取、显式启用、回放和再次停用均 200，仍仅 1 票。

旧二进制连接扩展 schema 以 VersionMissing(202610040001) 阻断启动。仅保留旧组件且没有空组件 native 时，停服后逆向 schema，旧版真实读写/回放通过。最终五条空组件 native 下 down 明确报错；provider 整行、2 条验收投票与账本保持原样，不删除记录强行回退。

升级前 pg_dump 实际恢复到另一个新隔离库。旧版启动、登录、历史读取通过，provider_key=official_polls、1 票、34 条积分账本、0 条经验账本保留。恢复 RPO 为升级前快照；快照后的验收写入保留于其验收库，不声称已纳入恢复副本。私有备份及环境文件只留在 artifacts/v3/dyr024-2026-10-04/private，不提交。

## 兼容期限与复核决定

五个静态官方插件源、构建脚本和旧 public 包作为兼容材料保留；新后台不再请求它们。兼容窗口从 DYR-024 至 DYR-028 回退矩阵通过且 DYR-030/G6 验收签字完成前；到期由明确 contract 清理任务处理。plugins:build 仍是旧材料手动重建入口。编译期可选 Wasm 归 DYR-025。

独立复核的历史匹配过宽、会话旧响应问题已修复并补失败测试。快照 provider 收窄建议未采纳：snapshot.execution 描述宿主业务服务，Plugin.execution 描述组件分派。DYR-023 契约和现有混合第三方 provider 测试明确验证宿主投票在 Wasm 关闭时可用；只按官方 key 计算会与业务 gate 不一致。保持已有行为。

## 验证

- 前端全量 1083 测试 / 115 文件 PASS；聚焦会话/内置配置 39 PASS。
- 应用类型检查、生产构建、E2E 类型、OpenAPI --check、Rust fmt/clippy、git diff --check PASS。
- API 插件 6 PASS，基础设施投票/迁移 4 PASS。最终 Rust 全量 485 PASS / 2 ignored；中间全量 484 PASS / 2 ignored。
- 最终浏览器 6 PASS，桌面/移动各 3，累计唯一用例 156；50 张截图，五档宽度无横向溢出，320/1440 axe 无违规，pageerror 为空。桌面创建全部五项并验证默认停用，移动保留已有状态。内容/投票选项由隔离 SQL fixture 准备，配置、启停、投票、回放和旧页面拒写均为真实 UI/API。
- 实际设备、辅助技术、生产、市场、无 Wasm 编译产物 NOT_RUN。G3–G6 未因用例通过自动接受。

首次浏览器因 Windows 导入路径预览启动失败，不计 PASS。最终初次复跑另有 2 条因错误环境变量实际启用 Wasm 失败；纠正为 DAOYUN_PLUGINS_ENABLED=false 后全部重跑，关闭 Wasm 的证据以 browser-verified 与最终历史重跑为准。RED 曾遇到 fixture scope/空态文本准备错误；修正后确实捕获迁移 2 vs 3 和会话旧状态行为失败，准备错误不算 RED 证明。

证据根 artifacts/v3/dyr024-2026-10-04：source-manifest.json、task-source-diff-final.patch、prior-task-preservation.json、independent-review.json、final-legacy-upgrade-evidence.json、legacy-compatible-read-write.json、native-rollback-guard-final.json、restored-backup-evidence.json、browser-verified/、logs/。完整结果汇总于 verification.json。

最终源码 16 文件 SHA256：e85bcbc980158164cf2c1c7bb7cf2e6d142b30876d9c30fd3a5fbc0eaf978a04（包含 package.json 保留控制项）；非本任务的五个 DYR-023 清单文件保持一致。3000/5173/3001/4174/15435 均未监听；本轮 API/预览与隔离 PostgreSQL 已停止，原库、克隆、验收库及恢复快照均保留。下一项 DYR-025（Wasm 编译期可选化），状态 PLANNED，尚未启动。
