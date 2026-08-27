# 默认社区用户组

## 目标

在“会员经济 → 用户组”中提供清晰的“新用户默认用户组”设置。管理员可以从启用的基础组中选择一个全站默认组；之后创建的账号自动加入该组，已有账号的基础组不发生迁移。

## 技术栈

- React 19、TypeScript、Vite、Vitest、Testing Library。
- Rust 1.94.1、Axum 0.8、Serde、utoipa 5.5。
- PostgreSQL 16、SQLx 可回滚迁移。

## 命令

```powershell
pnpm test
pnpm typecheck
pnpm build
cargo test -p daoyun-infrastructure --test community_groups_migrations -- --test-threads=1
cargo test -p daoyun-api --test membership -- --test-threads=1
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

## 项目结构

```text
migrations/                    默认组数据约束和注册触发器
crates/api-contract/           默认组公共 DTO 与 OpenAPI Schema
crates/infrastructure/         默认组事务写入和审计
apps/api/                      管理端 HTTP 边界与鉴权
src/api/                       前端契约映射
src/components/                用户组管理界面和行为测试
docs/specs/                    活规格
```

## 契约与行为

- `is_base` 表示该组可作为用户唯一的基础组；它不等于注册默认组。
- `is_default` 表示该基础组是新账号的注册默认组。
- 全站始终且仅有一个启用的默认基础组。
- 只有 `status = active` 且 `is_base = true` 的组可设为默认组。
- 切换默认组只影响之后插入的用户；不得批量修改、撤销或补发已有成员关系。
- 默认组不能被停用或归档，必须先切换默认组。
- 管理端读取沿用 `community.groups.read`，切换默认组沿用 `community.groups.write`、Cookie 会话、CSRF、近期认证、事务审计和 request ID 规范。
- 默认组切换使用专用单例资源接口，并带当前默认组的 expected revision；并发过期返回稳定的冲突响应。

## 界面

- “默认用户组”设置位于用户组工作区顶部、组列表之前。
- 只读管理员可以看到当前默认组和规则说明，但不能提交修改。
- 写权限管理员从启用的基础组中选择并保存；当前默认组在列表中有明确标签。
- 文案明确说明“仅影响之后注册的新用户，不会迁移现有用户”。
- 单个成员的“成员绑定”只管理附加组，并作为次级管理区域展示。
- 覆盖加载、保存中、成功、失败、并发冲突和无可选基础组状态；支持键盘操作和 320/768/1024/1440 像素宽度。

## 测试策略

- 迁移测试证明默认数据唯一、注册使用配置的默认组、回滚完整。
- API 集成测试证明读权限、写权限、CSRF、目标组校验、revision 冲突、切换后新用户生效且旧用户不迁移。
- 前端行为测试证明当前默认值、只读状态、保存请求、成功与冲突反馈。
- 浏览器验证浅色/深色、响应式、控制台和实际请求。

## 边界

- 始终：先写失败行为测试；写入事务内重新鉴权并记录审计；公共响应保持 request ID 一致。
- 本次允许：新增可回滚数据库迁移和加法式 API 字段。
- 不做：自动迁移已有用户、允许附加组成为默认组、删除基础组、改变 RBAC 角色或用户组权限合并规则。
- 永不：用前端状态代替服务端约束，或让一个用户同时拥有多个有效基础组。

## 成功标准

- 页面首要展示当前默认用户组，交互语义不再以逐用户绑定为主。
- 数据库约束保证默认基础组唯一，注册触发器不再依赖 `registered_member` 硬编码。
- 切换默认组后，新账号进入新默认组；已有账号保持原基础组。
- 全部定向测试、前端测试、类型检查、生产构建、Rust 格式与 lint 通过。
