# DaoYun Phase 5 交接：2026-09-02

> 当前状态：**DONE / LOCAL CLOSURE COMMIT**。Phase 5 以 `1015f8c6f375d047268c80eba3d85ff14c784d2c`（`feat: complete phase 4 interaction hardening`）为基线，完成浏览器原生阻塞确认框的收敛：后台高风险写操作与前台发布器未保存退出均迁移到站内可访问确认层。本文档与 Phase 5 源码位于同一个本地独立收口提交；提交 SHA 不在提交内容中自引用，最终以父仓库 `git log -1` 为准。远端仍未确认更新。

## 1. 基线与强约束

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- 父级 Git 根：`C:\Users\111\Documents\Playground`
- 当前分支：`codex/daoyun-home-foundation`
- Phase 5 起点：`1015f8c6f375d047268c80eba3d85ff14c784d2c feat: complete phase 4 interaction hardening`
- Phase 5 开始时本地分支相对 origin：**ahead 10**；本阶段本地收口提交完成后将再增加 1 个本地提交。除非后续真实 push 成功，否则不要写成“已 push”。
- 用户硬约束：**不要创建或使用 Codex 会话，全程只使用 FastSpider_FS 直接完成代码、审计、测试、浏览器验收和本机操作。**
- 父级 `Playground` 存在大量与 DaoYun 无关的未跟踪项目 / 文件；本阶段只修改并暂存明确的 `daoyun/...` 路径，**禁止 `git add -A`**。

## 2. Phase 5 目标

Phase 4 已经把 menu、drawer、modal 的焦点生命周期和 busy lock 收敛。本阶段继续处理仍绕开该交互基础设施的浏览器原生确认框，目标是：

1. 破坏性操作不再使用 `window.confirm` / `window.alert` 阻塞浏览器主线程。
2. 用户在提交前能看到明确的影响说明，并默认把焦点放在安全的“取消”动作。
3. Escape / backdrop / Tab / busy 状态沿用统一的可访问 modal 生命周期。
4. 确认前不得提前调用 mutation API；真正确认后继续使用原 API、revision、审计和错误语义。
5. 发布器的未保存退出不能和底层编辑器自身 Escape / Tab 监听互相抢事件。

## 3. 新增共享 ConfirmDialog

新增：

- `src/components/ui/ConfirmDialog.tsx`
- `src/components/ui/ConfirmDialog.test.tsx`

`ConfirmDialog` 基于 Phase 4 的 `ModalDialog`，没有复制第二套 modal 生命周期。当前语义：

- 使用 `role="alertdialog"`。
- 默认初始焦点落到“取消”，避免危险操作默认获得焦点。
- Tab / Shift+Tab 由 `ModalDialog` 形成焦点环。
- idle 状态支持 Escape / backdrop 取消。
- `busy=true` 时禁用取消 / 确认，并阻止 Escape / backdrop 误关闭。
- 关闭后恢复到显式来源控件。
- 支持危险确认与非危险恢复动作使用不同按钮语义。

组件级回归覆盖默认安全焦点、焦点环、Escape、来源焦点恢复和 busy lock。

## 4. 后台高风险写操作已迁移

本轮将以下原生确认全部迁移到共享 `ConfirmDialog`：

### 4.1 角色与权限

文件：

- `src/components/AuthorizationAdminPanel.tsx`
- `src/components/AuthorizationAdminPanel.test.tsx`

完成：

- 删除自定义角色。
- 撤销角色分配。
- 打开确认层时保存稳定来源按钮；取消后恢复焦点。
- mutation 成功后关闭确认层，原删除 / 撤销 API 与分配计数更新逻辑保持不变。
- 新增角色删除回归：确认前 API 为 0 次调用，Escape 可取消，重新打开后明确确认才调用删除 API。

### 4.2 插件卸载

文件：

- `src/components/PluginAdminPanel.tsx`
- `src/components/PluginAdminPanel.test.tsx`

完成：

- 停用插件的“卸载”不再调用浏览器确认框。
- 确认层明确说明站点移除与安全边界不放宽。
- 取消时不调用 `deletePlugin`；确认后继续使用原卸载 API。

### 4.3 举报处置

文件：

- `src/components/ReportAdminPanel.tsx`
- `src/components/ReportAdminPanel.test.tsx`

完成：

- 表单第一次提交只生成不可变的待确认处置 payload，不直接写 API。
- 确认层展示“隐藏内容 / 限制或暂停作者 / 解决或驳回举报”等真实影响摘要。
- 明确二次确认后才调用 `moderateAdminReport`。
- 原 `expectedRevision`、内容动作、用户动作、公开说明、内部备注与通知语义保持不变。

### 4.4 用户账号状态

文件：

- `src/components/UserStatusAction.tsx`
- `src/components/UserAdminPanel.test.tsx`

完成：

- 限制、暂停、恢复账号均使用站内确认。
- 确认前先固化 status / reason / expiresAt 和影响文本。
- “恢复账号”使用非危险主按钮；限制 / 暂停继续使用危险动作语义。
- 切换用户时清理未完成确认，避免确认上下文串到另一用户。
- 原 revision、审计编号和结果反馈保持不变。

### 4.5 用户自定义角色移除

文件：

- `src/components/UserRoleAction.tsx`
- `src/components/UserAdminPanel.test.tsx`

完成：

- 移除用户自定义角色不再使用原生确认。
- 明确提示相关权限会立即失效。
- 确认前不调用撤销 API；确认后使用原 assignment id 与 CSRF token。
- 切换用户时清理待确认角色。

