# DaoYun Phase 8 交接 — 2026-09-02

状态：**DONE**

## 1. 基线

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- Git 根：`C:\Users\111\Documents\Playground`
- 分支：`codex/daoyun-home-foundation`
- Phase 7 基线提交：`3f83bef03fc40e5b3597cac22c5fcda0308f6e4b`
- 本阶段只使用 FastSpider_FS；未创建或使用 Codex 会话。
- 不执行 push。

## 2. Phase 8 目标

本阶段按 Phase 7 交接继续两条主线：

1. 后台 `expectedRevision` / revision conflict / stale-state 恢复一致性。
2. 390x844 复杂管理工作区真实 production 验收。

原则：409 后不能只显示错误；刷新必须真正更新服务端 revision 基线，同时保留管理员尚未提交的本地草稿。若目标对象已消失，则阻止继续使用旧 revision 盲重试。

## 3. revision conflict 审计结论

生产前端检索到的 `expectedRevision` 高风险入口已逐项核对。已正确处理、无需重复重构的路径包括 Operations、Moderation / Topic 等；本阶段修复以下真实缺口。

### 3.1 角色与权限

修改：

- `src/components/AuthorizationAdminPanel.tsx`
- `src/components/AuthorizationAdminPanel.test.tsx`

修复：

- 原 409 分支会调用通用 `loadData()`，该函数先清空 `error`，导致“角色已被其他管理员更新”提示被刷新动作本身擦除。
- 新恢复路径刷新权限、角色、分配目录，但保留本地 `roleDraft` 和编辑上下文。
- 刷新后的角色对象提供最新 revision；管理员可以在不重填名称和权限的前提下再次保存。
- 对应回归证明第一次写入使用旧 revision、409 后刷新、第二次写入使用新 revision，草稿不丢。

### 3.2 版块编辑 / 访问策略

修改：

- `src/components/BoardAdminPanel.tsx`
- `src/components/BoardAdminPanel.test.tsx`

真实 bug：

- 原 `RevisionConflictNotice -> 刷新最新数据` 对普通版块编辑只刷新外层 `boards`。
- Drawer 内的 `editor.board` 仍保留旧 revision，因此用户直接再次保存仍会使用旧 revision，形成重复 409 循环。

修复：

- 新增冲突基线刷新逻辑。
- 刷新后同步更新当前编辑对象的服务端 board 基线 / revision。
- 本地 `draft` 不覆盖，因此管理员已经修改的名称、slug、描述等继续保留。
- 访问策略仍按其独立 policy revision 路径刷新。
- 如果目标版块已经消失，则明确提示并关闭旧编辑上下文，而不是继续盲重试。

回归证明：旧 revision 写入 409 -> 刷新 -> 第二次保存携带新 revision，同时本地字段保持不变。

### 3.3 社区用户组：默认组、编辑、归档

修改：

- `src/components/CommunityGroupAdminPanel.tsx`
- `src/components/CommunityGroupAdminPanel.test.tsx`
- `src/components/CommunityGroupQuotaDialog.tsx`

修复：

- 用户组编辑 409 后新增 `RevisionConflictNotice`，刷新服务器基线但不覆盖 quota / permission / displayName 等本地草稿。
- 归档 409 后刷新 `archiveTarget.revision`，保留当前归档确认上下文。
- 默认用户组发生竞争更新时，刷新最新默认组 revision，同时尽量保留管理员原本选择的目标默认组。
- 如果编辑/归档目标已不存在，则停止旧对象重试并显示明确错误。

新增回归覆盖：

- 默认用户组冲突刷新并保留目标选择。
- 编辑用户组冲突刷新并保留本地字段。
- 归档目标冲突刷新后使用新 revision 重试。

### 3.4 附加用户组成员移出

修改：

- `src/components/CommunityGroupMembershipManager.tsx`
- `src/components/CommunityGroupAdminPanel.test.tsx`

真实缺口：

- `revokeAdminCommunityGroupMembership` 使用 membership revision。
- 原 409 后只能显示错误；普通“刷新成员关系”会清掉正在填写的移出原因。

修复：

- 识别 409 revision conflict。
- 新增专用冲突刷新：重新读取当前用户成员关系，更新 `removalTarget.revision`，保留 `removalReason`。
- 如果该成员关系已经消失，则关闭旧撤销目标并明确提示。

回归证明：第一次撤销用旧 revision -> 409 -> 刷新 -> 第二次用新 revision，移出原因保持不变。

