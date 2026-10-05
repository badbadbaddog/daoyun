# DYR-014 成长规则执行计划

2026-10-03，用户已恢复任务。仅按本卡扩展现有成长界面和奖励执行边界。

1. 等级列表显示 draft/published/disabled/archived；编辑只提供既有服务端允许的转换，归档仅查看；保存保留所选状态；本地预览不调用写端点、不改变账户。创建沿用现有 published 契约，并明确其效果。先以组件失败测试复现强制发布，再定向验证。
2. 复用已有 plugins.read API 显示官方成长插件安装状态，仅在成长区和有权限时读取；失败独立重试。官方 V1 规则按事件原始 UTC 自然日，主题首次10 EXP、回复首次3 EXP，每用户/规则/日一次。安装 enabled 不宣称运行时已运行。
3. 当前只支持既有 Wasm 奖励执行器。新增单值配置 DAOYUN_GROWTH_REWARDS_EXECUTOR，缺省 wasm；builtin 或混合配置启动失败，且在数据库连接/迁移与 worker 启动前拒绝。内置执行器仍须 DYR-024 的明确单写者、水位与幂等迁移，不提前切换。
4. 跑真实成长 Component 的两个 ignored 专项、Points 扣减/EXP独立、同日/跨日/重放与禁用历史；相关 Rust/API、前端、类型、构建和真实浏览器证据齐全后更新交接。保留全部既有改动、UTC、已发流水与禁用状态；未提交、未部署。

## 执行器交接约束

当前 plugin execution lease 仅按 plugin_id 互斥，核心 EXP 键包含稳定 plugin key，不能把这些误称为跨提供者全局唯一。当前生产代码没有内置成长写入者。本卡明确拒绝任何内置切换请求，不构建空壳执行器或伪造水位。

未来切换须在旧插件生命周期锁下停止新领取，确认 active lease/pending receipt 均清空，冻结精确的历史 delivery 集合（不能用 UUID 或事件时间猜提交顺序），保存每个原始 outbox_event_id、occurred_at、UTC日和 claim source。新执行器复用原插件稳定键和规范幂等键或核对已有 ledger claim 映射；双读单写及重放对账通过后才开放切换。回退不得删除旧账本或重置已完成 delivery。
