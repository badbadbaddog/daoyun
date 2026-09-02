# DaoYun 当前社区 UI / UX 设计方案

> 状态：当前推荐方向，作为前台社区体验后续实现与验收基线。
>
> 产品定位：**内容发现型社区**。不是传统论坛换皮，也不是小红书克隆；首页负责发现，版块负责归属，详情负责讨论，个人主页负责身份，会员体系负责长期成长。

## 1. 核心设计公式

- 小红书式发现：让有图、有现场感、有生活感的内容更容易被看到，但不做纯瀑布流。
- 葫芦侠式社区：版块有明确归属、层级和社区身份，允许父版块 / 子版块共存。
- 闲鱼式真实感：界面克制、信息直接、不过度 SaaS 化，不堆大圆角卡片和装饰性渐变。
- 论坛式讨论：主题详情和回复必须有强讨论结构，楼层、引用、点赞、回复、编辑、举报等行为清晰可达。

全站继续坚持一个 Post 模型和一个统一发布器；内容形态由数据决定，不要求用户发布前选择“图文 / 纯文字”类型。

## 2. 产品信息架构

### 2.1 首页：逛 / 发现

首页固定三个主视图：

1. **推荐**：默认首页，面向发现。
2. **关注**：只看关注作者。
3. **最新**：纯时间流，保留高信息密度。

路由约定：

- `#top` 规范化到 `#hot`，表示推荐首页。
- `#feed` 继续表示最新流，兼容旧分享链接。
- 不增加第四个“精选 / featured”首页 Tab。

首页标题使用“社区发现”，不再使用“社区动态”这类后台 / Dashboard 语气。

### 2.2 版块：归属

版块不是“圈子”，不显示虚构成员数。一级版块、子版块都是真实社区版块。

版块目录：

- 顶部保留搜索。
- 增加“活跃版块”入口，只提升一级版块。
- 子版块必须留在父版块上下文中，不能越级进入活跃入口。
- 活跃排序使用现有真实主题数量 / 活跃数据，不造“热度分”或成员数。
- 搜索时隐藏活跃推荐区，只显示搜索结果和父版块上下文。

版块详情：

- 版块名称、简介、子版块、发布入口是第一层信息。
- 用户语言使用“可参与 / 可发布 / 仅浏览”等，不显示“附件上传能力”“版块类型”等后台口吻。
- 主排序：最新 / 活跃 / 热门 / 精华。
- 版块热门允许“本版置顶”优先，因为置顶只属于该版块的治理语义。
- 版块主题列表保持论坛式紧凑列表，即使主题有图片，也不能被首页大图卡样式污染。

### 2.3 主题详情：讨论

视觉顺序：

1. 社区路径 / 版块归属
2. 标题
3. 作者真实身份
4. 正文
5. 点赞 / 收藏 / 回复 / 分享 / 举报
6. 回复讨论

作者身份区展示真实公开数据：

- 昵称 / 用户名
- 等级
- 明确公开的社区组
- 明确公开的勋章

不能为了视觉效果伪造等级、称号、勋章，也不能暴露积分、权益、内部组等私有会员数据。

回复区继续强化论坛讨论结构：

- 服务端楼层号
- 引用回复
- 回复点赞
- 编辑 / 删除 / 举报
- 每层作者公开会员身份

### 2.4 个人主页：身份

个人主页是社区身份资产页，不是设置页。

优先显示：

- 头像、昵称、用户名
- 真实等级与成长身份
- 公开社区组
- 公开勋章
- 关注 / 粉丝 / 主题数量
- 主题 / 回复 / 收藏 / 勋章等内容切换
- 最近活跃版块

会员中心仍承载私有成长详情、积分、权益等；公开主页只暴露公开摘要。

## 3. 首页内容卡设计

### 3.1 纯文字讨论帖

保持高密度论坛流：

