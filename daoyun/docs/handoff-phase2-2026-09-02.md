# DaoYun Phase 2 交接：2026-09-02

> 当前状态：**IN PROGRESS**。Phase 1 已在 `34b7d1b92e057f47e06d2c65af9985ee35d4d84b` 收口。Phase 2 已开始，11.1 首页 canonical 导航统一已完成实现和验收，下一步进入 11.2 跨页面上下文与返回语义。

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

## 3. 最新门禁

- 11.1 定向：**4 files / 44 tests PASS**
- 前端全量：**77 files / 554 tests PASS**
- `pnpm typecheck`：**PASS**
- `pnpm build`：**PASS**
- Vite：6.4.3
- production build：**1760 modules transformed**

真实 production：

- 1440px：Logo 与桌面首页均为 `#hot`，推荐 Tab 正常。
- 390x844：Logo 与底部移动首页均为 `#hot`，推荐 Tab 正常。

## 4. 当前改动文件

- `src/components/LeftSidebar.tsx`
- `src/components/LeftSidebar.test.tsx`
- `src/components/MobileNavigation.tsx`
- `src/components/MobileNavigation.test.tsx`
- `src/components/SiteHeader.tsx`
- `src/components/SiteHeader.search.test.tsx`
- `src/router/communityRoute.ts`
- `src/router/communityRoute.test.ts`
- `docs/specs/community-ui-phase-2.md`
- `docs/handoff-phase2-2026-09-02.md`

## 5. 下一执行顺序

1. 进入 11.2，审计主题详情 / 用户主页 / 搜索 / 收藏 / 版块详情的来源上下文与返回路径。
2. 优先解决“从版块/搜索进入详情后只能回首页”这类真实导航丢上下文问题。
3. 不引入第二套 router state；继续保持 hash route 为页面状态源。
4. 先定向测试，再全量 / typecheck / build，最后做 390 / 1440 production 验收。
5. Phase 2 仍处于 **IN PROGRESS**，不要因为 11.1 完成就标记整个 Phase 2 DONE。

## 6. Git 约束

父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件。只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。

另外，上一轮尝试通过 FastSpider_FS 推送远端时 capability 请求未能完成，因此当前不要把“已 push”写入交接；以本地 Git 事实为准。
