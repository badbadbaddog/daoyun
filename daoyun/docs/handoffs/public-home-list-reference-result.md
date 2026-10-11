# 公共前台列表复刻交接

日期：2026-10-12

## 实现结果
- SiteHeader 共用顶部导航：首页、社区、交易、中介、发现、活动、更多；保留搜索、发布、通知和账户菜单。小屏使用同一导航入口与底部导航。
- 首页为左侧紧凑主题列表、右侧社区信息双栏；不显示列表顶部山景横幅、快捷发布大卡片和帖子图片预览。
- 列表显示头像、标题、置顶、精华、标签、作者、发布时间、板块、回复和浏览；点赞、收藏通过行内更多菜单操作。
- 右栏包含注册登录欢迎区、社区统计、四个快捷入口、热门板块、交易主题和近期作者；登录后保留真实个人统计与成长信息。
- 修复旧样式造成的侧栏内部裁切、768px 公共导航隐藏，以及自定义主题下精华标签对比度。

## 数据边界
主题、作者、板块和个人统计均来自现有接口。主题总数注明来自已加载公开板块；用户数、在线数显示未知。交易、中介、活动复用社区检索入口；交易面板展示当前公开交易板块主题，没有交易主题则显示空态。本次未新增后端或商品价格接口。

## 验证结果
- 全量单元及组件测试：134 个文件，1348 项通过。
- 前端类型检查、浏览器测试类型检查、生产构建：通过。
- 浏览器：public-home-reference、community-responsive、community-quality、ui-v2-home、topic-row-navigation，共 60 项通过（桌面配置 38、移动配置 22）。
- 覆盖 320、390、768、1024、1312、1440px，深浅主题、自定义主题、axe、无横向溢出、导航跨页、注册登录、发布、主题及作者跳转、个人统计失败重试、收藏及个人页图片预览。
- 浏览器使用正式构建与 API 夹具；真实 API/V3 数据库回归未执行，仅同步现有用例并通过类型检查。
- git diff --check：通过；所有本次编辑以 UTF-8 读写，保留原有未提交改动，未提交。

## 验证记录
日志：artifacts/public-list-final-unit.log、artifacts/public-list-release-browser.log、artifacts/public-list-release-mobile.log。
截图：artifacts/public-list-release-browser/ 下的 home-1312-light.png、home-390-light.png、home-1440-dark.png。

## 后续宽度调整（2026-10-12）
公共导航、内容容器和页脚最大宽度统一收紧为 1200px，并保持居中；移动端自适应。1279px 断点同样受限，1920/2560px 屏幕不继续拉伸。新增宽度、居中和导航对齐断言，原版 1279/1920px 检查先失败，修改后 public-home-reference 与 community-responsive 共 30 项通过；类型检查及生产构建通过。本次只调整样式，未重复运行全量单元测试。日志位于 artifacts/public-width-browser.log。

## 继续打磨（2026-10-12）
- 保持公共导航、内容和页脚 1200px 居中上限，不增加列表顶部横幅。
- 桌面与小屏导航共用选中态：首页信息流归属首页，板块检索、板块及帖子详情归属社区，交易等具体入口优先选中。
- “更多”支持点击外部、Tab 移出、Escape、路由切换收起；Escape 恢复触发按钮焦点。搜索增加聚焦轮廓，小屏导航标明当前入口。
- 普通桌面列表行收紧为约 64px；置顶与标题成组，多标签自然换行，长标签截断，标题和标签悬停可查看完整内容。修复长标题被标签挤成零宽度，以及 300px 侧栏五个近期作者超出内边距的问题。
- 新增测试先确认导航与长内容问题，再实现修复。全量单元及组件测试 134 个文件、1358 项通过（4 个工作进程）；前端与浏览器测试类型检查、生产构建通过。
- 浏览器覆盖共 74 项：桌面原 51 项、小屏 22 项及新增菜单焦点验证 1 项。初次与全量单元测试同时运行造成少数超时及首屏预算失败；独立分批复核 community-responsive、community-quality 的桌面/小屏共 16 项全部通过。未放宽原有超时或性能阈值。
- 已人工检查 1312px 浅色、1440px 深色、320/1024px 长内容截图；宽屏 1920/2560px、两种主题、无横向溢出及 axe 检查通过。浏览器使用 API 夹具，未执行真实后端与数据库回归。
- 日志：artifacts/public-polish-unit-final.log、public-polish-browser-desktop.log、public-polish-browser-mobile.log、public-polish-browser-recheck.log、public-polish-browser-menu.log。截图：artifacts/public-polish-desktop/ 和 artifacts/public-polish-stress/。
- 本次文件均以 UTF-8 读写；git diff --check 通过；临时预览已停止，保留用户已有服务和未提交改动。

