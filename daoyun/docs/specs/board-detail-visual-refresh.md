# Spec: 版块详情视觉升级

## Objective

在不改变现有版块与主题 API 的前提下，把公开版块详情页升级为紧凑、内容优先的社区界面：桌面端展示版块概览、子版块横向卡片、主题表格式列表和版块专属右栏；移动端压缩为单栏概览、横向子版块和高密度主题列表。

## Tech Stack

- React 19、TypeScript、Vite、Vitest、Testing Library
- 现有 `BoardDetail`、`Topic` DTO 与 hash route
- Lucide 图标、语义 CSS tokens

## Commands

- 定向测试：`pnpm vitest run src/features/boards/BoardDirectoryPage.test.tsx src/components/RightSidebar.test.tsx`
- 全量测试：`pnpm test`
- 类型检查：`pnpm typecheck`
- 生产构建：`pnpm build`
- 浏览器回归：`pnpm test:e2e`

## Project Structure

- `src/features/boards/BoardHeader.tsx`：版块概览和真实权限操作
- `src/features/boards/BoardChildren.tsx`：子版块卡片
- `src/features/boards/BoardTopicFeed.tsx`：排序、搜索和主题列表表头
- `src/components/RightSidebar.tsx`：版块详情专属信息栏
- `src/app/CommunityApp.tsx`：把当前版块与本版主题传入右栏
- `src/styles.css`：桌面与移动端详情页样式

## Testing Strategy

- 组件测试覆盖真实版块统计、子版块链接、发布权限、版块专属右栏和主题打开行为。
- 复用现有主题行交互测试，避免视觉升级破坏点赞、收藏和路由。
- 在 320、375、768、1024、1440px 验证无横向溢出、底部导航不遮挡、子版块可滚动、主题列表可操作。
- 检查浏览器控制台和失败网络请求。

## Boundaries

- 始终：只展示 API 已提供的版块层级、名称、简介、主题数、子版块数、访问能力和本版主题数据。
- 始终：保留现有路由、发布权限、搜索、排序、分页、点赞与收藏行为。
- 禁止：伪造版主、关注/收藏版块、今日统计、创建时间、最新子版块主题或成员数。
- 禁止：修改后端契约、引入新 UI 框架、在组件中硬编码主题颜色。

## Success Criteria

1. 桌面版块详情具备紧凑概览、子版块卡片、主题列表列头和版块专属右栏。
2. 移动端在 320px 起保持单栏、可操作且无横向滚动。
3. 未授权用户看不到发布操作；授权用户可从版块上下文进入统一发布器。
4. 右栏只展示当前版块、真实子版块和真实本版主题。
5. 定向测试、全量测试、类型检查、生产构建与浏览器回归通过。

## Open Questions

- 版主、版块关注与分时统计待公共 API 提供后另行设计，不在本次 UI 中模拟。