- 左侧作者头像。
- 标题 1～2 行。
- 摘要最多约 2 行。
- 标签、版块、作者、等级、发布时间在次级信息层。
- 回复 / 点赞 / 浏览保持轻量指标。
- 使用分割线形成连续内容流，不做“卡片套卡片”。

### 3.2 媒体帖

只有 `topic.imageUrl` 真实存在时才进入媒体布局；站点默认封面不能把纯文字讨论伪装成图文内容。

首页媒体帖：

- 图片承担主要发现视觉。
- 390px 移动端优先大图，标题、作者、互动信息在图下自然承接。
- 桌面端允许图片获得更高权重，但主 Feed 仍以单列为主，避免变成 Pinterest 瀑布流。

版块媒体帖：

- 仍保持紧凑论坛列表。
- 版块页面不复制首页的“大图发现卡”。

组件层已经通过 `feed / board` variant 明确区分两种呈现边界。

## 4. 推荐流设计

推荐不是“最新换名字”。

### 4.1 当前热度信号

当前真实可靠信号：

- 主题点赞
- 有效回复

浏览数暂不作为推荐核心信号，因为当前真实浏览计数写路径尚不完整。

热度分由 PostgreSQL 派生维护：

```text
hot_score = 8 × topic_like_count + 12 × valid_reply_count
```

要求：

- 点赞 / 取消点赞自动重算。
- 回复创建自动重算。
- 回复删除、治理隐藏后按有效回复数量重算。
- 调用方不能直接伪造热度；数据库 trigger 保持不变量。

### 4.2 推荐与版块置顶分离

全站推荐不能被某一个版块的置顶帖天然劫持。

语义：

- **全站推荐**：`hot_score DESC → published_at DESC → id DESC`。
- **版块热门**：允许 `(pinned DESC → hot_score DESC → published_at DESC → id DESC)`。

因此“本版置顶”只在该版块生效，不代表“全站推荐”。

## 5. 桌面端结构

目标宽度：320 / 768 / 1024 / 1440 均需支持。

桌面首页继续使用三栏，但降低“后台 Dashboard”感：

- 左栏：首页、关注、社区、收藏、常用版块、会员中心入口。
- 中栏：真正的内容主舞台。
- 右栏：热帖 / 活跃版块 / 登录等辅助信息，视觉权重明显低于主内容。

右栏尽量使用排版、分割线、紧凑列表，不堆多层圆角 Card。

## 6. 移动端结构

390px 作为重点验收尺寸。

顶部：

```text
刀云                      搜索  主题/账号
```

- 不常驻完整搜索框。
- 点击搜索图标后展开搜索输入。
- 支持 Enter 搜索、Esc 收起。
- 桌面 Ctrl/Cmd + K 搜索行为继续保留。

底部固定导航：

```text
首页   社区      +      通知   我的/登录
```

移动端目标：内容优先、单手操作、弱化桌面侧栏思维。

## 7. 视觉语言

关键词：**浅色、克制、真实、紧凑、内容优先**。

- 页面背景：极浅灰。
- 主内容：白色或接近白色。
- 正文：深灰黑。
- 次级文字：中灰 / 浅灰。
- 边框：很淡，主要靠排版和留白分层。
- 品牌蓝：按钮、选中 Tab、链接、Focus，不大面积铺底。
- 卡片圆角不超过 8px。
- 减少渐变、玻璃拟态、巨型圆角、卡片套卡片，避免“AI 模板味 / SaaS 后台味”。
- 控件图标继续使用 Lucide。
- Icon-only 控件必须有 accessible label / tooltip。

## 8. 会员身份公开边界

社区场景统一读取公开会员摘要接口，并做共享缓存 / 请求去重。

公开：

- Growth Level
- Public Medals
- Explicitly Public Community Groups

禁止公开：

- 积分余额
- 私有权益
- 内部组
- 管理额度 / 内部会员字段

同一个作者在一页出现多次时只请求一次公开会员摘要，避免 N+1。

