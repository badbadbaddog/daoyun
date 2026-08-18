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
- 公开品牌配置读取、主题预设和 CSS Variables 运行时映射。
- OpenAPI TypeScript 声明生成脚本（从运行中的 `/api/v1/openapi.json` 生成 `src/api/generated.d.ts`）。
- 附件本地与标准 S3 API 对象存储 provider，支持安全扫描、缩略图和生命周期清理。
- PostgreSQL 迁移、安装状态单例和数据库感知的就绪检查。
- 默认关闭的 Wasmtime/WIT 插件平台，包含固定权限清单、资源配额、生命周期管理和空权限 sandbox iframe UI 扩展点。
- Vitest、Cargo Test、Clippy 和生产构建门禁。
- Playwright Chromium、axe 无障碍、首屏性能和 API 安全头回归门禁。
- GitHub Actions 在 Pull Request 与 `main` 推送上执行前端和 Rust 全量质量门禁。

## 环境要求

- pnpm 9.12.3。
- Rust 1.94.1，项目通过 `rust-toolchain.toml` 固定版本。
- PostgreSQL 16 或更高版本。
- PostgreSQL 客户端工具（`psql`、`pg_dump`、`pg_restore`）；Windows 默认安装目录为 `C:\Program Files\PostgreSQL\16\bin`。
- Windows 使用 MSVC 目标时需安装 Visual Studio C++ Build Tools；Linux 需提供系统 C/C++ 链接器。

## 运行 Web

```powershell
pnpm install
pnpm dev
```

默认地址：`http://127.0.0.1:5173/`

## 运行 API

```powershell
$env:DATABASE_URL = "postgresql://<user>:<password>@127.0.0.1:5432/<database>"
cargo run -p daoyun-api
```

本机已有 PostgreSQL 16 时，DaoYun 隔离开发实例可直接使用：

```powershell
$env:DATABASE_URL = "postgresql://daoyun@127.0.0.1:55433/daoyun_dev"
$env:DAOYUN_COOKIE_SECURE = "false"
cargo run -p daoyun-api
```

也可以使用固定本地启动命令，避免 HTTP 开发环境遗漏 Cookie 配置：

```powershell
pnpm api:local
```

Windows 缺少 MSVC `link.exe` 时，脚本会自动回退到已安装的 GNU Rust 工具链；两者都不可用时会直接给出安装提示。

## 本地固定测试账号

API 已启动且实例初始化完成后，执行一次或重复执行以下命令：

```powershell
pnpm seed:local
```

脚本只接受 `localhost`、`127.0.0.1` 或 `::1` 的 API 和 PostgreSQL 地址；已有账号会复用，不会重置凭据，也不会创建额外账号。

| 用途 | 用户名 | 密码 | 角色 |
| --- | --- | --- | --- |
| 管理测试 | `demo_admin` | `DaoYunLocalOnly!2026` | `super_admin` |
| 普通用户测试 | `demo_member` | `DaoYunLocalOnly!2026` | `member` |

这些凭据仅用于本机开发数据库，禁止用于任何可从公网访问的环境。

Windows 默认客户端目录为 `C:\Program Files\PostgreSQL\16\bin`；备份和恢复脚本会在 `PATH` 未配置时自动回退到该目录。

## 本地测试启动闭环

Windows 本机可使用仓库脚本复现前后端测试环境。脚本只接受 loopback 地址，并强制关闭本地 HTTP Cookie 的 `Secure` 属性：

```powershell
# 终端 1：隔离 PostgreSQL（已有实例时只需确认 55433 端口可连接）
$env:DATABASE_URL = "postgresql://daoyun@127.0.0.1:55433/daoyun_dev"

# 终端 2：API（启动时执行迁移）
$env:DAOYUN_PLUGINS_ENABLED = "true" # 真实插件回归需要显式启用；生产默认关闭
pnpm api:local

# 终端 3：Web，默认通过 Vite 将 /api 代理到 127.0.0.1:3000
pnpm dev

# 终端 4：初始化后创建或复用本地回归账号
pnpm seed:local
```

