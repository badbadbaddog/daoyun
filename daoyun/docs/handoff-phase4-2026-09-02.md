# DaoYun Phase 4 交接：2026-09-02

> 当前状态：**DONE / LOCAL CLOSURE COMMIT**。Phase 3 已在 `dfd7a16441296758d6ab82a058ff977687d70fba` 完成交接收口。Phase 4 已完成共享 `ActionMenu`、共享 `Drawer`、共享 `ModalDialog`、顶部个人菜单、内容治理主题操作菜单、`BoardAdminPanel` 高风险合并 / 删除确认以及其余真实 dialog 缺口的收敛；最终全量门禁、1440x1000 与 390x844 production 只读 / 取消式验收均已通过。本文档与 Phase 4 源码位于同一个本地独立收口提交；提交 SHA 不在提交内容中自引用，最终以父仓库 `git log -1` 为准。远端仍未确认更新。

## 1. 基线与强约束

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- 父级 Git 根：`C:\Users\111\Documents\Playground`
- 当前分支：`codex/daoyun-home-foundation`
- Phase 4 起点：`dfd7a16441296758d6ab82a058ff977687d70fba docs: record phase 3 handoff`
- Phase 4 开始时本地分支相对 origin：**ahead 9**；Phase 4 本地收口提交完成后将再增加 1 个本地提交。除非后续真实 push 成功，否则始终不要写成“已 push”。
- 用户硬约束：**不要创建或使用 Codex 会话，全程由 FastSpider_FS 直接完成代码、研究、测试、浏览器验证和本机操作。**
- 父级 `Playground` 存在大量与 DaoYun 无关的未跟踪项目 / 文件；只允许按明确 `daoyun/...` 路径暂存，**禁止 `git add -A`**。

## 2. Phase 4 当前目标

Phase 3 已解决移动主题详情“可返回 / 可恢复 / loading 可退出”。Phase 4 不扩张业务模型，继续收敛高频交互层：

1. menu / popover 的键盘打开、移动、关闭和焦点恢复语义一致。
2. drawer / dialog 打开后接管焦点，Tab 不逃逸，Escape / backdrop 关闭规则一致，关闭后焦点回到来源控件。
3. busy / submitting 时不能误关闭高风险表单。
4. ARIA role 与真实交互一致，不再出现 `role="menu"` 内部仍按普通 button 语义工作的半成品。
5. 真实 production 继续以 1440 桌面为主要管理端验收，同时保留移动端响应式基线。

## 3. 已完成：共享 ActionMenu 焦点语义

文件：

- `src/components/ui/ActionMenu.tsx`
- `src/components/ui/ActionMenu.test.tsx`（新增）

当前实现已经覆盖：

- 触发器支持点击及方向键打开。
- ArrowUp / ArrowDown 在可用 `menuitem` 间循环移动。
- Home / End 跳到首尾可用菜单项。
- Escape 关闭菜单并把焦点恢复到触发器。
- 点击菜单外部关闭。
- 选择菜单项后关闭菜单并恢复稳定焦点语义。
- disabled item 不参与键盘移动。
- `aria-haspopup="menu"` / `aria-expanded` 与实际打开状态同步。

该组件已经继续服务 `BoardTree` 的版块“更多操作”，没有为后台另造第二套菜单实现。

## 4. 已完成：共享 Drawer 焦点生命周期

文件：

- `src/components/ui/Drawer.tsx`
- `src/components/ui/Drawer.test.tsx`（新增）

当前实现：

- Drawer 打开时记录此前聚焦元素。
- 打开后把焦点交给 Drawer 内首个可操作控件。
- Tab / Shift+Tab 在 Drawer 内形成焦点陷阱。
- Escape 在非 busy 状态关闭。
- 点击 backdrop 在非 busy 状态关闭。
- `busy=true` 时禁止 Escape / backdrop 误关闭。
- 关闭 / 卸载后，如果来源元素仍在 DOM 中，则恢复来源焦点。

真实版块管理流程已验证过：`更多操作 -> 编辑设置 -> Drawer -> Escape` 可以正常退出，版块业务 mutation 未被改变。

## 5. 已完成：顶部个人菜单

文件：

- `src/components/SiteHeader.tsx`
- `src/components/SiteHeader.search.test.tsx`

此前个人菜单虽然有 `role="menu" / role="menuitem"`，但缺少完整的键盘导航和 outside-dismiss 语义。本轮已经补齐：

- ArrowUp / ArrowDown 可从头像触发器直接打开并进入菜单。
- 打开后支持方向键、Home / End 循环移动。
- Escape 关闭并恢复头像触发器焦点。
- 点击菜单外部关闭。
- 个人主页 / 会员中心 / 收藏 / 私信 / 通知 / 站点管理 / 退出登录都继续使用原业务入口和权限条件。

