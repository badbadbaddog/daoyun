# Spec: 帖子内容页视觉升级

## Objective

在不改变帖子、回复和关系 API 的前提下，把帖子内容页升级为紧凑、内容优先的社区详情界面：桌面端突出正文、作者信息、主题操作、回复编辑器与楼层卡片，并提供帖子专属右栏；移动端压缩为单列阅读流和固定评论入口。

## Tech Stack

- React 19、TypeScript、Vite、Vitest、Testing Library
- 现有 `TopicDetail`、`Reply`、关系与举报接口
- 现有 `RichTextContent`、`RichTextEditor`、`ReplyItem`、`UserAvatar`
- Lucide 图标与 `packages/design-tokens/tokens.css` 语义令牌

## Commands

- 定向测试：`pnpm exec vitest run src/components/TopicDetailView.test.tsx src/components/RightSidebar.test.tsx`
- E2E 类型检查：`pnpm test:e2e:typecheck`
- 浏览器回归：`pnpm exec playwright test e2e/community-responsive.spec.ts`
- 全量测试：`pnpm test`
- 类型检查：`pnpm typecheck`
- 生产构建：`pnpm build`

## Project Structure

- `src/components/TopicDetailView.tsx`：帖子正文、主题操作、回复区与详情数据回传
- `src/components/ReplyItem.tsx`：楼层卡片及现有回复互动
- `src/components/RightSidebar.tsx`：帖子作者、相关版块与真实热帖信息
- `src/app/CommunityApp.tsx`：把当前帖子详情传给公共右栏
- `src/styles.css`：桌面、平板与移动端帖子详情视觉规则
- `e2e/fixtures.ts`：用于验证富内容和楼层卡片的真实形状测试数据
- `e2e/community-responsive.spec.ts`：五档宽度、无障碍与截图回归

## Code Style

```tsx
<section className="topic-detail-sidebar" aria-label="帖子相关信息">
  <AuthorPanel topic={topic} />
  <RelatedBoardPanel topic={topic} />
</section>
```

- 使用命名导出、语义 HTML 与可访问名称。
- 展示组件不请求数据；复用详情页已经加载的 server-shaped 数据。
- 颜色、间距和圆角使用现有语义令牌，卡片圆角不超过 8px。

## Testing Strategy

- 组件测试覆盖详情数据回传、作者信息面板、相关版块链接和原有互动不回归。
- E2E fixture 提供富文本正文与至少两个真实回复形状，覆盖正文、编辑器、楼层卡片和引用层级。
- 在 320、375、768、1024、1440px 验证无横向溢出；桌面展示帖子专属右栏，1060px 以下按现有外壳隐藏右栏。
- 375 与 1440px 执行 Axe 并输出对照截图，浏览器控制台和业务请求保持无错误。

## Boundaries

- 始终：保留收藏、点赞、分享、举报、编辑、删除、修订、回复、引用与图片上传行为。
- 始终：只展示 API 已提供的作者、用户名、头像、版块、回复、点赞、浏览、正文和回复数据。
- 询问后再做：新增后端字段、修改 API 契约或引入依赖。
- 禁止：伪造粉丝、等级、私信、关注、获赞总数、在线成员或编辑时间。
- 禁止：复制参考产品的品牌、文案或源码。

## Success Criteria

1. 1440px 下正文区具有明确外边界、作者行、宽松正文、贴底主题操作栏和独立回复区域。
2. 登录用户的回复编辑器位于回复列表前；回复以连续楼层卡片呈现，引用层级清楚。
3. 帖子详情右栏展示当前作者、真实主题统计、相关版块和真实热帖；深链接加载后也能得到详情数据。
4. 320–768px 下保持单列阅读流、左侧状态不溢出、固定评论入口不遮挡正文或底部导航。
5. 所有现有互动行为、定向测试、全量测试、类型检查、构建和浏览器回归通过。

## Open Questions

- 作者等级、粉丝、私信、关注和版块成员数据待公共 API 提供后再补，不在本次视觉复刻中模拟。
