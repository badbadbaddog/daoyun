# 站点管理后台改版规格

## 状态

已完成。五个阶段的契约、实现、文档与真实浏览器回归均已闭环。

## 目标

为 DaoYun 站长提供一个统一、可理解、可追溯的站点管理入口，使没有技术背景的站长能够完成用户管理、版块管理和举报处理，而不需要输入 UUID、内部权限键或原始数据。

本规格借鉴 phpwind 9 的用户搜索、版块树和举报队列流程，不复制其源码、品牌、iframe、多页面标签或旧式视觉。

### 目标用户

- 主要用户：站点所有者或承担全部管理职责的站长。
- 次要用户：只拥有部分治理 capability 的版主或运营人员。

### 核心任务

1. 找到一个用户，理解其当前状态，并安全地限制账号或调整角色。
2. 在层级结构中找到一个版块，完成新增、改名、排序、可见性或删除。
3. 从待办队列打开举报，在同一上下文中处理内容、作者和举报状态。

## 已确认的假设与决策

- 使用 `/#admin` 作为唯一“站点管理”入口，移除独立 `/#management` 产品入口。
- 服务端 capability、Cookie 会话、CSRF 和事务内授权继续作为最终安全边界。
- 首批交付顺序为用户管理、版块管理、举报处理；品牌、会员、运维和插件保留为低频系统设置。
- 用户管理首版包含搜索、管理员详情、限制发言、暂停账号、恢复账号、角色调整和管理记录。
- 首版不提供永久删除用户。
- `restricted` 用户可以登录和阅读，但不能发布主题、回复、发送私信或上传附件；`suspended` 用户不能建立有效登录会话或满足任何 capability 检查。
- 系统必须始终保留至少一个状态正常的 `super_admin`，站长不能暂停自己或最后一个可用超级管理员。
- 举报最终处置必须在一个事务内更新举报、目标内容、目标作者和审计；失败时全部回滚。
- 版块使用可选 `parent_id` 表达层级，首版最大深度为三级；客户端从平面响应组装树。

## 页面与交互原型

### 全局后台框架

```text
┌─────────────────────────────────────────────────────────────┐
│ DaoYun 站点管理        全局搜索       返回社区      当前账号 │
├──────────────┬──────────────────────────────────────────────┤
│ 工作台       │ 页面标题、用途说明、当前状态                  │
│ 用户管理     ├──────────────────────────────────────────────┤
│ 举报处理     │                                              │
│ 版块管理     │ 当前任务内容                                  │
│ 角色与权限   │                                              │
│ 系统设置     │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- 导航按 capability 显示，不可用模块不加载数据。
- 当前模块、筛选、分页和选中对象写入 URL，可刷新和分享。
- 320px 与 768px 下，左侧导航折叠为顶部模块选择，双栏页面切换为“列表 → 详情”单栏流程。
- 所有图标按钮必须有可访问名称和 tooltip。
- 所有颜色使用 `src/styles.css` 的语义 token，卡片圆角不超过 8px。

### 工作台

工作台只回答“今天需要处理什么”，不复制所有模块：

- 待处理与处理中举报数量，最多展示五条最新待办。
- 当前受限或暂停用户数量，最多展示五条即将到期记录。
- 隐藏版块和需要处理的版块异常摘要。
- 每个摘要都链接到已经带好筛选条件的业务页面。

首版不提供可配置组件、图表编辑器或跨模块批量操作。

### 用户管理

```text
搜索用户名、昵称或用户 ID  [状态] [角色] [搜索]

用户              状态       角色       举报数    最后活动
张三 @zhangsan     正常       成员       2         10 分钟前  →

