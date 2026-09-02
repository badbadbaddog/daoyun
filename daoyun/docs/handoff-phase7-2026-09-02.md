# DaoYun Phase 7 交接：2026-09-02

> 当前状态：**DONE / LOCAL CLOSURE COMMIT**。Phase 7 以 `aa00e932da0156fb98f4460740fc3d62a4f24814`（`fix: complete phase 6 tab keyboard semantics`）为基线，完成高风险异步写操作的同步重复提交防护，以及标准权益异步读取的陈旧响应隔离。最终自动化门禁与 production 只读验收均已通过；本文档与 Phase 7 源码位于同一个本地收口提交，最终提交 SHA 以父仓库 `git log -1` 为准。远端未 push。

## 1. 基线与强约束

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- 父级 Git 根：`C:\Users\111\Documents\Playground`
- 当前分支：`codex/daoyun-home-foundation`
- Phase 7 起点：`aa00e932da0156fb98f4460740fc3d62a4f24814 fix: complete phase 6 tab keyboard semantics`
- Phase 7 开始时相对 origin：**ahead 13**。
- 用户硬约束：**不要创建或使用 Codex 会话，全程只使用 FastSpider_FS 直接完成代码、审计、测试、浏览器验收和本机操作。**
- 父级 `Playground` 仍有大量与 DaoYun 无关的未跟踪文件 / 项目；本阶段只允许暂存明确的 `daoyun/...` 路径，**禁止 `git add -A`**。

## 2. Phase 7 目标

Phase 6 已完成 tab 键盘语义。本阶段按交接建议继续审计异步交互，重点不是给所有按钮机械添加 loading，而是验证：

1. 高风险写操作不能仅依赖 React state 在下一次渲染后禁用按钮；同一事件批次内也必须阻止第二次请求进入。
2. 每次调用都会生成新 idempotency key 的操作尤其不能发生同批次重复提交。
3. 异步读取在快速切换上下文时，旧请求晚返回不得覆盖用户当前选择。
4. pending 状态要有可观察的 disabled / `aria-busy` 语义。
5. 已经具备正确幂等、局部 pending、错误恢复和 live-region 的路径不为“统一”而重构。

## 3. 审计结论

本轮静态审计与现有回归对比后，确认以下是真实缺口：

- `AuthorizationAdminPanel`：角色创建/更新、分配、撤销、删除和加载更多共用 `busy` state，但 handler 本身没有同步锁；React 重渲染前可能重复进入。
- `BoardAdminPanel`：现有 `pendingId` 会在渲染后锁住版块树，但合并 / 回滚每次都会生成新的 idempotency key；同批次重复点击必须在 handler 层挡住。
- `EntitlementsWorkspace`：发布、搜索、发放、撤销依赖 state pending；尤其发放 / 撤销会为每次调用创建新 idempotency key。同时用户权益和版本历史读取存在旧请求晚返回覆盖新上下文的可能。
- `InstallationWizard`：首次初始化是一次性高风险写入，原有 duplicate test 只证明了重渲染后的按钮 disabled，没有证明同一 React 批次内双 submit 只发送一次。

同时确认以下路径已有合适语义，本阶段没有重复改造：

- TopicComposer 的发布重试复用 idempotency key。
- Messages 的失败重试复用同一消息 idempotency key，并已有跨会话陈旧响应保护。
- Moderation 的对话框已有 pending lock、错误保留与冲突反馈。
- Phase 5 的 ConfirmDialog / ModalDialog 已负责 destructive confirmation 的 busy lock。
- 本轮涉及的权限、版块、权益、初始化界面原有错误 / 成功反馈已经使用 `role="alert"` / `role="status"` 等 live-region 语义；没有为了增加 DOM 噪声重复包裹。

## 4. AuthorizationAdminPanel：同步 busy lock

修改：

- `src/components/AuthorizationAdminPanel.tsx`
- `src/components/AuthorizationAdminPanel.test.tsx`

实现：

- 新增 `busyRef`。
- 新增 `beginBusy()` / `endBusy()`。
- `beginBusy()` 在调用 `setBusy(true)` 前先同步检查并占用 ref lock。
- 以下入口统一使用同步锁：
  - 角色创建 / 更新 `saveRole`
  - 删除角色 `removeRole`
  - 分配角色 `assignRole`
  - 撤销分配 `revokeAssignment`
  - 加载更多分配 `loadMore`
- `loadData` 保持为独立读取 / 刷新恢复路径，没有被写锁阻塞。

新增回归：