最新 1440x1000 production 使用正式 `demo_admin` 登录后已真实打开个人菜单，浏览器无障碍树确认菜单项均为 `menuitem`。

## 6. 已完成：内容治理主题操作菜单

文件：

- `src/components/ModerationAdminPanel.tsx`
- `src/components/ModerationAdminPanel.test.tsx`

此前治理表格的“操作”弹出层虽然声明 `role="menu"`，内部动作仍是普通 button 语义，且只处理 Escape / outside click，没有完整焦点移动规则。本轮已经收敛为真正菜单：

- 触发器增加稳定 ref。
- ArrowUp / ArrowDown 可直接打开并聚焦首 / 末菜单项。
- 菜单内支持 ArrowUp / ArrowDown、Home / End、Escape。
- Escape 后焦点恢复到该主题行的“操作”触发器。
- 点击外部关闭并恢复触发器焦点。
- 真实动作全部标为 `role="menuitem"`：隐藏、驳回、置顶 / 取消置顶、精选 / 取消精选、锁定 / 解锁、移动、处理记录。
- 原 capability 判断、revision、mutation、确认 dialog、处理记录逻辑保持不变。

最新 1440x1000 production：正式 `demo_admin` 打开 `#admin/moderation`，真实主题“阿斯达四方as2222”的操作菜单成功展开，无障碍树确认 7 个动作均为 `menuitem`。本次只验证菜单行为，**没有执行任何破坏性治理 mutation**。

## 7. 已完成：共享 ModalDialog 与高风险确认生命周期

新增：

- `src/components/ui/ModalDialog.tsx`
- `src/components/ui/ModalDialog.test.tsx`

共享 `ModalDialog` 只负责瞬态层生命周期，不接管业务 API：

- 打开后按指定 selector 或首个可操作控件接管焦点。
- Tab / Shift+Tab 在 modal 内形成焦点陷阱。
- Escape / backdrop 在 idle 状态关闭。
- `busy=true` 时阻止 Escape / backdrop 误关闭，并暴露 `aria-busy`。
- 打开时锁定 body 滚动，卸载时恢复。
- 关闭后优先恢复显式 `returnFocus`，否则恢复打开前焦点。
- 支持 `dialog` / `alertdialog`，并可使用 `section` / `div` / `form` 作为根元素。

`BoardAdminPanel` 的合并 / 删除已迁移到共享生命周期：

- 合并保留原 merge impact、revision、audit id、24 小时 rollback 与 mutation 语义。
- 删除保留原 deletion impact 与阻断规则。
- 两类确认都记录稳定的版块“更多操作”触发器，关闭后恢复来源焦点。
- loading / pending 时禁止误关。
- `BoardAdminPanel` 定向最终 **14 / 14 PASS**。
- 新增测试实际捕获过一个“返回焦点落到已卸载 menuitem 后掉回 body”的缺口，现已通过显式稳定触发器修复；这是已修复的中间问题，不是最终失败。

## 8. 已完成：其余手写 dialog 审计与真实缺口修复

已接入共享 `ModalDialog` 的真实缺口：

- `features/admin-membership/EntitlementsWorkspace.tsx`
  - 发布权益版本
  - 发放标准权益
  - 撤销权益
- `components/CommunityGroupAdminPanel.tsx`
  - 归档用户组
- `components/DeviceSessionsPanel.tsx`
  - 撤销设备会话 `alertdialog`
- `components/AuthPanel.tsx`
  - 登录 / 注册身份层

同时补了组件级回归，覆盖初始焦点、Tab 环、Escape、backdrop、busy lock、关闭后来源焦点恢复，以及真实业务提交路径不回退。

静态扫描剩余 `aria-modal="true"` 后，下列实现本身已经具备正确的焦点 / 键盘 / busy 生命周期，因此**刻意不为了统一而重写**：

- `CommunityGroupQuotaDialog.tsx`
- `GrowthLevelFormDialog.tsx`
- `MembershipAdminPanel.tsx` 的成长等级删除确认
- `ModerationAdminPanel.tsx`
- `TopicComposer.tsx`
- `ui/Drawer.tsx`

## 9. 最终自动化门禁

最终执行结果：

- 共享 dialog 与接线组件定向：**6 files / 55 tests PASS**。
- `BoardAdminPanel`：**14 / 14 PASS**。
- 前端全量：**80 files / 585 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `git diff --check -- daoyun`：**PASS**；仅 Windows LF / CRLF 提示，没有 whitespace error。
- `pnpm build`：**PASS**。
- Vite：**6.4.3**。
- production build：**1761 modules transformed**。
- production CSS：`260.02 kB / 39.05 kB gzip`。
- 最新主 bundle：约 `395.77 kB / 107.81 kB gzip`。
- 最新 AdminApp chunk：约 `230.33 kB / 59.16 kB gzip`。