用户详情
├── 概览
├── 最近内容
├── 举报记录
├── 角色与权限
└── 管理记录
```

#### 用户列表

- 搜索支持用户名、显示名称和用户 ID，不要求精确匹配。
- 筛选支持账号状态、角色和注册时间；使用游标分页。
- 每行显示用户摘要、账号状态、主要角色、内容数量、举报数量和最后活动时间。
- 列表不暴露邮箱、凭据、会话、外部身份标识或内部权限键。

#### 用户详情与动作

- 概览显示注册时间、最后活动、账号状态和当前限制。
- 最近内容和举报记录使用独立分页，不一次加载全部历史。
- 角色页复用现有角色与分配契约，但以用户为中心展示，不要求重新输入用户名。
- 限制发言、暂停账号和恢复账号使用统一操作抽屉：
  1. 选择动作。
  2. 设置期限；永久暂停必须是显式选项。
  3. 填写站长可理解的原因。
  4. 展示受影响能力和自动恢复时间。
  5. 确认后提交，成功页显示动作、期限、操作者和审计编号。
- 读取权限账号只看到只读信息，不显示最终会被 API 拒绝的写按钮。

### 版块管理

```text
全部展开  全部收起  搜索版块                    新建顶级版块

≡ 社区交流             公开   128 个主题   新增子版块  设置
  ≡ 新人报到           公开    35 个主题   新增子版块  设置
  ≡ 站务反馈           隐藏    12 个主题               设置
```

- 树行支持展开、收起、快速改名、调整同级顺序、切换可见性和新增子版块。
- 每次只保存一个版块动作，行内显示“保存中、已保存、保存失败”。
- 拖动排序必须同时提供键盘可用的“上移、下移、移入、移出”替代操作。
- 详细设置分为“基本设置、内容规则、访问权限”，不复制 phpwind 的长表单。
- 删除前查询影响摘要并展示子版块、主题和回复数量：
  - 存在子版块时拒绝删除，并引导先迁移或删除子版块。
  - 存在主题时拒绝直接删除，首版不自动迁移内容。
  - 成功删除仍沿用软删除和审计。
- 首版不提供不可逆版块合并；合并必须在后续规格中单独定义预览、迁移和回滚语义。

### 举报处理

```text
[待处理] [处理中] [已解决] [已驳回]   [类型] [时间] [刷新]