- `synchronously blocks duplicate role creation while the first request is pending`
- 使用两个原生 `submit` event 在**同一个 `act()` 批次**里连续 dispatch，避免 React 在两次操作之间刷新 state。
- 断言 `createAuthorizationRole` 只调用 **1 次**。
- pending 时提交按钮真实 disabled。
- deferred Promise 完成后正常显示成功状态。

## 5. BoardAdminPanel：全局同步 mutation lock

修改：

- `src/components/BoardAdminPanel.tsx`
- `src/components/BoardAdminPanel.test.tsx`

实现：

- 新增 `mutationRef`。
- 新增 `beginMutation(id)` / `endMutation()`。
- `pendingId` 继续承担 UI 层的可见全局锁；`mutationRef` 负责事件批次内的同步互斥。
- 覆盖：
  - 新建 / 编辑版块
  - 通用移动 / 可见性 mutation
  - 删除版块
  - 合并版块
  - 合并回滚
- 读取型 `refreshBoards` 和 merge impact preview 保持可用于恢复 / 预览，不错误地塞进 mutation lock。

新增回归：

- `synchronously blocks duplicate merge execution while the first request is pending`
- 在同一 `act()` 中向“确认合并版块”连续 dispatch 两次 click。
- 断言 `mergeAdminBoard` 只调用 **1 次**。
- pending 时确认按钮 disabled。
- deferred mutation 完成后正常显示审计编号。

这一条尤其重要，因为每次 merge 调用会新建 idempotency key；如果只靠下一帧 state disabled，两个请求会携带不同 key，服务端幂等无法把它们视作同一请求。

## 6. EntitlementsWorkspace：mutation lock + request generation

修改：

- `src/features/admin-membership/EntitlementsWorkspace.tsx`
- `src/features/admin-membership/EntitlementsWorkspace.test.tsx`

新增同步 refs：

- `publishingRef`
- `searchingRef`
- `mutatingRef`

用于同步保护：

- 发布权益版本
- 用户搜索
- 发放标准权益
- 撤销标准权益

其中发放 / 撤销原本每次提交都会创建新的 idempotency key，因此必须在进入 API 前同步挡住第二次 submit。

### 6.1 陈旧版本历史响应

新增 `versionsRequestRef` generation：

- 打开类型 A 版本历史 -> 请求 A。
- 用户立即切到类型 B -> 请求 B。
- 只允许最新 generation 回写 versions / error / loading。
- 即便 A 最后才返回，也不能覆盖当前 B 的历史列表。

回归：

- `keeps the latest entitlement version request when an older one finishes later`

### 6.2 陈旧用户权益响应

新增 `entitlementsRequestRef` generation：

- 选择用户 A -> 请求 A。
- 未等 A 完成即选择用户 B -> 请求 B。
- 只允许 B 的 generation 更新当前详情。
- A 的迟到响应不能写入 B 的界面。

回归：

- `keeps the latest selected user when an older entitlement request finishes later`

这里刻意**没有**在 `grantsLoading` 时禁用其他用户搜索结果，因为允许管理员切换到 B 正是正确行为；使用 generation 隔离旧请求，而不是用 UI 禁止切换来掩盖竞态。

### 6.3 发放重复提交

新增回归：

- `blocks a duplicate entitlement grant while the first request is pending`
- 同一 `act()` 内连续 dispatch 两次 form submit。
- 验证网络调用只增加 **1 次**。
- pending 时“确认发放” disabled。
- 请求完成后 `role="status"` 正常宣布成功。

### 6.4 pending 可访问状态

- 当前用户权益详情增加 `aria-busy={grantsLoading}`。
- “刷新用户权益”在读取期间 disabled。
- 不阻止切换到其他用户。

## 7. InstallationWizard：首次初始化同步提交锁

修改：

- `src/components/InstallationWizard.tsx`
- `src/App.test.tsx`

实现：

- 新增 `submissionRef`。
- `handleSubmit` 首行同步检查 `submissionRef.current`。
- 初次初始化和“等待最终状态确认”两个 async 分支都先占用同步锁。
- `finally` 统一释放锁，保持 422 / 409 / 503 等原有恢复语义。
- 安装表单增加 `aria-busy={phase === "submitting"}`。
- 原有字段错误 `aria-describedby`、顶部 `role="alert"`、重试保留输入行为保持不变。

升级原 duplicate regression：

- `prevents duplicate submissions while initialization is pending`
- 不再用两次独立 `user.click`。
- 改为同一个 `act()` 内直接向 form dispatch 两次 submit。
- 断言：
  - `initializeInstallation` 只调用 **1 次**。
  - form `aria-busy="true"`。
  - “正在初始化”按钮 disabled。

## 8. 自动化门禁