## 9. 技术实现边界

当前前端继续使用 React 19 + TypeScript + Vite，不为了 UI 重设计迁移 Nuxt。

已经建立 / 继续保持：

- `src/styles.community.css`：新社区体验样式层。
- 不继续无边界扩张 9000+ 行的旧 `styles.css`。
- `TopicRow` 明确 `feed / board` variant。
- 路由、行为和视觉改造均优先补测试再实现。

后续逐步拆分：

- FeedRoute
- BoardRoute
- TopicRoute
- ProfileRoute
- MembershipRoute
- tokens / layout / feed / board / topic / profile / membership / responsive 样式模块

## 10. 当前已落地设计

截至本设计稿：

- 首页已改为“社区发现”。
- 首页默认进入推荐流：`#top` 规范化到 `#hot`；`#feed` 保留为“最新”兼容入口。
- 首页媒体帖 / 纯文字讨论帖已建立不同视觉层级。
- 版块主题列表与首页媒体卡已经视觉解耦；同一媒体主题在首页强调发现，在版块页保持紧凑论坛列表。
- 版块目录已有活跃一级版块入口，子版块不越级，搜索时活跃推荐自动让位。
- 版块头部已去掉后台能力字段口吻。
- 公开真实等级 / 勋章 / 公开组已接入帖子、主题详情、回复和个人主页，并做共享缓存 / 请求去重。
- 移动顶部搜索已收成展开式入口，保留 Enter、Escape 和桌面 Ctrl/Cmd+K。
- 390px 底部社区导航保留。
- 推荐热度已从无真实写路径的静态 `hot_score` 修为数据库派生不变量。
- 全站推荐已经与版块置顶彻底解耦，并完成持久库、API 与 390px 真浏览器验收。

### 10.1 当前推荐实现

当前第一阶段推荐不做用户画像，也不依赖 Redis / Elasticsearch。先保证“互动真的能改变推荐顺序”以及排序可解释、可测试、可稳定分页。

热度派生公式：

```text
hot_score = 8 × topic_like_count + 12 × valid_reply_count
```

约束：

- PostgreSQL trigger 在主题 `like_count / reply_count` 变化时自动重算 `hot_score`。
- 调用方即使直接写入假的 `hot_score`，数据库也会按真实计数覆盖。
- 点赞 / 取消点赞、回复创建、回复删除、治理隐藏回复都会通过真实计数变化自动同步热度。
- 当前 `view_count` 没有可靠的真实递增写路径，因此暂不进入推荐公式，避免把不可信计数当排序信号。
- 全站 `recommended` 按 `hot_score DESC → published_at DESC → id DESC` 排序，不看版块 `pinned_at`。
- 指定版块的 `popular` 继续保留“版块置顶优先”，所以“版块运营置顶”和“全站内容推荐”是两个不同语义。
- 新增全站推荐专用索引，避免规模扩大后退化为无索引全表排序。

相关 migration：

- `202609020001_derive_topic_hot_score_from_engagement`
- `202609020002_add_global_recommended_topic_index`

真实验收：

- 两条 migration 已在持久 `daoyun_dev` 中登记为 `success=true`。
- 数据库按热度排序得到的前 8 个主题 ID，与 `/api/v1/feed?mode=recommended&limit=8` 返回顺序逐项一致。
- 390px 真浏览器 `#hot` 首条为当前真实最高互动主题；原本 0 点赞但版块置顶的测试主题不再劫持全站推荐首位。
- Rust `cargo fmt --all -- --check`：PASS。
- Rust `cargo clippy --workspace --all-targets -- -D warnings`：PASS。
- `infrastructure --test topics`：21 / 21 PASS。
- `daoyun-api --test topics`：20 / 20 PASS。

### 10.2 本地验收数据与产品推荐隔离

治理工作台仍需要稳定的分页 fixture，因此保留：

- 24 条“治理分页验收主题”。
- 23 条处理记录。
- 跨版块移动、置顶、治理、分页等自动化能力。

