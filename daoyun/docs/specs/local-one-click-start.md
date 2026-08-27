# DaoYun 本地一键启动器

## Objective

为站长和开发者提供唯一的本地启动入口，同时启动 PostgreSQL、Rust API 和 Vite 前端，并确保数据库数据不会因清理 `target`、切换端口或重复启动而丢失。

## Commands

- 一键启动：`pnpm local`
- Windows 双击：`start-local.bat`
- 测试：`pnpm exec vitest run scripts/start-local.test.mjs scripts/local-development.test.mjs`
- 全量测试：`pnpm test`
- 类型检查：`pnpm typecheck`
- 构建：`pnpm build`

## Project Structure

- `scripts/start-local.mjs`：PostgreSQL 初始化、数据库身份校验、API/Web 编排和退出清理。
- `scripts/start-local.test.mjs`：启动配置与安全行为测试。
- `start-local.bat`：Windows 双击入口，只调用统一 Node 启动器。
- `package.json`：公开 `pnpm local` 命令。

## Code Style

```js
const child = spawn(command, arguments_, {
  cwd: projectDirectory,
  env: childEnvironment,
  stdio: "inherit",
})
```

使用参数数组启动子进程，不拼接 shell 命令；纯配置函数导出供 Vitest 验证。

## Testing Strategy

- 小型单元测试覆盖参数解析、稳定数据目录、PostgreSQL 命令构造和目录身份校验。
- 不在单元测试中启动真实 PostgreSQL 或 Rust API。
- 完成后使用真实本机 PostgreSQL 做一次端到端启动与重启验证。

## Boundaries

- Always：数据库只绑定回环地址；默认数据目录位于用户本地应用数据目录；启动时验证端口上的 PostgreSQL 是否属于该目录。
- Ask first：删除、重建或覆盖已有数据库；迁移旧业务数据；修改数据库结构。
- Never：自动切换到另一个空库；把密码写入仓库；把持久数据放入 `target` 或 `%TEMP%`；静默忽略迁移错误。

## Success Criteria

- `pnpm local` 一次启动 PostgreSQL、API 和前端。
- `start-local.bat` 与 `pnpm local` 使用完全相同的实现。
- 默认 PostgreSQL 数据目录不在项目 `target` 或系统临时目录。
- 重复启动使用同一数据目录和 `daoyun_dev` 数据库。
- 55433 端口若被其他 PostgreSQL 数据目录占用，启动器明确失败而不误连。
- PostgreSQL、API 或 Web 启动失败时返回非零状态，不创建替代空库。
- 测试、类型检查和生产构建通过。

## Open Questions

- 旧实例中未找到需要自动迁移的主题数据；本次不执行破坏性恢复或数据库覆盖。
