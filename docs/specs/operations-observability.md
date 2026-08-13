# 运营监控与可观测性规格

## 目标

为 DaoYun 自托管实例提供可直接运行的运营监控闭环：低基数 Prometheus 指标、可跨代理传播的 W3C 请求链路、持久化告警事件，以及受权限保护的运维后台。运维人员应能在不接触数据库、Cookie、令牌、邮箱或用户正文的情况下判断 API、数据库和 Outbox 是否健康，并处理告警。

## 技术栈与命令

- 后端：Rust 1.94.1、Axum 0.8、Tokio、SQLx/PostgreSQL、`tracing`、OpenTelemetry Rust 0.32。
- 前端：React 19、TypeScript、Vite、Vitest、Testing Library、Playwright。
- 不绑定外部监控 SaaS；Prometheus exposition 和告警评估保持进程内实现，跨进程 trace 使用可选 OTLP/HTTP protobuf exporter。
- 验证命令：
  - `cargo test --workspace`
  - `cargo fmt --all -- --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm generate:api -- --check`
  - `DAOYUN_LOCAL_E2E=1 pnpm test:e2e`

## 结构与契约

### 请求指标

- 所有 API 请求记录请求总数、进行中请求数和耗时直方图。
- 标签只允许 HTTP method、Axum 模板路由和状态类别；不得使用原始 URL、UUID、用户名、查询串或错误消息作为标签。
- 固定耗时 bucket：5、10、25、50、100、250、500、1000、2500、5000 ms。
- `GET /metrics` 返回 Prometheus text format，不使用版本化业务 envelope。
- `/metrics` 默认关闭。只有配置 32-256 字符的 `DAOYUN_METRICS_TOKEN` 后启用，并要求 `Authorization: Bearer <token>`；比较使用恒定时间算法，失败统一返回 404，响应不得回显配置状态或 token。
- 指标包含 HTTP、进程 uptime、数据库连接池、Outbox pending/processing/dead、未处理风险告警和未处理运营告警。

### 请求链路

- 中间件接受严格的 W3C `traceparent` version 00，并拒绝全零 trace/span ID、非小写十六进制、额外字段和不支持的 flags。
- 合法上游 trace ID 被继续使用，每个请求生成新的 span ID；缺失或非法 header 时生成新的 trace ID。
- 所有响应携带 `traceparent`，所有结构化请求日志携带 `request_id`、`trace_id`、method、模板路由、状态和耗时。
- 不记录 query、Cookie、Authorization、CSRF、请求/响应 body 或用户身份字段。

### OTLP trace 导出

- 默认关闭；只有显式配置 `DAOYUN_OTLP_TRACES_ENDPOINT` 后才创建 OpenTelemetry SDK tracer provider 和 OTLP/HTTP protobuf exporter。
- endpoint 必须是无用户名、密码、query 或 fragment 的绝对 HTTP(S) URL；远程明文 HTTP 默认拒绝，仅 loopback 可直接使用，受信任内网需显式设置 `DAOYUN_OTLP_ALLOW_HTTP=true`。
- 每个 HTTP 请求导出一个 `SERVER` span，继承合法 `traceparent` 的 trace ID、父 span ID 和 sampled flag；响应 `traceparent` 中的 span ID 必须与导出的服务端 span 一致。
- 只导出固定服务名 `daoyun-api`、模板路由、规范化方法、状态码、状态类别、request ID；不导出原始 URL、query、Cookie、Authorization、CSRF、请求/响应 body 或用户身份。
- exporter 失败不得影响 HTTP 响应；进程优雅关闭时执行有界 flush/shutdown，配置非法则拒绝启动。
- 依赖、传输协议和显式 instrumentation 取舍见 [ADR-005](../decisions/adr-005-otlp-http-trace-export.md)。

### 运维汇总 API

- `GET /api/v1/admin/operations/summary` 要求 `operations.read`。
- 响应返回 observed time、uptime、HTTP 总量/进行中/5xx/p95、数据库 ready/连接数、Outbox 状态计数、风险告警数和运营告警数。
- 所有字段使用统一 `ApiResponse`、`request_id` 和 `x-request-id`；数据库失败返回现有 503 泛化错误。

### 告警规则与事件

