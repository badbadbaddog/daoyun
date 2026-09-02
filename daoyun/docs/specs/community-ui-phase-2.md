# 刀云社区 UI/UX Phase 2

日期：2026-09-02  
状态：**DONE**

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

## 4. 11.3 首页高频交互一致性（DONE）

### 问题

真实交互审计发现四类一致性问题：

- 首页 / 版块的点赞与收藏只维护一个全局 `pendingId`。如果用户快速操作两条不同主题，后一条会覆盖前一条；前一个请求结束时又可能提前清掉第二条的 pending 视觉状态。
- 收藏页和个人主页的主题收藏也存在同样的单 ID 并发问题。
- feed 滚动恢复只处理“已有且大于 0 的保存位置”，从深位置进入详情或切到第一次访问的 feed 时可能继承旧页面的滚动位置。
- 桌面侧栏有“收藏”入口，但移动底部导航刻意保持 5 槽后，已登录移动用户缺少同等直接的收藏入口。

### 实现

- `CommunityApp` 的点赞 / 收藏 pending 改为按 topic ID 管理的 `ReadonlySet<string>`；每个请求只添加和移除自己的 ID，同一主题 pending 时拒绝重复提交，不影响其他主题。
- `TopicFeed`、`BoardPage`、`BoardTopicFeed` 改为消费 per-topic pending Set；不同主题可以同时操作，各自行显示 spinner / disabled。
- `BookmarksView` 与 `UserProfileView` 的主题收藏同步改为 per-topic pending Set，避免并发取消收藏或收藏时互相清状态。
- `TopicRow` 保持明确的事件边界：点赞 / 收藏只执行自身动作，不打开主题；标题 / 封面才进入主题详情。
- `useFeedScrollRestoration` 现在在离开 feed 时保存位置并把非 feed 目标置顶；第一次访问另一 feed 从顶部开始；返回已有 feed 时等待内容 ready 后恢复原位置；已在目标位置时不做多余 `scrollTo`。
- 不扩张移动底部导航槽位；已登录 `SiteHeader` 个人菜单新增 canonical `收藏 -> #bookmarks`，与现有“私信 / 通知 / 会员中心”并列，在 390px 可真实操作。

### 自动化证据

新增并发和边界契约：

- 两条 feed 主题同时点赞：先完成一条不会清除另一条 pending。
- 收藏页两条主题同时取消收藏：每行 pending 独立。
- 个人主页两条主题同时收藏：每行 pending 独立。
- TopicRow 点赞 / 收藏不会触发 `onOpen`，标题点击才打开主题。
- feed -> topic -> feed 恢复保存的滚动位置；未访问过的 feed 从顶部开始。
- 已登录个人菜单的“收藏”链接固定为 `#bookmarks`。

最新门禁：

- 11.3 定向：**8 files / 103 tests PASS**。
- `src/App.test.tsx`：**59 / 59 PASS**。
- 前端全量：**77 files / 564 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**，Vite 6.4.3，**1760 modules transformed**。

### Production 浏览器证据

390x844：

- 使用本地 `demo_admin` 正式登录成功，顶部真实显示“打开个人菜单”，底部真实切换为“我的”。
- 个人菜单真实包含“个人主页 / 会员中心 / 收藏 / 私信 / 通知 / 站点管理 / 退出登录”。
- 点击“收藏”后 URL 正确进入 `#bookmarks`，说明移动端入口对等已经落地，而不是只存在组件测试中。

1440x1000：

- 在 `#hot` 深滚动后打开靠后主题 `治理分页验收主题 11`，详情加载正常；点击“返回主题列表”后 route 回到 `#hot`。
- 精确 scroll position 的保存 / 置顶 / ready 后恢复由 `useFeedScrollRestoration` 数值契约测试锁定；真实 production 流程未出现路由或渲染错误。
- 浏览器事件除匿名 session 探测的预期 `401` 外，没有新的业务 / JS 错误。

## 5. 11.4 Phase 2 最终审计与收口（DONE）

### 审计发现

最终回归没有继续扩张功能，而是找到并收口了三个仍会破坏“首页 = 推荐发现”的历史残留：

- 无 hash 直接打开站点根地址时，`CommunityApp` 会读取历史品牌配置 `homeMode`；本地真实数据仍为 `latest`，因此 production 根地址实际被重定向到 `#feed`。
- 独立后台的“返回社区”仍固定跳到 `latest`，离开管理后台后会进入“最新”而不是 canonical 首页。
- 后台品牌配置仍把“首页模式：最新 / 热门 / 精华”暴露为可编辑项；在首页语义已经固定为推荐后，这会形成一个看似有效、实际不应继续控制前台落点的设置。

### 实现

- Router 把空 hash 与旧 `#top` 一样规范化到 `#hot`；`#feed` 仍明确保留为旧链接兼容的“最新”入口，不改变显式 URL 的历史语义。
- `CommunityApp` 不再使用 `branding.homeMode` 覆盖根地址 canonical route；品牌配置继续负责站点名、主题、颜色、密度等展示设置。
- `AdminApp` 的“返回社区”统一回 `#hot`。
- 后台“首页模式”改为禁用的 `推荐（固定）`，并解释历史数据仍兼容读取；品牌表单保存时把旧值收敛为 `hot`，API DTO / validator 继续接受历史枚举，避免破坏既有后端数据和旧客户端契约。
- 最终静态审计：production TypeScript 中没有继续生成 literal `#top` / `#feed`；`feed: "latest"` 只剩 `FEED_BY_HASH.feed` 的兼容解析入口。点赞 / 收藏高频路径也没有退回单一 pending ID。

### 最终自动化门禁

- 11.4 定向：**4 files / 146 tests PASS**。
- `src/App.test.tsx`：**60 / 60 PASS**。
- 前端全量：**77 files / 566 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**，Vite 6.4.3，**1760 modules transformed**。

### 最终 Production 浏览器证据

390x844：

- 从完全无 hash 的根地址打开，真实 URL 自动规范化为 `#hot`，推荐 Tab 保持选中；旧数据库中的 `homeMode=latest` 不再把入口改回 `#feed`。
- 正式登录本地管理员后进入 `#admin/branding`，真实页面显示禁用的“首页模式 / 推荐（固定）”和兼容说明。
- 点击后台“返回社区”真实回到 `#hot`。

1440x1000：

- 无 hash 根地址同样直接落 `#hot`，桌面“首页”和品牌 Logo 都指向 canonical 推荐首页。
- 正式登录后 `#admin/branding` 同样展示固定推荐模式；点击“返回社区”回到 `#hot`。
- 两个视口的浏览器事件都只有登录前匿名 `/auth/session` 的预期 `401`，没有新增业务 / JS 错误。

### Phase 2 结论

11.1–11.4 已全部完成。Phase 2 已把首页 canonical 语义、详情返回上下文、高频交互并发状态、滚动恢复以及桌面 / 移动关键入口统一到同一套规则；后续工作应作为新的阶段或独立任务开展，不再继续向 Phase 2 增加范围。

## 6. 提交约束

父级 Git 仓库 `C:\Users\111\Documents\Playground` 仍包含大量与 DaoYun 无关的未跟踪项目。Phase 2 继续只允许明确 `daoyun/...` 路径暂存，**禁止 `git add -A`**。
