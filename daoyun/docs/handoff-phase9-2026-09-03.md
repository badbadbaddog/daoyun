# DaoYun Phase 9 交接 — 2026-09-03

状态：**DONE**

> Phase 9 于 2026-09-02 晚间开始，跨午夜后于 2026-09-03 完成最终门禁与收口。

## 1. 基线

- 项目：`C:\Users\111\Documents\Playground\daoyun`
- Git 根：`C:\Users\111\Documents\Playground`
- 分支：`codex/daoyun-home-foundation`
- Phase 8 基线提交：`abf670c439c0a0070c75c57be268730a99c412f6`
- Phase 8 基线：81 files / 606 tests PASS
- 本阶段只使用 FastSpider_FS；未创建或使用 Codex 会话。
- 不执行 push。

## 2. Phase 9 目标

Phase 9 是 Web 主线的最终交互 / Accessibility / Responsive 终审，不扩展产品功能，只处理能够真实复现的现有缺口。

检查范围：

- 1440 desktop
- 1024 medium desktop / tablet landscape
- 768 tablet / mobile shell transition
- 390x844 mobile
- public feed / search / topic detail / profile / notifications / messages
- admin shell
- keyboard tab semantics
- focus / dialog / drawer / live region
- console / network / page error
- responsive switch points

## 3. 静态终审

针对生产 TSX/CSS 做了补充静态检查：

- 非语义元素直接绑定 `onClick`：未发现需要修复的生产入口。
- 正数 `tabIndex`：未发现；现有 tab 继续使用 roving `0/-1`。
- 首页封面 link 最初在 browser agent snapshot 中看似无 accessible name；源码核对确认封面 link 使用 `aria-hidden="true"` + `tabIndex={-1}`，真实 ARIA snapshot 不暴露该节点，因此不是 a11y 缺陷，没有为了误报修改代码。

## 4. 本阶段发现并修复的真实缺口

### 4.1 自己主页“账号与安全”可同时展开多个面板

涉及：

- `src/components/UserProfileView.tsx`
- `src/components/UserProfileView.test.tsx`

真实复现：

1. 1440 production 打开自己的 `#user/demo_admin`。
2. 点击“修改密码”。
3. 再点击“管理设备会话”。
4. 原实现会同时保留“修改密码”和“设备会话”两套工作区。

实际影响：

- 当前本地账号拥有较多历史设备会话，设备会话列表很长。
- 多个安全面板同时展开会让另一块工作区被推到页面很下方。
- 390px 下问题更加明显。
- 五个安全入口原本也没有 `aria-expanded` / `aria-controls`，辅助技术无法判断哪个区域处于展开状态。

修复：

- 将 5 个独立 boolean 改为单一 `OwnerSecurityPanel` 状态：
  - `devices`
  - `password`
  - `identities`
  - `passkeys`
  - `mfa`
  - `null`
- 同一时间最多只渲染一个安全工作区。
- 再次点击当前入口可以收起。
- 五个入口增加准确的 `aria-expanded`。
- 五个入口增加 `aria-controls` 并对应稳定 panel id。
- OIDC callback 原有 `openExternalIdentities` 行为保留。
- Profile edit 与安全工作区保持独立，不额外改动资料编辑流程。

新增回归：

`keeps only one owner security panel open and exposes its expanded state`

测试证明：

- 初始密码 / 设备入口均 `aria-expanded=false`。
- 打开密码工作区后密码入口为 expanded。
- 再打开设备会话后密码工作区被真正卸载，而不是 CSS 隐藏。
- 设备入口变为 expanded。
- 页面只剩设备会话 region。

定向：`src/components/UserProfileView.test.tsx` = **16/16 PASS**。

## 5. 1440x1000 production 验收

验证路径包括：

- `#hot`
- `#messages`
- `#notifications`
- `#user/demo_admin`
- `#topic/01a051d1-9592-7b41-846a-50de670441da`
- `#search?q=社区&scope=topics`
- `#admin/dashboard`

结果：

- 首页双侧栏 / 主 feed 完整。
- 首页 tab 通过键盘 ArrowRight 可从“推荐”切换到下一 tab，roving tab 行为正常。
- 消息页会话区、主 region、空状态结构正常。
- 通知页 tablist / tabpanel 正常。
- Topic detail 的 breadcrumb、topic actions、回复编辑器等语义完整。
- Search 的 topics / boards / users tab 结构正常。
- Admin desktop sidebar 完整。
- 除上述账号安全多面板问题外，没有发现第二个需要修改代码的真实缺口。
- browser events 只有登录前预期的 401，无 post-login page error / JS crash。

## 6. 1024x900 production 验收

Public：

