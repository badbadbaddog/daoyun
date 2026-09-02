# 刀云社区 UI/UX Phase 2

日期：2026-09-02  
状态：**IN PROGRESS**

## 1. 阶段目标

Phase 1 已完成首页、版块、主题详情、个人主页、会员身份、后台视觉与推荐排序的基础重构。Phase 2 不再大改视觉框架，重点处理真实使用过程中容易产生认知错位的导航语义、跨页面上下文、返回路径与高频交互一致性。

核心原则：

- “首页”永远代表推荐发现，不得悄悄落到最新流。
- 内部新生成链接只发 canonical route；旧 hash 仅保留兼容解析，不继续由新 UI 发出。
- 不为了视觉统一破坏显式的“推荐 / 关注 / 最新”内容语义。
- 每个小阶段都必须有组件 / 路由契约测试、前端全量、typecheck、production build 与真实浏览器证据。

## 2. 11.1 首页 canonical 导航统一（DONE）

### 问题

Phase 1 已把默认 `#top` 解析为推荐流 `#hot`，但桌面左侧“首页”仍指向 `#feed`。而 `#feed` 为兼容旧链接被明确保留为“最新”。因此桌面用户在推荐页点击“首页”会意外切换到最新流；移动端和品牌 Logo 又使用 `#top`，形成三套首页入口语义。

### 实现

- 桌面 `LeftSidebar` 的“首页”改为 canonical `#hot`。
- 移动 `MobileNavigation` 的“首页”从 legacy `#top` 改为 canonical `#hot`。
- `SiteHeader` 品牌 Logo 从 legacy `#top` 改为 canonical `#hot`。
- `formatRoute()` 对非法 board / topic / user 内部 route 的兜底从 `#feed` 改为 `#hot`，避免内部错误对象把用户送到“最新”。
- `#top` 与 `#feed` 解析兼容仍保留：`#top -> hot`，`#feed -> latest`，不破坏旧 URL。

### 自动化证据

- 定向：**4 files / 44 tests PASS**。
- 前端全量：**77 files / 554 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**，Vite 6.4.3，**1760 modules transformed**。

### Production 浏览器证据

1440px：

- 品牌 Logo `刀云首页` -> `#hot`。
- 左侧“首页” -> `#hot`。
- 当前推荐 Tab 保持选中。

390x844：

- 品牌 Logo -> `#hot`。
- 底部“移动端首页” -> `#hot`。
- 推荐 Tab 保持选中。

未修改布局 CSS，本阶段不引入新的横向溢出风险。

## 3. 11.2 跨页面上下文与返回语义（DONE）

### 问题

此前 `CommunityApp.closeMainView()` 无论详情从哪里进入，都会固定跳到 `latest`。因此：

- 从推荐 / 关注进入详情后会丢失 feed 语义。
- 从版块进入主题后“返回主题列表”会离开当前版块。
- 从搜索进入主题后会丢失 query / scope。
- 直接 deep-link 打开主题时也会被送到“最新”，与 canonical 首页语义冲突。

### 实现

- 保持 hash route 为唯一页面状态源，没有引入 React Router history 或第二套 URL 状态。
- `CommunityApp` 只为可返回的详情型 route 维护轻量来源栈：topic / user / bookmarks / messages / notifications。
- 进入详情时记录前一条完整 `CommunityRoute`；返回时恢复原 route，因此搜索的 query / scope、版块 slug、关注 feed 都可以精确恢复。
- 同一详情内部变化不会重复压栈，例如同一 topic 的 reply 定位、同一 messages 里的 conversation 切换。
- 通过返回动作恢复 route 时不会再次把来源压入栈，避免 A -> B -> 返回 A 后形成循环。
- 没有可恢复来源的 direct deep-link 安全回到 canonical 推荐首页 `#hot`。
- OIDC claim 完成后的默认落点也统一为 `#hot`。

### 自动化证据

新增契约覆盖：

- direct topic -> 返回 `#hot`。
- search `q + type` -> topic -> 返回原搜索 URL。
- board -> topic -> 返回原 board。
- following -> user profile -> 返回 `#following`。

最新门禁：

- `src/App.test.tsx`：**58 / 58 PASS**。
- 前端全量：**77 files / 558 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**，Vite 6.4.3，**1760 modules transformed**。

### Production 浏览器证据

1440px：

- 搜索 `本地自动回归主题` / `type=topics` -> 打开真实主题 -> “返回主题列表”后完整恢复原搜索 hash。
- `#board/general` -> 打开真实主题 -> “返回主题列表”后恢复 `#board/general`。

390x844：

- 推荐首页与主题详情生产构建均正常。
- 移动主题详情当前设计没有桌面版“返回主题列表”按钮，因此本阶段未伪造一个新入口；底部 canonical 首页仍为 `#hot`。

## 4. 下一优先级

### 11.3 首页高频交互一致性

在不改变 Post 数据模型的前提下继续审计：

- 卡片点击区域与操作按钮的事件边界。
- 点赞 / 收藏 pending 时其他动作是否被无意义锁死。
- 桌面右栏与移动端是否存在功能入口不对等。
- 推荐 / 关注 / 最新切换后的滚动恢复与视觉反馈。

## 5. 提交约束

父级 Git 仓库 `C:\Users\111\Documents\Playground` 仍包含大量与 DaoYun 无关的未跟踪项目。Phase 2 继续只允许明确 `daoyun/...` 路径暂存，**禁止 `git add -A`**。
