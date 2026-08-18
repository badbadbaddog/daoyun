# Spec: 官方成长奖励插件（首个纵向切片）

## 状态

Accepted — 2026-08-15

## 目标

以真实 `plugin-business@0.1.0` Component 完成第一条插件化成长闭环：插件消费核心的
`topic.published` 与 `reply.created` 事件，并通过受控 `experience.append` 命令写入核心
EXP 账本。规则、事件解析和奖励策略属于插件；EXP 账本、等级投影、命令幂等、配额和
Outbox 仍属于可信核心。

## V1 规则

| 规则键 | 触发事件 | UTC 自然日内奖励 | EXP |
| --- | --- | --- | ---: |
| `growth.topic_first_daily` | `topic.published` v1 | 每位作者首个有效主题 | +10 |
| `growth.reply_first_daily` | `reply.created` v1 | 每位作者首个有效回复 | +3 |

- 业务日使用事件原始发生时间的 UTC 日期，不使用 worker 的重试时间。
- 同一用户、规则和业务日生成完全相同的命令幂等键与奖励来源 UUID。核心幂等命名空间使用
  稳定插件 key，不使用一次安装记录的 UUID；事件重放、并发投递、同日后续内容以及卸载后
  重装均只能重放该命令，不能重复增加 EXP。
- 奖励来源 UUID 由插件命名空间、规则键、用户 ID 与 UTC 日序号确定性生成，代表每日
  奖励声明；原始内容 ID 仍由事件 Outbox 保留。
- 插件仅接受 payload schema v1，并校验 payload 中的主题/回复 ID 与事件 aggregate ID
  一致；未知版本、无效 JSON 或无效 UUID 必须显式失败。

## 版本化事件契约

- WIT `event` 新增 `payload-schema-version: u16`。
- event worker 把 `plugin_event_deliveries.payload_schema_version` 原样传给 guest。
- 事件 `RequestContext.occurred-at-unix-ms` 使用投递保存的 Outbox `created_at`，因此延迟与
  重试不改变业务日。
- 当受控命令日配额耗尽时，worker 将投递延期到下一个 UTC 配额窗口并重置本轮尝试计数，
  不把可恢复的配额压力累计为 dead 事件；恢复后仍沿用原始事件发生时间和稳定幂等键。
- 核心命令键固定为 `plugin:` 加 SHA-256，并同时纳入稳定插件 key 与插件幂等键；长度不随
  manifest key 增长。权益来源同样记录稳定插件 key，通知在重装后会核对原始 kind/target，
  相同输入返回 replay、不同输入返回幂等冲突。
- 当前契约尚未对外发布，三份 SDK/host WIT 与官方插件 WIT 在同一变更中同步，继续使用
  单一 `0.1.0`，不并存两个不完整版本。

## 插件包

目录：`plugins/official-growth-rewards`

Manifest 最小权限：

- capability: `events.subscribe`, `experience.write`
- data scope: `users.targeted`
- subscriptions: `topic.published`, `reply.created`

插件不申请 UI、存储、任务、Points、通知或网络能力，也不默认安装或启用。

## 非目标

- 每日签到、连续签到、Points、声望、点赞/采纳/加精奖励。
- 站点时区、管理员可配置规则、奖励撤销和升级通知。
- 修改主题/回复主事务；插件失败只能影响异步投递。
- 自动安装、真实支付或任何治理权限。

## 验收标准

1. 主题/回复事件 v1 产生正确、最小的 `experience.append` 命令。
2. 同一事件重放、同日多个事件、并发命令执行以及插件重装后，EXP 最多增加一次；次日可再次奖励。
3. worker 传递真实 payload schema version 与 Outbox 原始发生时间。
4. payload ID 与 aggregate ID 不一致、未知版本和畸形 JSON 不产生奖励。
5. 插件停用后不再领取事件；历史 EXP 流水不撤销。
6. host、两个 SDK 示例和官方插件使用完全相同且可解析的 WIT。
7. 插件原生单元测试、host 契约测试、PostgreSQL 队列/命令测试和 workspace 质量门禁通过。
8. 命令日配额耗尽时事件延期而非进入 dead；下一个 UTC 窗口恢复后只产生预期的一条流水。