## 加载与操作细节打磨（2026-10-12）
- 保持公共导航、内容与页脚 1200px 居中上限，首页不增加顶部横幅。
- 初始加载改为四行静态骨架；空筛选可清除标签，普通空列表可发布首篇主题，关注空列表可浏览社区。初始失败和分页失败有明确重试入口，分页保留已有主题并禁用重复提交，列表正确标记忙碌状态。
- 修复列表底部圆角、行内菜单裁切和缺少样式；菜单纵向排列、浮层可见，首尾行支持直接点击、ArrowDown/End/Escape，退出恢复按钮焦点。悬停按钮避让浏览数；不使用阻断命中的隐藏样式。
- 恢复 768px 标签筛选，限定宽度使其不遮挡分类。取消紧凑列表背景过渡，修复主题切换时文字对比度短暂不足；增加导航、标题和元信息的逐帧对比度断言。
- 新增状态行为测试及浏览器回归，先复现骨架、空态、分页忙碌、菜单裁切/布局、主题闪烁和统计遮挡问题，再修复。全量单元与组件测试 134 个文件、1363 项通过；前端和浏览器测试类型检查、生产构建通过。
- 公共前台浏览器回归 86 项通过（桌面 64、移动 22），覆盖加载、空态、失败恢复、分页去重、公共导航、宽度、主题、axe 和无横向溢出。最后的菜单避让调整另以 9 项菜单与列表专项回归全部通过，不放宽断言或阈值。浏览器使用 API 夹具，未执行真实后端和数据库回归。
- 人工检查 320px 加载/分页失败、768px 首行菜单、1440px 空态/末行菜单，以及常规深浅主题截图；最终菜单未遮挡浏览数且完整显示。
- 日志：artifacts/public-states-unit-final.log、public-states-types-final.log、public-states-e2e-types-menu-stats.log、public-states-build-menu-stats.log、public-states-browser-release-desktop.log、public-states-browser-release-mobile.log、public-states-browser-menu-stats.log。截图：artifacts/public-states-browser-release-desktop/ 与 artifacts/public-states-browser-menu-stats/。
- 本次文件均以 UTF-8 读写，git diff --check 通过；未新增依赖、后端接口或数据库变更，保留原有未提交改动，未提交。

## 分支提交前独立验证（2026-10-12）
- 提交范围为 32 个公共前台源文件、测试与交接文档；后台、成长插件和 ActionMenu 的后台 Portal 扩展保留在原工作区。
- 从暂存区导出独立快照验证，130 个测试文件、1282 项单元与组件测试全部通过；应用与 E2E 类型检查、生产构建通过。
- 独立快照的公共浏览器回归 86 项全部通过（桌面 64、移动 22），不依赖工作区其余未提交改动。浏览器仍使用 API 夹具，未复跑真实后端和数据库。
- 记录：artifacts/public-push-unit.log、public-push-typecheck.log、public-push-e2e-typecheck.log、public-push-build.log、public-push-browser-desktop.log、public-push-browser-mobile.log。
- 提交目标分支：codex/membership-admin-redesign-20261008，远程 origin。