默认地址为 API `http://127.0.0.1:3000/`、Web `http://127.0.0.1:5173/`。固定回归账号见上方“本地固定测试账号”。
服务启动后可依次执行：

```powershell
$env:DATABASE_URL = "postgresql://daoyun@127.0.0.1:55433/daoyun_dev"
$env:DAOYUN_COOKIE_SECURE = "false"
$env:Path = "C:\msys64\mingw64\bin;$env:Path" # Windows 没有 link.exe 时启用 GNU linker
$env:CARGO_BUILD_JOBS = "1"                         # 低内存机器避免 metadata mmap 失败
rustup run 1.94.1-x86_64-pc-windows-gnu cargo test --workspace -j 1 -- --test-threads=1
rustup run 1.94.1-x86_64-pc-windows-gnu cargo clippy --workspace --all-targets -j 1 -- -D warnings
cargo fmt --all -- --check
pnpm test
pnpm typecheck
pnpm build
pnpm generate:api --check
$env:DAOYUN_WEB_URL = "http://127.0.0.1:5173"
$env:DAOYUN_API_URL = "http://127.0.0.1:3000"
$env:DAOYUN_LOCAL_E2E = "1"
pnpm test:e2e
```

`DAOYUN_LOCAL_E2E=1` 会额外运行使用 `demo_member` / `demo_admin` 的真实 API 业务测试；未设置时该文件不会进入默认 Playwright 集合。该测试强制 Web 与 API 使用 loopback HTTP 地址，并会在隔离开发数据库中持久写入带随机后缀的主题、回复和私信，禁止对共享或生产环境执行。本地套件自动覆盖登录、主题、回复、用户资料、私信、板块作用域授权、角色撤销、运维只读/写入权限、告警规则恢复、真实 Rust SDK 插件安装/启用/调用/UI 沙箱/停用/卸载，以及管理后台 axe 无障碍和 320/768/1024/1440px 溢出回归。完整桌面/移动套件共 12 项。为避免共享固定账号和生产登录限流器互相干扰，本地模式固定使用一个 Playwright worker。匿名首页启动时 `/api/v1/auth/session` 的 `401` 是预期的未登录探测，不代表业务请求失败。

默认地址：`http://127.0.0.1:3000/`

- 存活检查：`GET /api/v1/health/live`
- 就绪检查：`GET /api/v1/health/ready`
- OpenAPI：`GET /api/v1/openapi.json`
- 可通过 `DAOYUN_BIND_ADDR` 修改监听地址。
- 生产 HTTPS 部署设置 `DAOYUN_HSTS=true`，启用一年期 HSTS；本地 HTTP 开发保持默认关闭。
- 附件默认写入 `target/daoyun-attachments`；生产 S3 配置示例见下方环境变量。
- API 启动时执行嵌入式迁移；数据库不可连接或迁移失败时不会开始监听。
- `live` 只检查进程，`ready` 检查数据库连接和迁移版本；依赖异常时返回 `503 system.not_ready`。

### Redis 缓存（可选）

Redis 默认关闭；未设置 `DAOYUN_REDIS_URL` 时，公开品牌配置直接读取 PostgreSQL，Outbox Worker 仍会安全完成缓存失效事件。启用示例：

```powershell
$env:DAOYUN_REDIS_URL = "rediss://:<password>@cache.example.com:6380/0"
$env:DAOYUN_REDIS_KEY_PREFIX = "daoyun"
$env:DAOYUN_SITE_BRANDING_CACHE_TTL_SECONDS = "300"
$env:DAOYUN_REDIS_CONNECT_TIMEOUT_MS = "1000"
$env:DAOYUN_REDIS_RESPONSE_TIMEOUT_MS = "1000"
```