- 固定规则类型：`http_5xx_count`、`http_p95_ms`、`outbox_dead_count`、`risk_alert_open_count`。不提供任意查询语言、SQL 或模板执行。
- 规则包含 key、name、kind、threshold、window_seconds、enabled 和 revision；key/kind 不可变，name/threshold/window/enabled 可乐观并发更新。
- 默认规则分别覆盖 5 分钟 5xx 数、5 分钟 p95、Outbox dead 数和未处理风险告警数。
- 后台 Worker 每 30 秒评估；超过阈值时对同一规则只保留一个 open 事件并更新时间，恢复时标记 resolved。状态转换写结构化 warning/info 日志。
- `GET /api/v1/admin/operations/alert-rules` 与 `GET /api/v1/admin/operations/alerts` 要求 `operations.read`。
- `PATCH /api/v1/admin/operations/alert-rules/{rule_id}` 和 `PATCH /api/v1/admin/operations/alerts/{alert_id}` 要求 `operations.alerts.write`、CSRF 和有效会话。
- 事件只支持从 open 到 acknowledged；恢复由评估器完成。规则更新和确认写最小 `admin_audit_log`，不包含凭据、身份或请求正文。

### 运维后台

- 管理后台新增“运维监控”标签。
- 显示 API、数据库、Outbox、风险与告警概览；支持手动刷新、规则阈值/窗口/启用状态更新和 open 告警确认。
- 具备 loading、empty、forbidden、error 和 optimistic conflict 刷新状态。
- 语义化 heading、label、button；图标按钮具备 accessible label 与 tooltip；320/768/1024/1440px 无水平溢出。

## 测试策略

- 小型 Rust 测试：`traceparent` 严格解析、固定标签、bucket/p95、Prometheus 转义、metrics token 和 OTLP endpoint 配置。
- OTLP 集成测试：本地 HTTP collector 接收 protobuf 导出，证明 trace ID、父 span ID、服务端 span ID、模板路由、状态和 request ID 跨网络边界保持一致。
- PostgreSQL 测试：迁移正反向、默认规则、单 open 事件、恢复、乐观冲突和审计原子性。
- API/OpenAPI 测试：metrics disabled/token、trace 传播/生成、summary capability、CSRF、规则/事件稳定错误、request ID 和隐私字段。
- 前端测试：DTO 拒绝、汇总/规则/告警映射、规则表单、确认、forbidden/error。
- Chromium：管理员打开运维页、看到真实 summary；桌面与移动无溢出、axe 严重违规或控制台错误；性能预算沿用现有基线。

## 边界

- 始终：固定低基数标签；服务端授权；参数化 SQL；统一错误 envelope；敏感信息最小化；有界分页。
- 需先确认：外部 webhook/邮件/SaaS、除 OTLP/HTTP trace exporter 外的新外部集成、任意查询语言、改变全局限流。
- 禁止：公开无认证 metrics、在标签/日志中写原始 URL 或身份、客户端决定告警状态、数据库失败时伪造健康、静默吞掉告警评估失败。

## 成功标准

- 指标、链路、告警和运维后台四部分均有可运行实现与测试。
- 非管理员不能读取运维数据；只读运维角色不能更新规则或确认告警。
- 合法 trace ID 可端到端关联，非法 trace header 不进入日志或响应。
- 配置 OTLP endpoint 后 collector 可接收与响应 `traceparent` 对应的服务端 span；未配置时不启动 exporter 且不产生网络请求。
- 指标标签基数由模板路由集合决定，业务 UUID 不会生成新 series。
- 告警去重、恢复、确认、并发更新和审计均在 PostgreSQL 中可证明。
- 全量 Rust、前端、OpenAPI 和真实浏览器质量门禁通过。

## 实施任务

1. 指标与 trace 中间件：先写纯逻辑/API 测试，再接入 Router 和 `/metrics`。
2. 告警持久化：迁移、capability、规则/事件查询与评估事务。
3. 运维 API：summary、规则更新、告警确认、OpenAPI 和 capability/CSRF 测试。
4. Worker：30 秒评估、优雅关闭、失败隔离和状态转换日志。
5. TypeScript 与运维 UI：运行时 DTO 校验、后台标签和响应式样式。
6. Chromium、性能/安全/无障碍回归、项目状态和完整质量门禁。