┌──────────────────────┬──────────────────────────────────────┐
│ 举报队列             │ 举报详情                              │
│ 垃圾广告 · 5 分钟前  │ 原内容与上下文                        │
│ 人身攻击 · 12 分钟前 │ 作者状态与历史举报                    │
│                      │ 举报者、理由和处理记录                │
│                      │ [隐藏内容] [限制作者] [驳回]          │
└──────────────────────┴──────────────────────────────────────┘
```

- 队列支持状态、目标类型和时间筛选，支持游标分页、刷新和空状态。
- 点击举报后加载详情，不要求跳转到其他管理页面才能理解上下文。
- 详情显示目标主题或回复、相邻上下文、目标作者状态、历史举报、举报理由和处理记录。
- “开始处理”只改变状态为 `in_review`，不执行内容或用户动作。
- 最终处置允许一次选择：
  - 内容动作：不处理、隐藏主题或隐藏回复。
  - 用户动作：不处理、限制发言或暂停账号，并可设置期限。
  - 举报结论：已解决或已驳回。
  - 内部备注：必填；不会展示给举报者或被举报者。
- 确认页显示所有动作的组合影响；成功结果逐项显示内容、用户、举报和通知状态。
- 批量操作首版只支持无副作用的“标记处理中”和“驳回”，不批量隐藏内容或暂停用户。

## API 契约

所有端点使用现有 `data/meta` 或 `error/meta` envelope，响应体 `meta.request_id` 与 `x-request-id` 相同。写请求使用 Cookie 会话、匹配的 CSRF Cookie 和 `x-csrf-token`，所有公共端点定义 OpenAPI。

### 用户管理

新增固定 capability：

- `admin.users.read`
- `admin.users.moderate`

新增端点：

- `GET /api/v1/admin/users?q=&status=&role_id=&registered_after=&registered_before=&cursor=&limit=`
- `GET /api/v1/admin/users/{user_id}`
- `GET /api/v1/admin/users/{user_id}/content?cursor=&limit=`
- `GET /api/v1/admin/users/{user_id}/reports?cursor=&limit=`
- `PATCH /api/v1/admin/users/{user_id}/status`

`AdminUserSummary` 至少包含：

- `id`、`username`、`display_name`、`avatar_url`
- `status`、`primary_role`
- `topic_count`、`post_count`、`report_count`
- `created_at`、`last_seen_at`

`AdminUserDetail` 在摘要基础上增加当前限制、公开资料、角色分配和 `revision`，不得包含密码、密码哈希、会话、令牌或外部身份声明。

`UpdateAdminUserStatusRequest`：

```rust
pub struct UpdateAdminUserStatusRequest {
    pub status: AdminUserStatus,
    pub reason: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub expected_revision: i64,
}
```

- `active` 不允许 `expires_at`。
- `restricted` 与 `suspended` 必须有 2 到 500 字的原因。
- 过期时间必须在未来；`null` 表示显式永久限制。
- 状态、revision 和审计在同一事务内更新。
- 目标不存在或调用者无权查看时使用不泄露账号存在性的统一错误。

角色调整继续复用 `/api/v1/admin/authorization/assignments`，前端从已加载用户详情传入目标，不再要求站长输入精确用户名。

### 版块树

扩展 `AdminBoard`、创建和更新请求：

- `parent_id: Option<Uuid>`
- `revision: i64`

`PATCH /api/v1/admin/boards/{board_id}` 增加可选 `parent_id`、`position` 和必填 `expected_revision`。服务端必须验证：

- 父版块存在且未删除。
- 不得把版块移动到自身或后代下面。
- 最终层级不超过三级。
- 同级排序在事务内保持稳定。
- 更新与审计原子完成。

删除端点保持现有软删除和“存在主题时拒绝”语义；响应错误增加子版块冲突信息，但不返回数据库细节。

### 举报详情与一体化处置

新增端点：

- `GET /api/v1/admin/reports/{report_id}`
- `POST /api/v1/admin/reports/{report_id}/moderations`

现有 `PATCH /api/v1/admin/reports/{report_id}` 只负责进入或退出 `in_review` 状态；最终处置由 moderation 子资源表达。

`CreateReportModerationRequest`：

```rust
pub struct CreateReportModerationRequest {
    pub disposition: ReportDisposition,
    pub content_action: ReportContentAction,
    pub user_action: Option<ReportUserAction>,
    pub public_reason: Option<String>,
    pub note: String,
    pub expected_revision: i64,
}
```

- `disposition` 为 `resolved` 或 `dismissed`。
- `dismissed` 只能搭配无内容、无用户副作用的动作。
- 用户动作包含 `kind`、`reason` 和可选 `expires_at`。
- `public_reason` 用于通知被处置作者；`note` 是只对管理员可见的内部备注，两者不得混用。
- 服务端在一个事务内重新校验 capability、锁定举报与目标、执行内容动作、执行用户动作、更新举报 revision、写审计和写通知 outbox。
- 返回更新后的举报、内容动作结果、用户动作结果和审计 ID。

扩展审计查询以支持 `resource_id`、`user_id` 和 `report_id` 过滤，使用户详情和举报详情可以展示相关管理记录。

## 稳定错误

- `admin.user_not_found`
- `admin.user_status_conflict`
- `admin.user_status_invalid`
- `admin.user_self_suspension_forbidden`
- `admin.user_last_super_admin_forbidden`
- `admin.board_parent_invalid`
- `admin.board_depth_exceeded`
- `admin.board_has_children`
- `governance.report_not_found`
- `governance.report_conflict`
- `governance.moderation_invalid`
- `governance.target_state_conflict`

错误响应必须说明用户可以采取的下一步，但不得泄露 SQL、凭据、私有身份字段或越权资源状态。

## 技术栈与命令

- Frontend：React 19、TypeScript、Vite、Vitest、Testing Library、Playwright。
- Backend：Rust 1.94.1、Axum 0.8、Tokio、Serde、utoipa、SQLx/PostgreSQL。

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm generate:api -- --check
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
$env:DAOYUN_LOCAL_E2E = "1"
pnpm test:e2e
```

## 项目结构