Phase 4 前一阶段曾记录 `79 files / 577 tests` 和 `1760 modules`；新增共享 `ModalDialog` 及其回归后，最终基线以上述 **80 / 585 / 1761** 为准。

## 10. 最终真实 production 验证

本机 production gateway：`http://127.0.0.1:5173`，由已构建 `dist` 提供前端并连接本地后端 API。

### 1440x1000

- 正式 `demo_admin` 登录成功。
- 顶部个人菜单真实打开，菜单项 role 正确。
- `#admin/boards` 的版块 ActionMenu 可真实展开；编辑设置可打开共享 Drawer；Escape 可关闭。
- `#admin/moderation` 正常加载真实治理队列，主题操作均为 `menuitem`。
- `#admin/boards` -> `社区广场` -> `合并版块`：真实合并 dialog 成功打开，目标列表包含“产品反馈 / 撒打算”；**未选择目标、未确认合并**，使用 Escape 取消。
- `#admin/boards` -> `社区广场` -> `删除版块`：真实 deletion impact 返回 **0 个子版块 / 8 个主题 / 6 条回复**，页面提示需先处理内容，危险确认按钮保持 disabled；随后使用 Escape 取消。

### 390x844

- 正式 `demo_admin` 登录成功。
- 管理后台切换为移动布局，以“管理模块”下拉代替桌面侧栏。
- `#admin/boards` 的版块树与“更多操作”可正常使用。
- 合并确认可完整打开并使用 Escape 取消；没有选择目标或执行 mutation。
- 删除确认同样返回 **0 个子版块 / 8 个主题 / 6 条回复**，确认按钮 disabled，并使用 Escape 取消。

两个 viewport 均只执行“打开 + 取消”验收，**没有执行隐藏、驳回、移动、删除、合并等破坏性 mutation**。当前 production 流程没有发现新的 JS / 业务崩溃；登录前匿名 `/auth/session` 的 401 仍属于现有预期行为。

## 11. Phase 4 最终变更边界

本轮待随最终本地收口提交一起纳入的 DaoYun 文件包括：

- `daoyun/src/components/ui/ActionMenu.tsx`
- `daoyun/src/components/ui/ActionMenu.test.tsx`
- `daoyun/src/components/ui/Drawer.tsx`
- `daoyun/src/components/ui/Drawer.test.tsx`
- `daoyun/src/components/ui/ModalDialog.tsx`
- `daoyun/src/components/ui/ModalDialog.test.tsx`
- `daoyun/src/components/SiteHeader.tsx`
- `daoyun/src/components/SiteHeader.search.test.tsx`
- `daoyun/src/components/ModerationAdminPanel.tsx`
- `daoyun/src/components/ModerationAdminPanel.test.tsx`
- `daoyun/src/components/BoardAdminPanel.tsx`
- `daoyun/src/components/BoardAdminPanel.test.tsx`
- `daoyun/src/components/CommunityGroupAdminPanel.tsx`
- `daoyun/src/components/CommunityGroupAdminPanel.test.tsx`
- `daoyun/src/components/DeviceSessionsPanel.tsx`
- `daoyun/src/components/UserProfileView.test.tsx`
- `daoyun/src/components/AuthPanel.tsx`
- `daoyun/src/components/AuthPanel.test.tsx`
- `daoyun/src/features/admin-membership/EntitlementsWorkspace.tsx`
- `daoyun/src/features/admin-membership/EntitlementsWorkspace.test.tsx`
- `daoyun/src/styles.css`
- `daoyun/docs/handoff-phase4-2026-09-02.md`

父级 `Playground` 的其他未跟踪项目 / 文件没有被修改或暂存。本阶段不需要继续新增业务功能；下一阶段应从新的 Phase 5 计划 / 交接开始，而不是继续把已正确的 dialog 强行重构。

## 12. Git / 远端边界

- 只在父级 Git 根 `C:\Users\111\Documents\Playground` 执行 Git 操作。
- 只暂存明确的 `daoyun/...` 路径，**禁止 `git add -A`**。
- 父级仓库其他未跟踪项目保持不动。
- 当前分支名虽然历史上带 `codex/`，这只是分支名称；**不代表允许创建 Codex 会话**。
- 之前 FastSpider_FS push capability / 网络动作没有完成，因此除非后续真实 push 成功，否则交接始终写“本地提交为准 / 未确认远端已更新”。
