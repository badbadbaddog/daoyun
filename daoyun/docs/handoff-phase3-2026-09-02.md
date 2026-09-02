# DaoYun Phase 3 交接：2026-09-02

> 当前状态：**IN PROGRESS**。Phase 2 已在 `c71f412` 收口。Phase 3 的 12.1 移动主题详情返回入口对等与 12.2 主题详情失败态可恢复已经完成实现、自动化和真实 production 验收；下一步进入 12.3 同类失败态审计。

## 1. 基线

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- 父级 Git 根：`C:\Users\111\Documents\Playground`
- 分支：`codex/daoyun-home-foundation`
- Phase 3 起点：`c71f412 fix: finalize phase 2 community navigation semantics`
- Phase 3 设计文档：`docs/specs/community-ui-phase-3.md`
- 用户约束：**不要创建或使用 Codex 会话，由 FastSpider_FS 直接完成代码、测试与浏览器验证。**

## 2. 12.1 已完成

移动主题详情此前由 CSS 隐藏桌面已有的“返回主题列表”，导致 Phase 2 已完成的 source-aware `onBack` 在移动端无法触达。本轮恢复该按钮的移动可见性，不引入第二套路由逻辑，并用 responsive stylesheet 契约锁定。

真实 390x844 production 已从 `#hot` 打开真实主题，按钮可见且点击后回到 `#hot`；1440x1000 桌面原行为保持正常。

## 3. 12.2 已完成

主题详情加载失败此前只有“重试加载主题”。现在错误态同时提供：

- “返回主题列表”：复用现有 `onBack`，恢复来源上下文；direct deep-link 无来源时回 `#hot`。
- “重试加载主题”：保留原请求重试能力。

真实 390x844 production 使用格式合法但不存在的 UUID 触发后端 404，页面真实显示两个恢复动作；点击返回后回到 `#hot`。该 404 是验收主动制造，不属于回归错误。

## 4. 最新门禁

- 定向 `TopicDetailView + responsive + App`：**3 files / 91 tests PASS**
- `src/App.test.tsx`：**60 / 60 PASS**
- 前端全量：**77 files / 566 tests PASS**
- `pnpm typecheck`：**PASS**
- `pnpm build`：**PASS**
- Vite：6.4.3
- production build：**1760 modules transformed**
- CSS：**258.56 kB / 38.84 kB gzip**
- TopicDetail chunk：**34.00 kB / 9.59 kB gzip**

定向并发测试曾暴露 `uses the discovery recommendation feed as the default home ordering` 在 API effect 尚未执行时立即断言 `listFeed` 的测试竞态；改为 `waitFor` 后定向与全量都稳定通过。产品逻辑未改变。

浏览器事实：

- 390x844 正常主题：移动“返回主题列表”可见并可回来源。
- 390x844 404 主题：错误态“返回主题列表 / 重试加载主题”同时可见，direct deep-link 返回 `#hot`。
- 1440x1000 正常主题：桌面返回行为保持不变。
- 正常流程只有匿名 `/auth/session` 预期 401；404 场景额外出现预期的 topic/replies 404；路由切换时被取消的 feed 请求可出现 `ERR_ABORTED`，属于主动导航取消。

## 5. 当前改动文件

- `src/styles.community.css`
- `src/styles.responsive.test.ts`
- `src/components/TopicDetailView.tsx`
- `src/components/TopicDetailView.test.tsx`
- `src/App.test.tsx`
- `docs/specs/community-ui-phase-3.md`
- `docs/handoff-phase3-2026-09-02.md`

## 6. 下一执行顺序

1. 对本轮 12.1 / 12.2 做 `git diff --check` 并按明确路径单独提交。
2. 进入 12.3，审计个人主页、收藏、私信、通知等页面的加载失败 / 空态恢复入口。
3. 只修复真实可复现的“失败态死路”或移动可达性断层，不新增新业务功能。
4. 每个切片继续执行定向 -> 全量 -> typecheck -> build -> production 浏览器门禁。
5. Phase 3 仍为 **IN PROGRESS**，不要提前标记 DONE。

## 7. Git 约束

父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件。只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。