但 seed 不再伪造公开互动：

- `reply_count = 0`
- `like_count = 0`
- `view_count = 0`

原因是这些 fixture 原先只有聚合数字，没有真实 reply / like 记录，会造成“列表显示 3 条回复但详情没有回复”等数据矛盾，也会错误污染推荐热度。

清理后真实 390px `#hot` 验收：

- 首页前排先展示确有真实回复的社区主题。
- 24 条治理分页 fixture 保留在数据库和治理工作台，但不再以虚假的高互动占据推荐首屏。
- `scripts/local-development.test.mjs` 新增约束，禁止 moderation seed 再恢复 `index % 6 / index × 2 / index × 37` 这类伪造公开指标。
- seed 定向测试：9 / 9 PASS。

### 10.3 回复区社区讨论层级与楼层深链

回复区已经从“头像 + 一行元信息 + 正文”调整为更明确的社区讨论层级：

- 作者显示名、`@username`、公开等级 / 勋章 / 公开组归为身份层。
- 发布时间、编辑状态和楼层号归为上下文层，楼层号不再只是装饰文本。
- 引用块明确显示“引用第几楼”、被引用用户显示名、用户名和摘要。
- 回复 / 点赞 / 举报与作者自己的编辑 / 修订 / 删除操作保持分组，不和身份信息争夺视觉层级。
- 移动端保持紧凑，但仍保留作者身份、楼层、引用和主要互动入口。

楼层链接不使用裸 `#reply-<id>`，因为这会与 SPA hash 路由冲突。现在采用可分享主题内深链：

```text
#topic/<topicId>?reply=<replyId>
```

行为约束：

- 直接打开 deep-link 时保留主题路由，不回退首页。
- 目标楼层已在首屏时，回复列表加载后自动聚焦该楼层。
- 目标楼层在后续分页时，自动沿现有 reply cursor 加载，直到找到目标楼层或没有更多回复。
- 点击楼层号和点击引用块都使用同一 canonical deep-link。
- 无效 `reply` UUID 被忽略，但合法主题路由仍保留。

验收：

- 路由 + TopicDetail 定向：59 / 59 PASS。
- 前端全量：76 files / 541 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，1759 modules transformed。
- 390px production 真浏览器：点击 `#2` 后 URL 保持在同一主题并附带 `?reply=<第2楼ID>`；再点击“引用 #1”正确切换为第 1 楼 deep-link，不再掉回首页。
- 浏览器事件只有访客 `/auth/session` 401，属于预期匿名探测；未发现新的 JS / CSS 页面错误。

### 10.4 个人主页作为社区身份资产页

个人主页已经把“公开社区身份”和“本人账号设置”拆成两个不同层级：

- 公开头部只保留头像、显示名、用户名、简洁身份 badge、社交动作、简介、加入时间和关系统计。
- 新增独立 `社区身份` 区域，使用现有公开 membership summary 展示真实成长等级、等级说明、公开组和公开勋章。
- 公开勋章不再只是无文字的图片行，而是“图标 + 可读名称”的身份资产项。
- 公开组只显示 `displayName`，不向前台泄露 `internalKey`。
- 没有公开勋章时明确显示“还没有公开勋章”，不为了视觉完整伪造数据。
- 本人原有的设备会话、修改密码、登录方式、Passkey、MFA 全部保留，但移动到 `仅自己可见的账号管理` 区域，不再和公开身份挤在同一头部。
- 别人的主页和匿名访客永远不渲染该私有账号管理区域。

真实本地数据验收：

- `demo_member` 当前真实公开等级为 `Lv1`。
- 当前没有公开组、没有公开勋章，因此 production 页面只展示真实 Lv1 和“还没有公开勋章”，没有制造演示身份。
- 390px 与 1440px production 真浏览器均验证公开身份区正常，匿名访问不出现账号安全工具。
- 浏览器事件仍只有匿名 `/auth/session` 401，属于预期探测。
- `UserProfileView` 定向：14 / 14 PASS。
- 前端全量：76 files / 543 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，1759 modules transformed。

