# 社区运营工作区规格

状态：已确认（2026-08-22，依据用户“开始吧”的实施指令）

## 目标

后台运营不再把成长、积分、勋章堆在同一张配置页中，而是按“规则配置 → 自动执行 → 待处理事项 → 人工干预 → 通知与记录”的工作流组织能力。

首阶段只交付一条可实际使用的勋章运营闭环：查看目录与规则、手工发放、查看操作记录、撤销当前持有状态。成长和积分先拆成独立工作区，不在本阶段扩展新的服务端规则。

## 用户与权限

- 运营管理员：持有 `membership.medals.read` 时可以查看勋章目录、规则和操作记录。
- 运营管理员：持有 `membership.medals.grant` 时可以手工发放或撤销勋章。
- 规则管理员：持有 `membership.medals.rules.write` 时可以修改自动发放规则。
- 普通会员不访问后台运营工作区，只能在公开资料中看到自己当前持有的勋章。

## 首阶段用户流程

### 查看与筛选操作记录

1. 管理员进入“会员运营 > 勋章”。
2. 页面显示最近的手工发放、自动发放和撤销记录。
3. 管理员可按用户 UUID 或勋章筛选，并可继续加载更早记录。
4. 每条记录展示目标用户、勋章、操作类型、原因、操作人和时间。

### 撤销勋章

1. 管理员在当前持有的发放记录上选择“撤销”。
2. 管理员填写撤销原因并确认。
3. 服务端移除用户当前持有状态，并写入不可变审计记录。
4. 页面刷新操作记录；公开资料不再展示该勋章。
5. 重复撤销已经不存在的持有状态时返回成功但标记 `revoked = false`，不重复写审计记录。

## API 契约

### `GET /api/v1/admin/membership/medal-operations`

查询参数：

- `user_id?: UUID`
- `medal_key?: medal_01..medal_17`
- `cursor?: UUID`
- `limit?: 1..100`，默认 25

响应使用统一分页 envelope：

```json
{
  "data": [
    {
      "id": "uuid",
      "operation": "grant | automatic_grant | revoke",
      "user_id": "uuid",
      "username": "member",
      "user_display_name": "会员",
      "medal_key": "medal_01",
      "medal_display_name": "勋章 01",
      "reason": "活动奖励",
      "actor_id": "uuid",
      "actor_username": "admin",
      "actor_display_name": "管理员",
      "created_at": "RFC3339"
    }
  ],
  "meta": {
    "request_id": "uuid",
    "next_cursor": "uuid | null"
  }
}
```

记录来源为现有 `admin_audit_log`，仅映射：

- `membership.medal.grant` → `grant`
- `membership.medal.auto_grant` → `automatic_grant`
- `membership.medal.revoke` → `revoke`

### `POST /api/v1/admin/membership/medal-revocations`

请求：

```json
{
  "user_id": "uuid",
  "medal_key": "medal_01",
  "reason": "撤销原因，1 至 64 个字符"
}
```

响应数据：

```json
{
  "user_id": "uuid",
  "medal_key": "medal_01",
  "revoked": true
}
```

## 数据与审计

- 不新增勋章操作流水表，避免与 `admin_audit_log` 形成双写和一致性成本。
- 当前持有状态仍由 `membership_medals` 表表达。
- 撤销和审计写入在同一数据库事务中完成。
- 撤销审计动作是 `membership.medal.revoke`，摘要包含 `user_id`、`medal_key` 和 `reason`。
- 已撤销勋章允许以后重新发放；历史发放、撤销、再发放记录均保留。

## UI 结构

- 会员运营页一级工作区：`成长`、`积分`、`勋章`。
- 成长：等级目录、规则编辑。
- 积分：账户查询、流水查询、人工调整。
- 勋章：目录与自动规则、手工发放、操作记录。
- 不创建尚无接口支持的“申请审批”“批量发放”“自定义图标”等假入口。

## 验收标准

- 三个工作区可以通过键盘切换，移动端可横向滚动，不挤压内容。
- 勋章记录默认按时间倒序，支持筛选与游标分页。
- 无读取权限返回 403；无发放权限的用户看不到或不能执行撤销。
- 撤销后公开用户资料不再返回该勋章。
- 重复撤销返回 `revoked = false`，且不生成重复撤销审计。
- 所有新增公共接口进入 OpenAPI，响应 envelope 与 `x-request-id` 一致。
- 前端组件测试、API 集成测试、类型检查和生产构建全部通过。

## 明确不做

- 不复制 Discuz!/phpwind 的页面布局、品牌或代码。
- 不做勋章定义硬删除；撤销的是用户持有关系。
- 不在首阶段开放自定义勋章、上传图标、勋章申请审批、批量发放。
- 不增加多积分币种或旧论坛兼容层。
