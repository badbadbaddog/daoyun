# DaoYun Phase 2 交接：2026-09-02

> 当前状态：**DONE**。Phase 1 已在 `34b7d1b92e057f47e06d2c65af9985ee35d4d84b` 收口。Phase 2 的 11.1 首页 canonical 导航统一、11.2 跨页面上下文 / 返回语义、11.3 首页高频交互一致性、11.4 最终审计与收口均已完成实现、自动化门禁和真实 production 验收。

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

## 5. 11.4 最终审计已完成

最终审计找到并修复了三个同类 canonical 残留：

- 真实 production 无 hash 根地址此前会被历史 `branding.homeMode=latest` 覆盖到 `#feed`；现在空 hash 在 router 层直接 canonicalize 为 `#hot`，`CommunityApp` 不再用品牌 homeMode 覆盖根路由。
- 独立后台“返回社区”从固定 `latest` 改为 canonical `hot`。
- 后台品牌配置的“首页模式”不再提供最新 / 热门 / 精华三个看似可变的选择，而是显示禁用的“推荐（固定）”；旧 API / 数据枚举仍兼容读取，品牌保存会把历史值收敛为 `hot`。

静态审计结果：production TypeScript 不再生成 literal `#top` / `#feed`；`feed: "latest"` 只保留 `FEED_BY_HASH.feed` 的旧链接解析用途。点赞 / 收藏高频实现也没有残留单一 pending ID。

## 6. 最终门禁

- 11.4 定向：**4 files / 146 tests PASS**
- `src/App.test.tsx`：**60 / 60 PASS**
- 前端全量：**77 files / 566 tests PASS**
- `pnpm typecheck`：**PASS**
- `pnpm build`：**PASS**
- Vite：6.4.3
- production build：**1760 modules transformed**

真实 production：

- 390x844：无 hash 根地址真实规范化为 `#hot`；正式管理员登录后 `#admin/branding` 显示禁用的“首页模式 / 推荐（固定）”；点击“返回社区”真实回 `#hot`。
- 1440x1000：无 hash 根地址同样进入 `#hot`；桌面后台品牌页显示同一固定推荐语义，点击“返回社区”回 `#hot`。
- 两个视口浏览器事件都只有登录前匿名 `/auth/session` 的预期 `401`，未发现新的业务 / JS 错误。

## 7. 11.4 收口改动文件

- `src/app/AdminApp.tsx`
- `src/app/CommunityApp.tsx`
- `src/router/communityRoute.ts`
- `src/router/useHashRoute.test.tsx`
- `src/components/AdminView.tsx`
- `src/components/AdminView.test.tsx`
- `src/App.test.tsx`
- `docs/specs/community-ui-phase-2.md`
- `docs/handoff-phase2-2026-09-02.md`

已完成提交链：

- 11.1：`22c006b fix: canonicalize community home navigation`
- 11.2：`4deaa7b fix: preserve community detail return context`
- 11.3：`92b6a90 fix: stabilize community feed interactions`
- 11.4：本交接与最终代码一起收口提交；以本地 Git 最新提交事实为准，不在提交内自引用 SHA。

## 8. 后续边界

Phase 2 已经完成，不再继续追加功能。后续若继续优化，应新开阶段 / 独立任务，并以当前规则为基线：首页 canonical `#hot`、详情返回保留来源上下文、feed 滚动恢复、per-topic pending、桌面 / 移动关键入口一致。

## 9. Git 约束

父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件。只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。

另外，上一轮尝试通过 FastSpider_FS 推送远端时 capability 请求未能完成，因此当前不要把“已 push”写入交接；以本地 Git 事实为准。