### 10.5 首页内容视觉混排节奏

首页没有在客户端重排推荐结果，`TopicFeed` 仍严格按 API 返回顺序渲染，服务端推荐排序和 cursor 分页保持唯一顺序来源。

当前只做展示层节奏：

- 媒体主题继续使用“发现型”媒体布局，不因为回复数变成文字讨论卡。
- 仅首页 `feed`、仅纯文字 `discussion`、且真实 `reply_count >= 2` 的主题标记为 `conversation` 节奏。
- `conversation` 只增加克制的左侧强调、浅背景和标题层级，不增加虚假的“热门”文案，也不使用点赞 / 浏览去冒充讨论强度。
- 1 条或 0 条回复的文字主题保持普通紧凑论坛阅读节奏。
- 版块主题列表永远不吃 `conversation` 首页强调，即便它有很多回复。
- 媒体内容与文字内容相邻时只增加少量垂直留白，让内容形态切换更自然，不改变 DOM 顺序。

验收：

- `TopicRow + TopicFeed` 定向：9 / 9 PASS。
- 前端全量：76 files / 544 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，1759 modules transformed。
- 1440px production `#hot`：前 3 条仍按服务端顺序为“啊实打实打算阿松大 / asdasd / 本地自动回归主题 83c5561c”，三条真实 2 回复主题没有被客户端换序。
- 390px production `#hot`：顺序与桌面一致，2 回复文字讨论保持紧凑但有讨论重点层级，1 / 0 回复内容保持普通层级，移动底栏与互动入口无退化。
- 浏览器事件只有匿名 `/auth/session` 401，属于预期探测。

### 10.6 会员中心形成连续的个人成长体验

会员中心不再把等级、积分、用户组、权益和勋章并排做成五张后台式数据卡，而是先回答用户最关心的“我现在是谁、离下一阶段还有多远、我拥有什么”。

当前结构：

- 顶部保留 `概览 / 成长 / 积分 / 权益 / 勋章` 五个稳定栏目，不修改已有会员 API 和路由语义。
- 概览新增独立 `我的成长概览`：当前真实等级与 EXP 进度是主叙事，下一等级差值直接可读。
- 积分、当前权益、公开勋章作为三项真实资产摘要，可直接进入对应 `#member/points`、`#member/benefits`、`#member/medals`。
- 社区用户组继续作为身份的一部分展示，但概览不会暴露内部 group key。
- 下方积分记录、用户组、权益、勋章改为扁平分区，不重新堆成仪表盘卡片。
- `Growth Level / Points / Standard Entitlement / Medals / Community Group` 等前台英文后台术语已替换为“成长进度 / 可用积分 / 当前权益 / 身份勋章 / 社区身份组”。
- 390px 下等级主叙事单列，三项资产摘要横向并列，详细分区继续单列；移动底部“我的”入口保持不变。

真实登录态验收：

- 使用本地正式登录流程登录 `demo_member`，未注入 mock session。
- 真实数据为 `Lv1 / 0 EXP / 距离 Lv2 还需 100 EXP / 0 积分 / 0 项权益 / 0 枚公开勋章 / 基础组“注册会员”`，页面没有制造演示资产。
- 390px production：概览、积分、权益、勋章三个摘要入口均真实更新 canonical hash；底部导航与账号状态正常。
- 1440px production：主成长概览 + 右侧资产摘要 + 下方双列扁平详细区正常，右侧社区信息栏仍保持原行为。
- 浏览器事件只有登录前匿名 `/auth/session` 401，属于预期探测。
- 会员中心 + 响应式定向：13 / 13 PASS。
- 前端全量：76 files / 545 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，1759 modules transformed。

### 10.7 后台统一 shell 与治理工作台契约修复

