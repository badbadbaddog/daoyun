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

## 3. 下一优先级

### 11.2 跨页面上下文与返回语义

审计主题详情、个人主页、搜索、收藏、版块详情中的“返回 / 关闭 / 清空搜索”路径：

- 从推荐进入详情，应尽量回到推荐及原滚动位置。
- 从版块进入详情，应优先回到对应版块，而不是无条件回首页。
- 从搜索进入详情，应保留搜索 query / scope。
- 避免用浏览器 history 与 hash route 形成双重状态源；现有 `useHashRoute` 仍作为单一页面状态源。

### 11.3 首页高频交互一致性

在不改变 Post 数据模型的前提下继续审计：

- 卡片点击区域与操作按钮的事件边界。
- 点赞 / 收藏 pending 时其他动作是否被无意义锁死。
- 桌面右栏与移动端是否存在功能入口不对等。
- 推荐 / 关注 / 最新切换后的滚动恢复与视觉反馈。

## 4. 提交约束

父级 Git 仓库 `C:\Users\111\Documents\Playground` 仍包含大量与 DaoYun 无关的未跟踪项目。Phase 2 继续只允许明确 `daoyun/...` 路径暂存，**禁止 `git add -A`**。
