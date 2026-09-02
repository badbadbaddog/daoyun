# DaoYun Phase 2 交接：2026-09-02

> 当前状态：**IN PROGRESS**。Phase 1 已在 `34b7d1b92e057f47e06d2c65af9985ee35d4d84b` 收口。Phase 2 的 11.1 首页 canonical 导航统一、11.2 跨页面上下文 / 返回语义、11.3 首页高频交互一致性均已完成实现和验收；下一步只做 11.4 最终审计与收口，不再扩张本阶段范围。

## 1. 基线

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- 父级 Git 根：`C:\Users\111\Documents\Playground`
- 分支：`codex/daoyun-home-foundation`
- Phase 2 起点 HEAD：`34b7d1b92e057f47e06d2c65af9985ee35d4d84b`
- Phase 2 设计文档：`docs/specs/community-ui-phase-2.md`
- 用户约束：**不要创建或使用 Codex 会话，由 FastSpider_FS 直接完成代码、测试与浏览器验证。**

## 2. 11.1 已完成

发现并修复：首页 canonical 语义不一致。

此前：

- Logo：`#top` -> 推荐 `#hot`
- 移动首页：`#top` -> 推荐 `#hot`
- 桌面首页：`#feed` -> **最新**

这会导致桌面用户点击“首页”时从推荐意外切换到最新。

现在：

- `SiteHeader` Logo -> `#hot`
- `LeftSidebar` 首页 -> `#hot`
- `MobileNavigation` 首页 -> `#hot`
- 非法内部 board / topic / user route format fallback -> `#hot`
- legacy `#top` 和显式 `#feed` 仍继续兼容解析，不破坏旧 URL。

## 3. 11.2 已完成

此前详情页的返回动作固定跳 `latest`，会把来源上下文抹掉。本轮改为在 `CommunityApp` 中维护轻量的详情来源栈，但 hash route 仍然是唯一页面状态源。

已验证：

- direct topic -> 返回 canonical 推荐首页 `#hot`。
- search `q + type` -> topic -> 返回完整原搜索 hash。
- board -> topic -> 返回原 board slug。
- following -> user profile -> 返回 `#following`。
- 同一 topic 的 reply 定位、同一 messages 内 conversation 变化不会重复压栈。
- OIDC claim 完成默认落点改为 `#hot`。

## 4. 11.3 已完成

本轮继续针对高频真实交互收口，没有改变 Post 数据模型或主视觉结构：

- 首页 / 版块的点赞、收藏从单一 `pendingId` 改为 per-topic `ReadonlySet`，不同主题同时操作不会互相清 spinner / disabled。
- 收藏页与个人主页的主题收藏同步使用 per-topic pending Set，并阻止同一主题重复提交。
- TopicRow 的点赞 / 收藏操作与主题打开边界由契约测试锁定，操作按钮不会误触详情。
- feed 离开时保存 scroll；进入非 feed 页面置顶；首次进入另一个 feed 从顶部开始；返回原 feed 等待 ready 后恢复位置。
- 移动端不增加第六个底部导航槽位；已登录个人菜单新增“收藏 -> `#bookmarks`”，与私信 / 通知保持功能入口对等。

## 5. 最新门禁

- 11.3 定向：**8 files / 103 tests PASS**
- `src/App.test.tsx`：**59 / 59 PASS**
- 前端全量：**77 files / 564 tests PASS**
- `pnpm typecheck`：**PASS**
- `pnpm build`：**PASS**
- Vite：6.4.3
- production build：**1760 modules transformed**

真实 production：

- 390x844：使用本地 `demo_admin` 登录成功；顶部真实出现个人菜单，底部从“登录”切换为“我的”。
- 390x844：个人菜单真实包含“收藏”；点击后 URL 进入 `#bookmarks`，移动端收藏入口已实际可用。
- 1440x1000：`#hot` 深滚动后打开靠后真实主题，再点击“返回主题列表”可回 `#hot`；scroll 数值保存 / 置顶 / ready 后恢复由独立 hook 契约测试锁定。
- 浏览器事件只有登录前匿名 `/auth/session` 的预期 `401`，未发现新的业务 / JS 错误。

11.2 已提交：`4deaa7b fix: preserve community detail return context`。

## 6. 11.3 当前改动文件

- `src/app/CommunityApp.tsx`
- `src/App.test.tsx`
- `src/components/TopicFeed.tsx`
- `src/components/TopicFeed.test.tsx`
- `src/features/boards/BoardPage.tsx`
- `src/features/boards/BoardTopicFeed.tsx`
- `src/features/feed/useFeedScrollRestoration.ts`
- `src/features/feed/useFeedScrollRestoration.test.tsx`
- `src/components/BookmarksView.tsx`
- `src/components/BookmarksView.test.tsx`
- `src/components/UserProfileView.tsx`
- `src/components/UserProfileView.test.tsx`
- `src/components/SiteHeader.tsx`
- `src/components/SiteHeader.search.test.tsx`
- `src/components/TopicRow.test.tsx`
- `docs/specs/community-ui-phase-2.md`
- `docs/handoff-phase2-2026-09-02.md`

已完成提交链：

- 11.1：`22c006b fix: canonicalize community home navigation`
- 11.2：`4deaa7b fix: preserve community detail return context`

## 7. 下一执行顺序

1. 对 11.3 做 `git diff --check`，只暂存本节列出的 `daoyun/...` 文件并单独提交。
2. 进入 11.4 最终审计：搜索剩余 legacy / 固定 latest fallback、重复 pending 单 ID、桌面 / 移动明显入口断层。
3. 只修复同类残留问题，不再新增 Phase 2 功能范围。
4. 最终重新执行定向 / 全量 / typecheck / build / 390 / 1440 production 门禁。
5. 只有 11.4 审计干净后，才把 Phase 2 标记 **DONE**。

## 8. Git 约束

父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件。只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。

另外，上一轮尝试通过 FastSpider_FS 推送远端时 capability 请求未能完成，因此当前不要把“已 push”写入交接；以本地 Git 事实为准。