后台第一阶段不重写各业务 API，而是先消除“普通站点管理”和“内容治理”像两个不同产品的问题：

- 全部管理模块统一使用 `刀云站点管理 / 管理后台` 品牌，不再让内容治理切换成另一套后台品牌。
- 顶部统一保留返回社区、主题切换与当前管理员身份；内容治理不再把管理员身份单独搬到底部侧栏。
- 全部模块统一使用同一套左侧管理导航、模块级可见 H1 与描述；内容治理的蓝色只作为工作台内部状态/治理语义，不再改变外围 shell。
- 后台体验层独立拆到 `src/styles.admin.css`，加载顺序为基础样式 → 前台社区体验层 → 后台管理体验层，避免后台表格/表单规则反向污染前台。
- 900px 以下统一切换为 `管理模块` 选择器；桌面侧栏隐藏，模块路由与权限过滤逻辑保持原样。

真实 production 验收时同时发现并修复了一条统一 Post 契约缺口：社区已经允许只有正文、标题为空的主题，但治理前端 DTO 校验仍要求 `title` 非空，导致真实治理队列整页报“内容治理主题响应格式无效”。现在：

- 治理 API 客户端仍严格要求 `title` 为字符串，但允许合法的空字符串。
- 治理列表统一使用 `title → excerpt → “无标题主题”` 作为可读显示名。
- 主题链接、操作按钮、操作菜单和确认弹窗全部复用同一显示名，因此正文帖不会产生空标题或空无障碍名称。
- 没有放宽 UUID、作者、版块、状态、revision、分页 request-id 等其他响应校验。

验收：

- 新增/更新治理 API + 治理列表定向：25 / 25 PASS。
- `AdminView + responsive` 定向：51 / 51 PASS。
- 前端全量：76 files / 547 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，Vite 6.4.3，1760 modules transformed。
- 1440px production 使用正式 `demo_admin` 登录：`工作台 → 内容治理` 切换时品牌、顶部管理员、左导航和模块 H1 保持同一 shell；真实主题治理队列成功加载，原“内容治理主题响应格式无效”已消失。
- 390px production：桌面侧栏正确隐藏，`管理模块` 选择器可见；工作台与内容治理都使用同一移动 shell，治理队列、板块切换、搜索和底部 `筛选 / 刷新 / 加载更多` 工具栏正常。
- 浏览器事件只有登录前匿名 `/auth/session` 401，属于预期探测；未发现新的 JS / CSS 页面错误。

### 10.8 后台任务面板统一视觉基线

在统一 shell 之后，第二阶段只收敛后台业务面板的视觉语法，不重写各模块 DOM、权限或 mutation：

- `admin-panel__heading` 统一为 48px 基准高度、底部分隔线和紧凑标题层级，用户、举报、权限、会员、插件等模块不再各自长出不同的页内头部节奏。
- `admin-badge` 统一为 26px 紧凑状态标签，继续表达模块自己的真实状态，不新增演示数字。
- 用户搜索与举报状态筛选统一到 38px 控件密度；用户搜索、状态下拉、搜索按钮在桌面形成同一工具条。
- `user-admin-workspace` 与 `report-workspace` 继续保留各自业务结构，只统一边界和阴影语义，不把用户管理和举报处理强行改成同一种 DOM。
- 560px 以下任务 heading 纵向堆叠，badge 左对齐；用户搜索筛选变成单列，避免 390px 横向挤压。
- 新增 `src/styles.admin.test.ts` 作为后台视觉契约，防止后续模块重新把 heading、badge、筛选密度和移动单列规则改散。

验收：

