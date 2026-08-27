# Spec: Topic Moderation Visual Refresh

## Objective

将现有主题治理工作台调整为参考设计中的蓝色、高密度、数据表格型后台界面，同时保留既有 API、权限、治理动作、处理记录与错误状态。右侧“组件状态示例”属于设计说明，不进入生产页面。

## Tech Stack and Commands

- React 19、TypeScript、Vite、Vitest、Testing Library。
- Test: `pnpm test`
- Type check: `pnpm typecheck`
- Build: `pnpm build`
- Develop: `pnpm dev`

## Project Structure

- `src/components/ModerationAdminPanel.tsx`：主题治理列表、筛选、操作和确认弹窗。
- `src/components/TopicModerationHistory.tsx`：处理记录列表。
- `src/components/AdminView.tsx`：统一后台壳层及治理页视觉模式。
- `src/styles.css`：局部语义颜色、密度和响应式规则。

## Code Style

```tsx
<div className="moderation-topic-row__metric" aria-label={`${topic.replyCount} 条回复`}>
  {topic.replyCount}
</div>
```

- 使用命名导出、语义 HTML、Lucide 图标与现有 CSS token。
- 视觉覆盖限定在 `.admin-view--moderation` 和 `.moderation-admin-panel`，不污染其他后台模块。

## Testing Strategy

- 组件测试验证多列表头、字段顺序、权限操作和处理记录结构。
- 保留现有 loading、empty、forbidden、error、conflict、dialog 和 pagination 测试。
- 浏览器检查 320、768、1024、1440 像素、浅深主题、控制台和页面级横向溢出。

## Boundaries

- Always: 保留服务端授权和现有请求契约；危险动作继续使用确认弹窗；移动端纵向堆叠。
- Ask first: 修改 API、增加依赖或把设计稿说明栏加入生产页面。
- Never: 硬编码组件颜色、显示无权限按钮、复制第三方后台源码或品牌。

## Success Criteria

- [x] 桌面端显示所属板块、发布时间、主题摘要、作者、回复、点赞、浏览、审核状态、治理状态和操作列。
- [x] 工具栏、列表行、按钮、状态标签与弹窗达到参考图的紧凑蓝色治理后台风格。
- [x] 处理记录使用横向字段表格，同一时间只展开一条。
- [x] 320、768 像素纵向堆叠；1024、1440 像素保留可扫描的数据表布局且无页面级横向溢出。
- [x] 现有权限、验证、冲突和加载状态行为不回归。

## Open Questions

无。参考图右侧组件状态栏明确作为设计说明处理。
