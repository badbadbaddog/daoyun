# 刀云（DaoYun）

面向自托管场景的现代社区平台。当前仓库包含响应式公开 Web 与 Rust API 基础层，不包含旧论坛迁移或兼容代码。

## 当前能力

- 响应式社区首页，覆盖桌面、平板和手机。
- 最新、热门、精华、关注 Feed 切换。
- 主题、板块和成员搜索。
- 发布主题弹窗。
- 浅色和深色模式。
- Axum API 进程与存活、就绪健康检查。
- 统一成功、错误和游标分页响应 envelope，并使用 UUID v7 `request_id`。
- 未匹配路由和不支持方法返回结构化错误码。
- OpenAPI 3.1 契约文档。
- Vitest、Cargo Test、Clippy 和生产构建门禁。

## 环境要求

- pnpm 9.12.3。
- Rust 1.94.1，项目通过 `rust-toolchain.toml` 固定版本。
- Windows 使用 MSVC 目标时需安装 Visual Studio C++ Build Tools；Linux 需提供系统 C/C++ 链接器。

## 运行 Web

```powershell
pnpm install
pnpm dev
```

默认地址：`http://127.0.0.1:5173/`

## 运行 API

```powershell
cargo run -p daoyun-api
```

默认地址：`http://127.0.0.1:3000/`

- 存活检查：`GET /api/v1/health/live`
- 就绪检查：`GET /api/v1/health/ready`
- OpenAPI：`GET /api/v1/openapi.json`
- 可通过 `DAOYUN_BIND_ADDR` 修改监听地址。

## 验证

```powershell
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm typecheck
pnpm build
```

## 工程结构

```text
apps/api/            Axum HTTP 进程、路由和中间件
crates/api-contract/ 公共请求响应 DTO 与 OpenAPI Schema
src/                 React 公开 Web
```

## 视觉基线

- 内容优先、低装饰、高信息密度。
- 桌面端三栏结构，平板端双栏结构，手机端单栏和底部导航。
- 中性表面搭配绿色品牌色，并使用蓝、琥珀和玫红表达内容语义。
- 面板圆角不超过 8px，避免页面区块全部卡片化。
- 参考 Rhex 的社区信息架构和紧凑布局，不复制其源码、品牌或产品文案。

## 下一阶段

1. 定义统一错误码、字段错误和游标分页契约。
2. 用 PostgreSQL 接入板块与主题列表，替换前端模拟数据。
3. 完成注册、登录和服务端会话的第一个端到端流程。