- 后台视觉契约：3 / 3 PASS。
- 用户管理、举报处理、角色权限、插件、运维、AdminView + 视觉契约定向：7 files / 85 tests PASS。
- 前端全量：77 files / 550 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，Vite 6.4.3，1760 modules transformed。
- 390px production 正式 `demo_admin`：`#admin/users` 搜索 / 状态 / 按钮单列且真实 2 位用户正常；`#admin/reports` 5 个状态筛选、空举报队列与统一移动 shell 正常。
- 1440px production：用户管理的二级 heading、用户数 badge、搜索工具条和列表/详情边界清晰；举报处理的状态筛选、待处理 badge 与队列/详情双栏保持同一视觉节奏。
- 浏览器事件只有登录前匿名 `/auth/session` 401，属于预期探测；未发现新的 JS / CSS 页面错误。

### 10.9 后台内层分组视觉基线

第三阶段继续只收敛后台视觉语法，不修改业务 JSX、权限判断、API 或 mutation：

- `admin-form__heading` 统一内层分组标题、间距与分隔线节奏，角色权限、会员经济、插件、运维不再使用互相漂移的小标题样式。
- `authorization-section`、`operations-section` 与 `plugin-row` 统一为克制的 surface / border / 6px radius，保留各模块原有业务结构。
- 危险操作继续由各模块自己的 danger button、确认流程和权限边界负责，通用视觉规则不覆盖危险语义。
- `src/styles.admin.test.ts` 从 3 条视觉契约扩展到 5 条，防止内层 heading、surface 与移动端规则回退。

验收：

- 后台内层视觉契约：5 / 5 PASS。
- 角色权限 + 会员入口 + 插件 + 运维定向：5 files / 70 tests PASS。
- 前端全量：77 files / 552 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，Vite 6.4.3，1760 modules transformed。
- 1440px production 正式 `demo_admin`：`#admin/authorization`、`#admin/membership`、`#admin/plugins`、`#admin/operations` 的分组、列表行、表单和危险操作层级均保持清晰。
- 390x844 production 正式 `demo_admin`：`#admin/authorization` 长权限清单、角色目录 / 新建角色 / 角色分配，以及 `#admin/plugins` 空态与 4 步安装向导均正常；两页 `documentElement.clientWidth = 390`、`scrollWidth = 390`、`body.scrollWidth = 390`，未发现任何越界元素。
- 浏览器事件只有登录前匿名 `/auth/session` 的预期 401；未发现新的 JS / CSS / API 业务错误。

### 10.10 历史视觉规则清理与 ownership 收口

本阶段不改变产品结构和业务行为，只把已经由 `styles.community.css` / `styles.admin.css` 接管的历史视觉声明从 `styles.css` 中移除，并把测试改成验证当前真实 ownership：

- 按小批次清理 community shell/feed、会员中心、个人主页、主题列表、主题详情/回复、版块页和后台共享 surface；每批清理后都跑对应定向测试，没有一次性大范围删除。
- `styles.admin.test.ts` 从 5 条扩展到 6 条，新增“后台共享 surface 不得重新回流到 legacy stylesheet”的 ownership 契约。
- `styles.responsive.test.ts` 不再错误要求已经迁移到 `styles.community.css` 的视觉声明仍存在于 `styles.css`，而是分别验证结构基础层与社区体验层的真实责任边界。
- 最终静态审计：community 与 admin 均达到 `safeShadowedDecls = 0`、`exactSelectorBodies = 0`；即当前可证明被后置体验层完全覆盖的同选择器声明已经清零。
- `src/styles.css` 从本阶段开始时约 269,706 bytes 降到 **263,000 bytes**；最终 production CSS 为 `dist/assets/index-B6hWqG_0.css`，**258.37 kB / 38.82 kB gzip**。

最终验收：

- 前端全量：**77 files / 553 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**，Vite 6.4.3，**1760 modules transformed**。
- 390x844 production 正式 `demo_admin`：`#hot`、`#boards`、主题详情、`#user/demo_admin`、`#member`、`#admin/authorization`、`#admin/plugins` 均真实加载；所有复核页 `clientWidth = scrollWidth = body.scrollWidth = 390`，未发现页面级横向溢出。
- 1440px production：上述关键社区 / 后台路由均真实加载，`clientWidth = scrollWidth = body.scrollWidth = 1440`，未发现页面级横向溢出。
- 移动端主题详情 / 个人主页因 lazy chunk 首次加载略慢，增加等待后均能正常渲染；不是路由或样式回退。
- 浏览器事件只有登录前匿名 `/auth/session` 的预期 401；未发现新的 JS / CSS / API 业务错误。