- 左社区导航保留。
- 右侧“社区信息”退出布局。
- 主 feed、搜索、发布和 feed controls 保持完整。

Admin：

- 1024 仍保留完整 desktop 管理侧栏。
- 主工作区无横向溢出或控件丢失。

Events：

- 仅登录前预期 401。
- 未发现新的 page error / JS crash。

## 7. 768x900 production 验收

Public：

- 正确切入 mobile shell。
- desktop sidebars 退出。
- 顶部搜索切为“打开搜索”按钮。
- 底部移动导航：首页 / 社区 / 发布 / 通知 / 我的完整。
- 首页 feed / tabs 保持可用。

Admin：

- desktop 管理侧栏退出。
- 使用单一“管理模块” combobox 切换模块。
- 工作台 heading、待办 status regions 完整。

环境事件：

- 验收中旧本地服务曾停止，真实端口检查为 `API=False WEB=False`。
- 这不是前端断言失败。
- 使用正确命令 `pnpm local --no-browser` 恢复。
- 新服务 job：`job_ywwhFTmev5ErPgalrGBkDo2VQy9uKvxl`。
- 恢复后 API / gateway / PostgreSQL 正常，fresh page 继续验收。
- 旧页面的连接失败记录不作为 Phase 9 UI 缺陷。

## 8. 390x844 production 验收

Public / profile：

- mobile header + bottom navigation 正常。
- 自己主页的资料、统计、社区身份、账号与安全、用户内容 tabs 均可访问。

本阶段修复的真实 production 验收：

1. 点击“修改密码”。
2. ARIA snapshot 明确显示“修改密码”按钮 `[expanded]`。
3. 页面存在且只存在“修改密码” region。
4. 再点击“管理设备会话”。
5. “修改密码” region 完全消失。
6. “管理设备会话”按钮变为 `[expanded]`。
7. 页面只剩“设备会话” region。
8. 证明实现是互斥 render/unmount，不是只做视觉隐藏。

Admin：

- `#admin/dashboard` 在 390 下正常使用“管理模块”选择器。
- 待办和状态 region 完整。

Events：

- fresh 390 session 只有登录前预期 401。
- 无 post-login JS/page error。

## 9. Responsive / CSS 结论

Phase 9 没有修改 CSS。

原因：

- 1440 / 1024 / 768 / 390 的真实布局切换均符合现有设计。
- 1024 的右侧栏退出、768 的 mobile shell、390 的 admin module selector 都已真实验证。
- 没有发现足够证据支持额外的泛化 CSS 改造。

保持“不为优化而优化”的边界。

## 10. 最终门禁

### 定向

- `src/components/UserProfileView.test.tsx`：**16/16 PASS**

### 全仓

- `pnpm test`：**81 files / 607 tests PASS**
- Phase 8：606 tests
- Phase 9：新增 1 条真实交互回归
- `pnpm typecheck`：PASS
- `pnpm build`：PASS
- Vite：`6.4.3`
- transformed modules：**1762**
- `git diff --check -- daoyun`：PASS，仅 Windows LF -> CRLF 提示

最终 production bundle 摘要：

- CSS：约 `259.35 kB / 38.99 kB gzip`
- `UserProfileView`：约 `38.95 kB / 10.07 kB gzip`
- `AdminApp`：约 `235.65 kB / 61.09 kB gzip`
- main index：约 `394.43 kB / 107.39 kB gzip`

## 11. Phase 9 文件边界

本阶段预期提交只有：

1. `daoyun/docs/handoff-phase9-2026-09-03.md`
2. `daoyun/src/components/UserProfileView.tsx`
3. `daoyun/src/components/UserProfileView.test.tsx`

不得纳入父仓库其他未跟踪内容。

## 12. 本地运行状态

收口时本地服务仍由：

`job_ywwhFTmev5ErPgalrGBkDo2VQy9uKvxl`

运行，最近 job 状态仍为 `running`。

服务：

- Web：`http://127.0.0.1:5173/`
- API：`127.0.0.1:3000`
- PostgreSQL：`127.0.0.1:55433`

## 13. 下一阶段：Phase 10

Phase 9 后不再继续扩 Web 交互功能。

Phase 10 建议作为正式交付收口：

1. 最终仓库级门禁与可执行环境核验。
2. OpenAPI / generated client zero-diff（环境允许时）。
3. Rust workspace / DB integration 可运行项复核，并如实记录环境阻塞项。
4. 最终产品 / 实现 / handoff 文档同步。
5. 最终 Git 状态与本地提交链核对。
6. 是否 push / PR 仍需用户明确要求；默认不 push。

Phase 10 应避免重新打开已经通过 Phase 4-9 验收的前端交互范围，除非最终门禁暴露真实回归。