- 远程 Redis 必须使用 `rediss://`；仅 loopback 开发地址默认允许 `redis://`。受控内网确需明文连接时，必须显式设置 `DAOYUN_REDIS_ALLOW_INSECURE=true`。
- URL 可由秘密管理系统注入；应用日志只记录缓存是否启用和泛化错误，不记录 URL、密码或缓存内容。
- 公开品牌读取采用 cache-aside；Redis 查询、写入或反序列化失败时回退 PostgreSQL。品牌更新与 `cache.site_branding_invalidated` 事件在同一数据库事务提交，后台 Worker 成功删除缓存后完成事件，失败则指数退避重试。
- PostgreSQL 和 Outbox 始终是事实来源；Redis 不用于持久化业务事件。

### 运营监控

`/metrics` 默认关闭并统一返回 `404`。启用时必须注入 32 到 256 个可见 ASCII 字符组成的 bearer token：

```powershell
$env:DAOYUN_METRICS_TOKEN = "<injected-by-secret-manager-at-least-32-characters>"
$headers = @{ Authorization = "Bearer $env:DAOYUN_METRICS_TOKEN" }
Invoke-WebRequest -Uri "http://127.0.0.1:3000/metrics" -Headers $headers
```

- 指标采用 Prometheus text format，覆盖低基数 HTTP 方法/模板路由/状态类、延迟、并发请求、数据库连接池、Outbox、风险告警和运营告警；标签不包含原始 URL、用户标识、正文或令牌。
- API 接受严格 W3C `traceparent`，为每个请求生成新的服务端 span ID，并把 trace ID 同时写入结构化完成日志和响应头；无效或全零上下文会被替换。
- OTLP trace 导出默认关闭。配置完整的 OTLP/HTTP protobuf traces endpoint 后，API 会把请求 `SERVER` span 导出到独立 collector，并在优雅关闭时 flush：

```powershell
$env:DAOYUN_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:4318/v1/traces"
pnpm api:local
```

- endpoint 必须是无凭据、query 和 fragment 的绝对 HTTP(S) URL；loopback 可使用 HTTP，远程 collector 默认要求 HTTPS。仅受信任内网才显式设置 `DAOYUN_OTLP_ALLOW_HTTP=true`。
- 导出 span 只包含固定服务名、模板路由、规范化方法、状态和 request ID，不包含原始 URL、query、Cookie、Authorization、CSRF、正文或用户身份。
- API 进程内的告警 worker 每 30 秒评估 HTTP 5xx、P95 延迟、dead Outbox 和风险告警信号；规则、告警、确认状态和管理审计均持久化到 PostgreSQL。
- 管理后台“运维监控”由 `operations.read` 控制读取，由 `operations.alerts.write` 控制规则更新和告警确认；只读角色不会看到写入控件，服务端仍独立执行 capability、会话与 CSRF 校验。
- 详细契约与安全边界见 [运营可观测性规格](docs/specs/operations-observability.md)。

### 插件平台（默认关闭）

生产与开发环境均不会隐式启动插件宿主；只有显式设置严格布尔开关后才可使用插件 API：

```powershell
$env:DAOYUN_PLUGINS_ENABLED = "true"
pnpm api:local
```

仓库提供与固定 WIT world 对齐的旧 ABI 示例、业务 ABI 示例和官方成长奖励插件。首次构建需要安装目标：

```powershell
rustup target add wasm32-wasip2 --toolchain 1.94.1-x86_64-pc-windows-gnu
cargo +1.94.1-x86_64-pc-windows-gnu build --manifest-path sdk/plugin-rust-example/Cargo.toml --target wasm32-wasip2 --release --locked
cargo +1.94.1-x86_64-pc-windows-gnu build --manifest-path sdk/plugin-business-rust-example/Cargo.toml --target wasm32-wasip2 --release --locked
cargo +1.94.1-x86_64-pc-windows-gnu build --manifest-path plugins/official-growth-rewards/Cargo.toml --target wasm32-wasip2 --release --locked
```

