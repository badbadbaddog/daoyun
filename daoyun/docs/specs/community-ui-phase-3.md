# 刀云社区 UI/UX Phase 3

日期：2026-09-02
状态：**DONE**

## 1. 阶段目标

Phase 2 已在 `c71f412` 完成首页 canonical 语义、详情来源上下文、高频交互 pending、feed 滚动恢复以及桌面 / 移动关键入口一致性。Phase 3 不重做视觉框架，继续处理真实使用时的移动端可达性和失败恢复，优先消灭“语义已经存在，但某个视口或错误态没有入口”的断层。

原则：

- 已有来源感知的 `onBack` 语义必须在桌面和移动端都可触达。
- 网络 / 404 错误态既要允许重试，也要允许安全离开，不能把用户困在失败页面。
- 继续复用当前 hash route 和 Phase 2 来源栈，不新增第二套路由 / history 状态。
- 每个切片继续执行定向测试、前端全量、typecheck、production build 和真实浏览器验收。

## 2. 12.1 移动主题详情返回入口对等（DONE）

### 问题

`TopicDetailView` 本身一直有“返回主题列表”动作，并且 Phase 2 已让它恢复精确来源上下文；但 `styles.community.css` 在 `max-width: 768px` 下把 `.topic-detail__toolbar > .secondary-button` 直接 `display: none`。因此移动端虽然拥有正确的返回语义，却无法触发，只能依赖底部 canonical 首页，来源上下文在 UI 层仍然不可达。

### 实现

- 移动端不再隐藏“返回主题列表”。
- 保持同一个 `onBack`，没有新增移动专用路由逻辑。
- 入口采用紧凑的透明 secondary button，避免挤压详情 breadcrumb / 正文。
- `styles.responsive.test.ts` 增加 ownership 契约，锁定 `max-width: 768px` 下该按钮必须 `display: inline-flex`。

### Production 证据

390x844 production：

- 从真实 `#hot` 推荐流打开真实主题 `啊实打实打算阿松大`。
- “返回主题列表”在移动端真实可见。
- 点击后 URL 精确回到 `#hot`。

1440x1000 production：

- 桌面原有“返回主题列表”保持可见。
- 从 `#hot` 打开同一真实主题后点击返回，仍回 `#hot`，桌面行为无回归。

## 3. 12.2 主题详情失败态可恢复（DONE）

### 问题

主题详情加载失败时此前只有“重试加载主题”。如果主题已经删除、权限永久变化或持续 404，用户只能反复重试，属于明确的失败态死路。

### 实现

- `主题暂时无法加载` 错误态新增“返回主题列表”。
- 返回动作复用同一个 `onBack`：有来源上下文时回精确来源；direct deep-link 无来源时安全回 canonical `#hot`。
- 保留“重试加载主题”，两种恢复路径并列展示。
- 新增 `.topic-detail-state__actions` 统一错误态动作布局。
- `TopicDetailView.test.tsx` 现在同时验证 `onBack` 与重试成功。

### Production 证据

390x844 production 直接打开一个格式合法但不存在的主题 UUID：

- API 真实返回 404，页面进入 `主题暂时无法加载`。
- 错误态真实同时显示“返回主题列表 / 重试加载主题”。
- 点击“返回主题列表”后 direct deep-link 安全回 `#hot`。
- 浏览器中的该 404 是本项验收刻意制造；匿名 `/auth/session` 401 仍为既有预期探测。

## 4. 12.3 加载中可退出与同类失败态审计（DONE）

### 审计结果

继续检查个人主页、收藏、私信、通知后，确认这些页面的顶层“返回社区”都位于 loading / error 分支之外：即使数据请求失败，来源退出入口仍然存在；个人主页的 `ProfileState` 也始终先渲染返回动作。它们没有复现主题详情的死路，因此没有为了“统一改造”而制造无必要改动。

主题详情仍有一个同类缺口：`loadStatus === "loading"` 会整页替换成 spinner，直到请求完成前没有 source-aware 返回入口。慢网络或挂起请求下，用户仍必须等待请求结束才能触发应用内返回。

### 实现

- 主题 loading state 现在直接提供“返回主题列表”。
- 继续复用同一 `onBack`，所以从搜索 / 版块 / feed 进入时仍恢复精确来源；direct deep-link 仍使用 Phase 2 的安全 `#hot` fallback。
- 新增组件契约：让 `getTopic()` 永久 pending，确认 loading 文案存在时“返回主题列表”已经可点击且调用 `onBack`。
- 没有改变 API 请求、AbortController、错误态重试或最终 ready DOM。

## 5. Phase 3 最终门禁

- 12.3 定向 `TopicDetailView + App`：**2 files / 82 tests PASS**。
- `TopicDetailView.test.tsx`：**22 / 22 PASS**。
- `src/App.test.tsx`：**60 / 60 PASS**。
- 前端全量：**77 files / 567 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**，Vite 6.4.3，**1760 modules transformed**。
- production CSS：`258.56 kB / 38.84 kB gzip`。
- `TopicDetailView` production chunk：`34.21 kB / 9.61 kB gzip`。
- 最新 production build 在 390x844 重新打开真实主题，“返回主题列表”仍真实可见；12.1 / 12.2 的正常返回与 404 恢复浏览器证据继续成立。
- 推荐默认流测试使用异步 `waitFor` 消除了定向并发运行中的测试竞态；没有改变产品行为。

## 6. Phase 3 结论

12.1–12.3 已把主题详情在移动端、加载中、加载失败三个此前不对等的状态补齐到同一套 source-aware 返回语义；同类账户页面审计未发现需要继续修改的死路。**Phase 3 = DONE**。后续优化应新开阶段，不再向本阶段追加新功能。

## 7. Git 约束

父级 Git 仓库 `C:\Users\111\Documents\Playground` 仍包含大量与 DaoYun 无关的未跟踪项目。继续只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。
