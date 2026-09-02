# DaoYun Phase 3 交接：2026-09-02

> 当前状态：**DONE / COMMITTED**。Phase 2 已在 `c71f412` 收口。Phase 3 的 12.1 移动主题详情返回入口对等、12.2 主题详情失败态可恢复、12.3 加载中可退出与同类失败态审计均已完成实现、门禁和本地提交。

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

## 4. 12.3 已完成

同类审计覆盖 `UserProfileView`、`BookmarksView`、`MessagesView`、`NotificationsView`。这些页面的顶层“返回社区”都位于 loading / error 分支之外，个人主页 `ProfileState` 也始终先渲染返回动作，因此没有复现主题详情的退出死路，不做无意义统一改造。

唯一剩余缺口是主题详情 loading state：请求未完成前整页只有 spinner。现在 loading state 同样显示“返回主题列表”，继续复用 Phase 2 的 source-aware `onBack`。新增测试把 `getTopic()` 保持永久 pending，确认等待期间仍能离开。

Phase 3 实现提交链：

- 12.1 / 12.2：`fa03626 fix: restore mobile topic detail recovery`
- 12.3：`974a489 fix: keep topic loading state escapable`

## 5. Phase 3 最终门禁

- 12.3 定向 `TopicDetailView + App`：**2 files / 82 tests PASS**
- `TopicDetailView.test.tsx`：**22 / 22 PASS**
- `src/App.test.tsx`：**60 / 60 PASS**
- 前端全量：**77 files / 567 tests PASS**
- `pnpm typecheck`：**PASS**
- `pnpm build`：**PASS**
- Vite：6.4.3
- production build：**1760 modules transformed**
- CSS：**258.56 kB / 38.84 kB gzip**
- TopicDetail chunk：**34.21 kB / 9.61 kB gzip**

浏览器事实：

- 390x844 正常主题：移动“返回主题列表”真实可见并可回来源。
- 390x844 404 主题：错误态“返回主题列表 / 重试加载主题”同时可见，direct deep-link 返回 `#hot`。
- 1440x1000 正常主题：桌面返回行为保持不变。
- 12.3 最新 production build 又重新打开真实主题并确认返回入口无回归；loading 瞬态由永久 pending 的组件契约精确锁定。
- 正常流程只有匿名 `/auth/session` 预期 401；404 验收额外产生预期 topic/replies 404；主动路由切换可能取消 feed 请求产生 `ERR_ABORTED`。

## 6. Git 收口事实

- 12.1 / 12.2 已提交：`fa03626`。
- 12.3 已提交：`974a489`。
- 本文件当前修改仅用于补记最终 12.3 提交 SHA，随后以 docs-only 提交收口。
- DaoYun 子树提交时始终使用明确路径，未使用 `git add -A`；父级仓库无关未跟踪文件保持不动。

## 7. 阶段结论

Phase 3 的 12.1–12.3 已全部完成。后续若继续 UI/UX 优化，应新开 Phase 4 / 独立任务；不要继续向 Phase 3 扩张新业务范围。

## 8. Git 约束

父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件。只暂存明确 `daoyun/...` 路径，**禁止 `git add -A`**。
