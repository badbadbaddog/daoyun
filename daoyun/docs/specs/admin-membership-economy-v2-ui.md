# Spec: 会员经济后台 V2

## Objective

将“会员经济”后台明确拆分为成长等级（EXP）、积分账本、勋章和标准权益四个独立区块。运营人员可配置没有数量上限的动态 EXP 等级；积分发放不再在界面上宣称会升级成长等级。

## Commands

- Test: `pnpm test -- --run src/api/admin.test.ts src/components/AdminView.test.tsx`
- Type check: `pnpm typecheck`
- Build: `pnpm build`

## Project Structure

- `src/api/admin.ts`: 会员经济后台 HTTP 契约、响应校验与字段映射。
- `src/components/MembershipAdminPanel.tsx`: 会员经济运营界面。
- `src/components/AdminView.tsx`: 能力到界面操作的映射。
- `src/api/admin.test.ts`、`src/components/AdminView.test.tsx`: 契约与交互测试。

## Code Style

```ts
// 服务端字段只在 API 边界使用 snake_case；组件只使用 camelCase 的领域数据。
const saved = await updateAdminGrowthLevel(level.id, input, csrfToken)
setGrowthLevels((current) => current.map((item) => item.id === saved.id ? saved : item))
```

## Testing Strategy

- API 测试验证动态等级的读取、写入、CSRF 头和 snake_case 请求体。
- 组件测试验证 EXP 阈值编辑、积分账本的独立说明和权限驱动的只读状态。
- 生产构建验证 TypeScript 与 Vite 集成。

## Boundaries

- Always: 沿用既有的 CSRF、乐观并发版本号和服务端响应校验。
- Ask first: 数据迁移、删除旧积分等级接口、增加用户搜索权限或支付/权益业务规则。
- Never: 让积分账本写入 EXP、让成长等级授予后台治理权限、伪造尚未接入的权益操作。

## Success Criteria

- 有 `membership.rules.read` 的账号读取 `/api/v1/admin/membership/levels`。
- 有 `membership.rules.write` 的账号可新建草稿并保存动态 EXP 等级。
- 积分授予结果只表达积分账本变化，不表达 EXP 或成长等级升级。
- 页面可见成长等级、积分账本、勋章和标准权益四个业务边界。

## Open Questions

- 用户搜索选择器需要独立、受授权的用户查询接口；本次不把现有“用户管理”读取权限隐式赋给积分运营角色。
- 标准权益已有写入契约，但缺少本页面需要的安全列表/筛选读取契约；本次先展示边界说明，不新增假操作入口。