### 10.11 最终仓库收口与推荐分数极值边界

最终全仓验证期间发现一个此前定向测试没有暴露的数据库极值问题：当 `like_count` / `reply_count` 接近 bigint 上限时，原 trigger 的 `8 * like_count + 12 * reply_count` 会在 PostgreSQL bigint 中间计算阶段先溢出，从而让派生 `hot_score` 阻断原本合法的计数写入。

处理方式：

- 新增 `202609020003_saturate_topic_hot_score_on_large_counts` 正反向迁移。
- trigger 使用 `numeric` 作为中间计算类型，再把最终 `hot_score` 饱和到 `i64::MAX`；正常范围内仍严格等于 `8 * like_count + 12 * reply_count`。
- 只对派生评分做饱和，不放宽真实互动计数本身的 bigint 边界；计数器真实溢出仍失败并回滚整个事务。
- 新增数据库断言验证正常评分、极端点赞和极端回复都能安全饱和；原 `concurrent_likes_count_once_and_late_failures_roll_back` 事务测试继续通过。

最终完整门禁：

- `pnpm generate:api --check`：PASS，generated zero-diff。
- `pnpm test`：**77 files / 553 tests PASS**。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS，Vite 6.4.3，**1760 modules transformed**。
- `cargo fmt --all -- --check`：PASS。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`：PASS。
- Infrastructure relations：**4 / 4 PASS**；Infrastructure topics：**21 / 21 PASS**；API topics：**20 / 20 PASS**。
- `cargo test --workspace -j 1`：PASS；仅 2 个官方 growth WASM component 测试按仓库既有条件 ignored，要求先构建 `wasm32-wasip2` 官方插件，无失败测试。
- 并行全仓 Rust 测试曾触发 Windows linker `LNK1102: out of memory`；串行 `-j 1` 完整通过，属于主机并发链接资源限制，不是代码缺陷。
- `.gitignore` / `.dockerignore` 的误删已恢复；DaoYun 子树生成物噪声已消除。
- `git diff --check -- daoyun`：PASS，仅有 LF→CRLF 提示，无 whitespace error。

## 11. 当前阶段结论

- 10.1～10.10 的前台社区、会员身份、主题讨论、后台统一视觉和历史 CSS ownership 清理已全部完成。
- 推荐排序后端已经具备真实互动驱动、全局索引和极端计数安全边界。
- 前端、Rust、PostgreSQL、generated zero-diff 与 production 390 / 1440 真实浏览器验收均已完成。
- **本设计 / 改造阶段状态：DONE。** 后续新需求应新开阶段，不再把未完成项追加到本轮 10.x。
- 父级 Git 仓库仍存在与 DaoYun 无关的未跟踪项目，提交本轮时只允许明确的 `daoyun/...` 路径，继续禁止 `git add -A`。

## 12. 验收标准

- 320 / 390 / 768 / 1024 / 1440 无横向溢出。
- 推荐 / 关注 / 最新路由与行为稳定。
- 推荐顺序真实受互动影响，不能退化为最新。
- 全站推荐不因为版块置顶而强制置顶。
- 子版块层级不被活跃入口打乱。
- 首页媒体帖和版块媒体帖呈现边界清晰。
- 主题详情、点赞、收藏、回复、分享、举报行为不因视觉改造退化。
- 公开会员身份只使用公开摘要，不泄露私有会员数据。
- TypeScript、前端全量测试、production build、Rust fmt / clippy / 相关数据库 integration 全部通过后才能收口。