- `docs/decisions/`：统一后台入口的决策与替代方案。
- `docs/specs/`：本规格及后续变更。
- `migrations/`：用户状态 revision、版块层级和必要索引的正反迁移。
- `crates/api-contract/src/`：公共 DTO 与 OpenAPI schema，不暴露持久化模型。
- `crates/infrastructure/src/`：参数化查询、事务、锁和审计。
- `apps/api/src/`：Axum 路由、输入边界校验、鉴权和 OpenAPI。
- `src/api/`：生成契约之外的运行时响应校验和客户端映射。
- `src/components/`：server-shaped 容器与展示组件分离，测试与组件同目录。
- `e2e/`：真实 Chromium 的站长核心流程。

## 代码风格

```tsx
export function UserStatusAction({ user, onSubmit }: UserStatusActionProps) {
  return (
    <form aria-labelledby="user-status-action-title">
      <h2 id="user-status-action-title">管理 {user.displayName} 的账号状态</h2>
      {/* 影响摘要来自服务端状态，不由展示组件推断授权。 */}
    </form>
  );
}
```

- React 组件和领域数据使用命名导出。
- API 原始数据与展示组件 props 分离。
- 不在组件中硬编码主题颜色。
- Lucide 只用于界面控制图标，图标按钮提供 label 和 tooltip。
- Rust DTO、持久化 record 和展示模型保持分离。

## 测试策略

- 先添加失败的行为测试，再实现每项新行为。
- Migration 测试覆盖正反迁移、层级约束、revision 和索引。
- Infrastructure 测试覆盖用户状态并发冲突、版块循环/深度、举报事务回滚与审计原子性。
- API/OpenAPI 测试覆盖认证、CSRF、每项 capability、分页、稳定错误、私有字段缺失和 request ID 一致性。
- 前端 API 测试拒绝不符合契约的运行时数据。
- 组件测试覆盖 loading、empty、forbidden、error、conflict、确认和成功结果。
- Playwright 覆盖桌面 1440px 和移动 390px 的用户限制、版块调整和举报处置；额外验证 320、768、1024、1440px 无页面级横向溢出。

## 边界

### 始终执行

- 在 API 边界校验输入，在 mutation 事务内重新授权。
- 状态改变、审计和通知 outbox 原子提交。
- 使用参数化 SQL、统一 envelope、request ID 和 OpenAPI。
- 高风险动作展示影响摘要并要求明确确认。
- 当前页面和筛选状态可刷新、可分享、可使用键盘操作。

### 实施前需再次确认

- 允许永久删除用户。
- 自动迁移主题后删除或合并版块。
- 增加新的外部依赖、搜索服务或队列。
- 让站点管理员修改固定 capability 目录。
- 批量隐藏内容、批量暂停用户等大范围治理操作。

### 禁止

- 从客户端状态推断最终授权。
- 在 UI 中要求站长输入 UUID、内部 capability key 或原始 JSON。
- 返回密码、会话、令牌、数据库错误或私有身份声明。
- 复制 phpwind 源码、品牌、产品文字或视觉资产。
- 为旧论坛产品增加迁移或兼容代码。

## 成功标准

- 新站长不阅读文档即可在一分钟内找到用户、版块和举报入口。
- 站长可以在三分钟内搜索用户并完成一次有期限、有原因的账号限制。
- 站长可以从举报队列查看原内容上下文，并一次完成内容、用户和举报处置。
- 站长可以在版块树中新增、改名、排序和调整可见性，且每次操作都有独立状态反馈。
- 所有高风险动作在确认前展示对象、范围、期限和不可逆后果。
- 所有成功结果展示实际动作、操作者、时间和审计 ID。
- 只读权限不会显示写操作；服务端仍拒绝所有越权直接请求。
- 320、768、1024、1440px 无页面级横向溢出，键盘和屏幕阅读器可以访问主要流程。
- Rust、前端、OpenAPI、生产构建和真实浏览器质量门全部通过。

## 非目标

- 重做会员等级、积分、勋章、运维监控或插件执行体验。
- 版块合并、永久删除用户和跨页危险批量操作。
- iframe、多页面标签、可配置仪表盘或移动端原生应用。
- 旧论坛数据迁移、兼容接口或 phpwind 主题复刻。

## 开放问题

无。若后续改变账号限制范围、版块最大深度或通知可见性，必须先更新本规格再修改契约。