## 5. 发布器未保存退出已迁移

文件：

- `src/components/TopicComposer.tsx`
- `src/components/TopicComposer.test.tsx`

此前发布器在检测到当前编辑内容与最近一次本地草稿 snapshot 不一致时调用 `window.confirm`。本轮改为嵌套的共享 `ConfirmDialog`：

- 未保存修改存在时，关闭按钮 / Escape / backdrop 先进入“关闭发布窗口？”确认层。
- 确认层打开期间，底层发布器自己的 Escape / Tab 监听主动让出控制权，避免双重焦点陷阱。
- Escape 只取消上层确认，底层发布器继续保留编辑内容。
- 取消后焦点恢复到原关闭来源。
- 只有明确点击“确认关闭”才真正退出。
- 发布成功仍直接清理本地草稿并关闭，不增加无意义二次确认。

组件回归真实覆盖：输入未保存修改 -> 请求关闭 -> `alertdialog` -> Escape 取消 -> 焦点恢复 -> 再次打开 -> 明确确认后关闭。

## 6. 原生阻塞确认静态收口

完成上述迁移后，对 production `src/**/*.ts(x)` 扫描：

- `window.confirm`：**0 matches**。
- `window.alert`：**0 matches**。

这只表示本项目生产源码不再依赖这两类浏览器阻塞 API；没有把业务中普通的“确认”函数命名误判为问题。

## 7. 最终自动化门禁

最终结果：

- ConfirmDialog + 五组接线 + TopicComposer 定向：**6 files / 49 tests PASS**。
- 前端全量：**81 files / 592 tests PASS**。
- `pnpm typecheck`：**PASS**。
- `git diff --check -- daoyun`：**PASS**；仅 Windows LF / CRLF 提示，没有 whitespace error。
- `pnpm build`：**PASS**。
- Vite：**6.4.3**。
- production build：**1762 modules transformed**。
- production CSS：约 `259.35 kB / 38.99 kB gzip`。
- 主 bundle：约 `394.30 kB / 107.36 kB gzip`。
- AdminApp chunk：约 `229.95 kB / 59.27 kB gzip`。
- TopicComposer chunk：约 `8.74 kB / 3.71 kB gzip`。
- ConfirmDialog 独立 chunk：约 `0.86 kB / 0.46 kB gzip`。

Phase 4 最终基线为 80 files / 585 tests / 1761 modules；Phase 5 新增共享确认组件及回归后，最终基线以上述 **81 / 592 / 1762** 为准。

## 8. 真实 production 验收

本机 production gateway：`http://127.0.0.1:5173`，本轮验收前 HTTP 返回 **200**。

### 1440x1000

- 正式本地管理员账号 `demo_admin` 登录成功。
- `#admin/authorization` 真实读取角色目录；自定义角色“版主”当前为 0 个分配。
- 点击真实“删除角色：版主”后，页面成功出现 `alertdialog`：`删除角色“版主”`，包含“取消 / 确认删除角色”。
- 使用 Escape 取消，**没有执行删除 mutation**。
- 回到前台打开真实发布器，在正文输入“Phase5 只读验收，未发布”后立即点击关闭。
- 页面成功出现 `alertdialog`：`关闭发布窗口？`，底层“发布内容”dialog 保持存在。
- 使用 Escape 取消上层确认，**没有发布主题**。
- 浏览器事件仅看到登录前匿名会话请求产生的预期 401；未发现本轮新增的脚本崩溃。

本次 production 验收严格使用“打开 + 取消 / Escape”，没有删除角色、卸载插件、处置举报、修改账号状态、撤销角色或发布主题。

## 9. Phase 5 最终变更边界

本阶段随本地收口提交纳入的 DaoYun 文件：

- `daoyun/src/components/ui/ConfirmDialog.tsx`
- `daoyun/src/components/ui/ConfirmDialog.test.tsx`
- `daoyun/src/components/AuthorizationAdminPanel.tsx`
- `daoyun/src/components/AuthorizationAdminPanel.test.tsx`
- `daoyun/src/components/PluginAdminPanel.tsx`
- `daoyun/src/components/PluginAdminPanel.test.tsx`
- `daoyun/src/components/ReportAdminPanel.tsx`
- `daoyun/src/components/ReportAdminPanel.test.tsx`
- `daoyun/src/components/UserStatusAction.tsx`
- `daoyun/src/components/UserRoleAction.tsx`
- `daoyun/src/components/UserAdminPanel.test.tsx`
- `daoyun/src/components/TopicComposer.tsx`
- `daoyun/src/components/TopicComposer.test.tsx`
- `daoyun/src/styles.css`
- `daoyun/docs/handoff-phase5-2026-09-02.md`

父级 `Playground` 其他未跟踪项目 / 文件没有被修改或暂存。

## 10. 下一阶段建议

Phase 5 已完成“浏览器阻塞确认 -> 统一站内确认”的收口。下一阶段应新建 Phase 6，而不是继续重写已经正确的 modal。建议优先审计：

1. 非原生交互控件中仍存在的点击语义、键盘语义与 ARIA 不一致。
2. 异步按钮的局部 pending / 重复提交 / 错误恢复与 live-region 一致性。
3. 后台高风险表单的 revision 冲突与刷新恢复是否都有一致入口。
4. 390px 管理端在复杂表格 / 表单上的可操作密度与横向溢出。
5. 只在发现真实缺口时继续抽象共享组件，避免为了“统一”而重构已经正确的实现。