### 3.5 成长等级

修改：

- `src/components/MembershipAdminPanel.tsx`
- `src/components/GrowthLevelFormDialog.tsx`
- `src/components/AdminView.test.tsx`

真实缺口：

- `updateAdminGrowthLevel` 使用 `expectedRevision`，API 明确返回 `membership.level_revision_conflict`。
- 原实现只展示服务端文本，没有刷新最新 revision 后重试的路径。

修复：

- 编辑 dialog 在 revision conflict 时显示刷新入口。
- 刷新重新读取成长等级目录，更新 `editingGrowth.revision` 和不可作为草稿来源的服务端基线字段。
- 管理员已经编辑的名称、EXP 阈值、颜色、说明等本地字段继续保留。
- 目标等级消失时退出旧编辑上下文并提示。

回归证明第二次保存使用新 revision，且本地编辑值不回退。

### 3.6 标准权益：类型发布与权益撤销

修改：

- `src/features/admin-membership/EntitlementsWorkspace.tsx`
- `src/features/admin-membership/EntitlementsWorkspace.test.tsx`

修复：

- 发布已有权益类型新版本发生 409 时，刷新权益类型列表并更新 `selectedType.revision`，不覆盖显示名称、权限快照、额度快照草稿。
- 撤销标准权益发生 409 时，重新读取当前用户权益，更新 `revokeTarget.revision`，保留撤销原因。
- 若类型或权益记录已经消失，则停止旧目标重试。
- Phase 7 的 latest-wins request generation 与同步 mutation lock 保持不变。

新增回归：

- 类型发布冲突刷新后以新 revision 成功重试，publisher 草稿保留。
- 撤销冲突刷新后以新 revision 成功重试，撤销原因保留。

### 3.7 举报处理

修改：

- `src/components/ReportAdminPanel.tsx`
- `src/components/ReportAdminPanel.test.tsx`

修复：

- `markInReview` / 最终 moderation 的 revision conflict 不再只是报错“请刷新”。
- 冲突时提供显式刷新当前举报详情入口。
- 刷新后更新 `detail.report.revision`，同时保留 disposition、隐藏内容、作者处置、公开说明、内部备注等本地 moderation 草稿。
- 对最终处置，刷新后重新构造提交使用的 `expectedRevision`，避免确认对象长期携带旧 revision。
- 举报已消失时退出旧详情上下文，而不是继续提交。

回归证明：409 后刷新得到 revision 2，本地处置草稿继续存在，第二次 moderation 使用 revision 2。

## 4. 390x844 production 专项验收

本地服务：

- Web：`http://127.0.0.1:5173/`
- API：`127.0.0.1:3000`
- PostgreSQL：`127.0.0.1:55433`

使用本地 demo 管理员，只执行读取、导航、打开 Drawer / dialog；没有提交创建、保存、归档、发放、撤销、举报处置等业务 mutation。

### 4.1 角色与权限

- `#admin/authorization` 真实加载。
- 桌面侧栏在 390px 收成单一“管理模块”选择器。
- 45 项权限长清单、角色目录、新建角色、角色分配均可访问。
- 必填字段为空时“创建角色 / 分配角色”保持 disabled。
- 没发现需要新增 CSS 的实际溢出证据。

### 4.2 版块树 + Drawer

- `#admin/boards` 真实加载 3 个版块层级。
- 打开“社区广场 -> 编辑设置”。
- 390px 下 Drawer 中以下内容全部可访问：
  - 当前 revision
  - 基本信息 / 内容规则 / 访问权限 / 治理人员 / 危险操作 5 个分区
  - 名称、slug、描述、图标、色调、可见状态
  - 保存按钮
- 关闭 Drawer，未保存任何字段。
- 没发现控件丢失或需要专项 CSS 兜底的证据。

### 4.3 举报处理

- `#admin/reports` 真实加载。
- 5 个状态筛选和移动端单栏 workspace 正常。
- 当前本地数据库真实状态为 **0 条举报**，因此本阶段不能声称真实人工验收了举报详情表单。
- 举报详情 revision conflict / 草稿保留由自动化回归提供证据。
- 现有响应式规则会在窄屏把队列/详情双栏切成单页队列/详情状态。

### 4.4 标准权益

