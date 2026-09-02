# DaoYun Phase 2 交接：2026-09-02

> 当前状态：**IN PROGRESS**。Phase 1 已在 `34b7d1b92e057f47e06d2c65af9985ee35d4d84b` 收口。Phase 2 的 11.1 首页 canonical 导航统一与 11.2 跨页面上下文 / 返回语义均已完成实现和验收，下一步进入 11.3 首页高频交互一致性。

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

## 4. 最新门禁

- `src/App.test.tsx`：**58 / 58 PASS**
- 前端全量：**77 files / 558 tests PASS**
- `pnpm typecheck`：**PASS**
- `pnpm build`：**PASS**
- Vite：6.4.3
- production build：**1760 modules transformed**

真实 production：

- 1440px：搜索 -> 主题 -> 返回，恢复原 `q + type` 搜索 URL。
- 1440px：`#board/general` -> 主题 -> 返回，恢复 `#board/general`。
- 390x844：推荐首页和真实主题详情均正常；当前移动主题详情本身没有桌面“返回主题列表”按钮，未人为新增第二套返回入口；底部首页继续指向 `#hot`。

全量测试首次并发运行曾出现 3 个偶发超时 / 加载等待失败；同一代码随后立即重跑为 **77 / 77 files、558 / 558 tests PASS**，定向 App 测试也独立连续通过，属于测试资源竞争而非可复现功能回归。

## 5. 11.2 当前改动文件

- `src/app/CommunityApp.tsx`
- `src/App.test.tsx`
- `docs/specs/community-ui-phase-2.md`
- `docs/handoff-phase2-2026-09-02.md`

11.1 已单独提交：`22c006b fix: canonicalize community home navigation`。

## 6. 下一执行顺序

1. 先收口并提交 11.2，只暂存上面四个 `daoyun/...` 文件。
2. 进入 11.3：首页高频交互一致性。
3. 优先审计 TopicRow 点击边界、点赞 / 收藏 pending 互锁、桌面 / 移动入口对等、feed 切换滚动恢复。
4. 仍采用“定向测试 -> 全量 -> typecheck -> build -> production 浏览器”的门禁顺序。
5. Phase 2 仍是 **IN PROGRESS**，不要提前标记 DONE。

## 7. Git 约束

父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件。只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。

另外，上一轮尝试通过 FastSpider_FS 推送远端时 capability 请求未能完成，因此当前不要把“已 push”写入交接；以本地 Git 事实为准。