- 旧 ABI guest 只允许 `content.transform` 和 `ui.panel`；业务 ABI 另提供版本化事件、受控查询/命令、隔离存储、任务和固定 UI slot。两种 ABI 严格互斥，业务插件必须声明 `business_api_version = 0.1.0`，且不能同时申请旧 ABI 的 `content.transform`。插件管理分别由 `plugins.read`、`plugins.install`、`plugins.lifecycle` 和 `plugins.invoke` 控制。
- 业务插件最多声明 6 个固定事件订阅，非空订阅必须申请 `events.subscribe`；订阅、能力和数据范围会作为同一份安装审批事实持久化。`users.read.basic` 只返回公开基础资料，会员状态需要单独批准 `users.read.membership`。
- 宿主只为 Rust `wasm32-wasip2` 产物提供空环境、空标准流和有界 `wasi:io`，不链接 clocks、random、filesystem 或 sockets；guest 无网络、文件、宿主时间、随机源、数据库或进程能力。每次调用独立限制 fuel、单个 4 MiB memory、表、实例、64 KiB 输入输出总量、32 次 host call、5 秒执行时间和 2 秒 host I/O；同一业务插件同时只运行一次，全局最多运行 4 个插件任务。
- UI 渲染必须申请 `ui.panel`；公开资料阶段不能调用 host import，私有/后台阶段仅允许绑定权威 subject 的受控查询、配额和隔离存储读取，不允许写命令、任务调度或存储写入。公共 surface 使用 no-store，最多 8 个候选、32 个贡献和 128 KiB 总 schema；事件或任务每次最多返回 32 条命令。
- 声明式 UI 只在空权限 `sandbox`、`no-referrer`、`default-src 'none'` 的 iframe 中展示；插件字节、调用载荷和内部 trap 不进入公共响应或日志。
- 官方成长插件按事件原始 UTC 日期，为每位用户每天首个主题发放 `+10 EXP`、首个回复发放 `+3 EXP`；固定长度核心命令键同时哈希稳定插件 key 与插件幂等键，保证长 key、事件重放、同日后续内容、并发执行及卸载后重装都不会重复奖励。命令日配额耗尽时事件和任务都会延至下一个 UTC 配额窗口且不消耗 attempt；插件不会默认安装或启用。
- SDK 构建说明见 [Rust 示例插件](sdk/plugin-rust-example/README.md)，官方插件的构建与安装说明见 [成长奖励插件 README](plugins/official-growth-rewards/README.md)；成长规则见 [官方成长奖励插件规格](docs/specs/official-growth-rewards-plugin.md)，完整契约与安全边界见 [插件平台规格](docs/specs/plugin-platform.md)。

### MFA 加密密钥

TOTP MFA 默认关闭。启用前生成并注入一个严格的 32 字节 Base64 密钥；密钥缺失时 API 保持 MFA 关闭，格式错误会阻止启动：

```powershell
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:DAOYUN_MFA_ENCRYPTION_KEY = [Convert]::ToBase64String($bytes)
```

不要把部署密钥提交到仓库、日志或客户端；密钥丢失将无法解密已保存的 TOTP secret。

## 生成 TypeScript API 声明

API 运行后执行：

```powershell
pnpm generate:api
```

默认读取 `http://127.0.0.1:3000/api/v1/openapi.json`，输出 `src/api/generated.d.ts`。
也可以显式指定 OpenAPI JSON/YAML 文件或地址：

```powershell
pnpm generate:api --input .\openapi.json --output src\api\generated.d.ts
```

已有生成文件时，可以只校验它是否与当前 OpenAPI 文档一致：

```powershell
pnpm generate:api --check
```

生成文件由 `scripts/generate-api-client.mjs` 管理，不应手工编辑；现有业务客户端已迁移到生成类型，并保留运行时响应校验。

## 附件对象存储

默认使用本地 provider：

```powershell
$env:DAOYUN_ATTACHMENT_PROVIDER = "local"
$env:DAOYUN_ATTACHMENT_ROOT = "target/daoyun-attachments"
```

生产环境使用标准 S3 API（AWS S3、MinIO、Cloudflare R2 等兼容服务）。本地默认构建只包含文件系统 provider；生产镜像通过 `infrastructure/s3` feature 编译 S3 provider：