- `#admin/membership -> 标准权益` 正常。
- 外层会员 workspace tabs + 内层“权益类型 / 用户权益” tabs 均正常。
- 当前本地数据没有标准权益类型，空态正常。
- 打开“发布新版本” dialog：内部键、显示名称、权限快照、额度快照、取消、确认全部可访问。
- 无效空表单时“确认发布”保持 disabled。
- 未执行发布。

### 4.5 响应式结论

- 本阶段没有为了“做移动优化”而机械修改 CSS。
- `styles.responsive.test.ts` / `styles.admin.test.ts` 继续通过。
- 实机 390px 未发现足够证据支持新增样式改动。

## 5. 浏览器 / 环境事件

验收过程中出现两个运行环境事件，均已定位且没有冒充业务缺陷：

1. 旧 local 父任务仍显示 running，但 API/Web 子进程已经退出；登录时出现连接失败。重新执行 `pnpm local --no-browser` 后 API、production build 和 gateway 正常恢复。
2. 服务恢复时 production build 重新生成带 hash 的 chunks；一个在重建前已打开的旧 SPA 页面仍引用旧 `AdminApp-*.js` 等 chunk，因文件名已经变化而出现 404 / dynamic import error。使用带 cache-busting query 的 fresh page 加载最新 `index.html` 后正常，后续 fresh-page 验收没有新增浏览器错误。

这些事件没有写入业务数据，也不是 Phase 8 源码运行时崩溃。

## 6. 自动化门禁

Phase 8 最终结果：

- Phase 8 定向：**8 files / 112 tests PASS**。
- 前端全量：**81 files / 606 tests PASS**。
- Phase 7 全量为 597 tests；Phase 8 新增 **9** 条 revision conflict / stale-state 回归。
- `pnpm typecheck`：**PASS**。
- 最终 `pnpm build`：**PASS**。
- Vite：**6.4.3**。
- production build：**1762 modules transformed**。
- production CSS：`259.35 kB / 38.99 kB gzip`。
- main index：`394.43 kB / 107.39 kB gzip`。
- AdminApp：`235.65 kB / 61.10 kB gzip`。
- `git diff --check -- daoyun`：**PASS**；仅 Windows LF / CRLF 提示，无 whitespace error。

## 7. Phase 8 变更边界

预期只包含以下 16 个 `daoyun` 路径：

1. `daoyun/src/components/AdminView.test.tsx`
2. `daoyun/src/components/AuthorizationAdminPanel.test.tsx`
3. `daoyun/src/components/AuthorizationAdminPanel.tsx`
4. `daoyun/src/components/BoardAdminPanel.test.tsx`
5. `daoyun/src/components/BoardAdminPanel.tsx`
6. `daoyun/src/components/CommunityGroupAdminPanel.test.tsx`
7. `daoyun/src/components/CommunityGroupAdminPanel.tsx`
8. `daoyun/src/components/CommunityGroupMembershipManager.tsx`
9. `daoyun/src/components/CommunityGroupQuotaDialog.tsx`
10. `daoyun/src/components/GrowthLevelFormDialog.tsx`
11. `daoyun/src/components/MembershipAdminPanel.tsx`
12. `daoyun/src/components/ReportAdminPanel.test.tsx`
13. `daoyun/src/components/ReportAdminPanel.tsx`
14. `daoyun/src/features/admin-membership/EntitlementsWorkspace.test.tsx`
15. `daoyun/src/features/admin-membership/EntitlementsWorkspace.tsx`
16. `daoyun/docs/handoff-phase8-2026-09-02.md`

父级 `Playground` 的其他未跟踪内容不得修改或暂存。继续禁止 `git add -A`。

## 8. 下一阶段建议

Phase 8 完成后建议新建 Phase 9，进入全站最终交互 / accessibility / responsive 终审，而不是继续重复修改已经修正的 revision conflict：

1. 1440 / 1024 / 768 / 390 关键公开页与后台路由验收矩阵。
2. keyboard-only、focus restore、dialog / drawer、alert / status / aria-busy 终审。
3. loading / empty / error / retry / offline 或服务不可用恢复一致性。
4. 浏览器 console / network 终审，区分预期匿名 401 与真实业务错误。
5. 只修可复现问题；不要重新抽象 TopicComposer、Messages、Moderation、ModalDialog / ConfirmDialog、Phase 8 revision recovery。

Phase 9 之后再进入 Phase 10：最终交付门禁、文档状态、API generated zero-diff、Rust / DB 能执行的门禁和最终提交链收口。