Phase 7 最终结果：

- 关键定向：**4 files / 88 tests PASS**。
- 前端全量：**81 files / 597 tests PASS**。
- 相比 Phase 6：新增 **5** 条真实竞态 / 重复提交回归（592 -> 597）。
- `pnpm typecheck`：**PASS**。
- `pnpm build`：**PASS**。
- Vite：**6.4.3**。
- production build：**1762 modules transformed**。
- production CSS：约 `259.35 kB / 38.99 kB gzip`。
- 主 index：约 `394.43 kB / 107.39 kB gzip`。
- AdminApp：约 `231.77 kB / 59.89 kB gzip`。
- `git diff --check -- daoyun`：**PASS**；仅 Windows LF / CRLF 提示，无 whitespace error。

## 9. Production 真实只读验收

本机 local production gateway 基于 Phase 7 最新源码重新构建后启动：

- Web：`http://127.0.0.1:5173/`
- API：`127.0.0.1:3000`
- Chromium viewport：**1440 x 1000**
- 使用本地 demo 管理员登录。

验收内容均为读取 / 预览，没有执行业务 mutation：

### 9.1 角色与权限

- `#admin/authorization` 正常加载。
- 自定义角色、系统角色、角色分配、创建/分配表单均正常。
- “创建角色”在必填上下文不完整时保持 disabled。
- destructive delete / revoke 入口仍保留 Phase 5 的确认语义。
- 没有创建、编辑、删除、分配或撤销任何角色。

### 9.2 版块管理

- `#admin/boards` 正常加载真实版块树。
- 打开“社区广场 -> 合并版块”。
- 只选择“产品反馈”作为目标并读取 merge impact：
  - **8 个主题**
  - **6 条回复**
  - **0 个子版块**
- “确认合并版块”正常出现。
- **没有点击确认合并**，数据库结构未变。

### 9.3 标准权益

- `#admin/membership` -> “标准权益”正常加载。
- 内层“权益类型 / 用户权益”工作区正常。
- 当前真实本地数据尚未配置标准权益类型，空状态使用 `role="status"`。
- 切到“用户权益”后搜索表单正常，因无类型 / 无选择用户，“发放标准权益”保持 disabled。
- 没有发布、发放或撤销权益。

### 9.4 浏览器事件

- 浏览器记录到的错误仅包括：
  - 服务恢复前一次旧页面的 `ERR_CONNECTION_REFUSED`。
  - 登录前匿名 session probe 的预期 `401 Unauthorized`。
- 服务恢复并登录后未发现新的脚本崩溃或 Phase 7 交互错误。

### 9.5 手工验收边界

本阶段最关键的“同一 React 批次双 submit / 双 click”是亚渲染时序问题，普通人工点击无法可靠且安全地重现；同时在真实管理员环境中故意重复执行合并、发放、初始化也不应作为验收方式。因此：

- 同步重复提交保护由同一个 `act()` 批次的原生 event regression 作为主要证据。
- production 浏览器验收只验证真实操作面、disabled / status / preview 语义和无回归，不执行破坏性写入。

## 10. Phase 7 变更边界

预期只包含以下 9 个 `daoyun` 路径：

1. `daoyun/src/App.test.tsx`
2. `daoyun/src/components/AuthorizationAdminPanel.tsx`
3. `daoyun/src/components/AuthorizationAdminPanel.test.tsx`
4. `daoyun/src/components/BoardAdminPanel.tsx`
5. `daoyun/src/components/BoardAdminPanel.test.tsx`
6. `daoyun/src/components/InstallationWizard.tsx`
7. `daoyun/src/features/admin-membership/EntitlementsWorkspace.tsx`
8. `daoyun/src/features/admin-membership/EntitlementsWorkspace.test.tsx`
9. `daoyun/docs/handoff-phase7-2026-09-02.md`

父级 `Playground` 其他未跟踪内容不得修改或暂存。

## 11. 下一阶段建议

Phase 7 完成后，新建 Phase 8。建议优先级：

1. **后台 revision conflict / stale-state 恢复一致性**：审计所有带 `expectedRevision` 的高风险编辑，确认 409 后均保留用户上下文并提供明确刷新最新数据入口。
2. **390px 管理端复杂工作区密度与溢出**：重点检查角色权限长清单、版块树+抽屉、举报详情、标准权益表单等，而不是泛泛改所有 CSS。
3. 对读请求继续只处理有真实竞态证据的 latest-wins 场景，不把所有请求抽象成统一 request manager。
4. 已经正确的 TopicComposer、Messages、Moderation、ModalDialog / ConfirmDialog 不应重复重构。