```powershell
$env:DAOYUN_ATTACHMENT_PROVIDER = "s3"
$env:DAOYUN_S3_BUCKET = "daoyun-attachments"
$env:DAOYUN_S3_REGION = "us-east-1"
$env:DAOYUN_S3_ENDPOINT = "https://s3.example.com"
$env:DAOYUN_S3_PREFIX = "daoyun"
$env:DAOYUN_S3_FORCE_PATH_STYLE = "true"
$env:DAOYUN_S3_ACCESS_KEY_ID = "<injected-by-secret-manager>"
$env:DAOYUN_S3_SECRET_ACCESS_KEY = "<injected-by-secret-manager>"
```

`DAOYUN_S3_ENDPOINT` 默认只允许 HTTPS；本地 MinIO 测试才显式设置 `DAOYUN_S3_ALLOW_HTTP=true`。不配置静态凭据时，AWS provider 可使用标准 AWS IAM/容器凭据链。S3 bucket 应配置过期对象生命周期规则；应用清理接口负责数据库生命周期记录和已知对象删除。

## Docker Compose

```powershell
docker compose up --build
docker compose down
```

- Compose 启动 PostgreSQL 16 和 API，API 地址为 `http://127.0.0.1:3000/`，PostgreSQL 映射到本机 `55433`。
- 数据持久化在 `daoyun-postgres` 与 `daoyun-attachments` 命名卷中；使用 `docker compose down -v` 才会删除本地数据。
- Compose 文件中的 `daoyun_dev` 仅为本地开发凭据，生产环境必须替换为秘密管理系统注入的凭据。

## 验证

```powershell
$env:DATABASE_URL = "postgresql://<user>:<password>@127.0.0.1:5432/<database>"
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm build
```

首次运行浏览器回归需安装 Chromium：

```powershell
pnpm exec playwright install chromium
```

## 备份与恢复

```powershell
$env:Path = "C:\Program Files\PostgreSQL\16\bin;$env:Path"
$env:DATABASE_URL = "postgresql://<user>:<password>@127.0.0.1:5432/<database>"
pwsh ./scripts/backup-postgres.ps1
pwsh ./scripts/restore-postgres.ps1 -BackupFile ./backups/postgres/<file>.dump -AllowDataLoss
```

```bash
DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:5432/<database>" ./scripts/backup-postgres.sh
ALLOW_DATA_LOSS=1 DATABASE_URL="postgresql://<user>:<password>@127.0.0.1:5432/<database>" ./scripts/restore-postgres.sh ./backups/postgres/<file>.dump
```

- 备份使用 PostgreSQL custom format，并生成同名 `.sha256` 校验文件；恢复会先校验校验文件（存在时）。
- 恢复使用 `--clean --if-exists --single-transaction`，必须显式确认允许数据覆盖；生产凭据应通过秘密管理系统或 `.pgpass` 注入。
- 执行脚本前确保 `pg_dump`、`pg_restore` 和目标 PostgreSQL 客户端版本兼容；Windows 若客户端目录未在 `PATH`，先设置上面的路径。

## 工程结构

```text
apps/api/            Axum HTTP 进程、路由和中间件
crates/api-contract/ 公共请求响应 DTO 与 OpenAPI Schema
crates/infrastructure/ PostgreSQL 连接、迁移和就绪检查
migrations/          可回滚的 PostgreSQL Schema 迁移
src/                 React 公开 Web
```

## 视觉基线

- 内容优先、低装饰、高信息密度。
- 桌面端三栏结构，平板端双栏结构，手机端单栏和底部导航。
- 中性表面搭配绿色品牌色，并使用蓝、琥珀和玫红表达内容语义。
- 面板圆角不超过 8px，避免页面区块全部卡片化。
- 参考 Rhex 的社区信息架构和紧凑布局，不复制其源码、品牌或产品文案。

## 下一阶段

1. 安装 Docker CLI 后完成 Compose 镜像构建、容器启动、健康检查和回滚演练。
2. 在现有运营监控与 OTLP trace 导出上继续扩展全域业务审计覆盖。
3. 在专用环境接入真实 IdP 或硬件凭据，扩展 OIDC/Passkey/MFA 浏览器回归。
