# ADR-005：使用 OpenTelemetry SDK 与 OTLP/HTTP 导出请求 trace

## 状态

Accepted

## 日期

2026-08-11

## 背景

DaoYun 已有严格 W3C `traceparent` 传播、请求完成日志和进程内 Prometheus 指标，但 trace 只存在于单个 API 进程，collector 或其他服务无法接收标准 span。目标是在保持默认零网络访问、低基数和敏感信息最小化的前提下，把 HTTP 请求 span 导出到独立 OpenTelemetry collector，并让响应 `traceparent` 的服务端 span ID 与导出数据一致。

项目使用 Rust 1.94.1。依赖评审时 OpenTelemetry Rust 当前稳定 trace/OTLP API 为 `0.32.0`，SDK 最新兼容补丁为 `0.32.1`；锁定包均为 Apache-2.0、MSRV 1.75.0：

- <https://opentelemetry.io/docs/languages/rust/exporters/>
- <https://docs.rs/opentelemetry-otlp/0.32.0/opentelemetry_otlp/#http-transport-port-4318>
- <https://docs.rs/opentelemetry_sdk/0.32.1/opentelemetry_sdk/trace/struct.SdkTracerProvider.html>
- <https://opentelemetry.io/docs/specs/otel/protocol/exporter/>

## 决策

1. 固定 `opentelemetry = 0.32.0`、`opentelemetry-otlp = 0.32.0` 和 `opentelemetry_sdk = 0.32.1`，关闭默认 feature，只启用 trace、OTLP/HTTP protobuf 和 blocking reqwest client。
2. API 中间件直接使用 OpenTelemetry SDK 创建一个请求 `SERVER` span；暂不引入 `tracing-opentelemetry`，避免把现有全部日志 span 隐式扩大为外部遥测数据。
3. `DAOYUN_OTLP_TRACES_ENDPOINT` 缺失时不创建 exporter。endpoint 必须是无 userinfo、query 和 fragment 的绝对 HTTP(S) URL；远程 HTTP 默认拒绝，受信任内网必须显式设置 `DAOYUN_OTLP_ALLOW_HTTP=true`。
4. 合法上游 `traceparent` 作为 remote parent 注入 SDK，继承 trace ID、父 span ID 和 sampled flag；缺失或非法上下文由 SDK 生成新的根 trace。响应使用 SDK 实际生成的 trace/span ID。
5. span 只记录固定服务名、模板路由、规范化方法、状态码/状态类和 request ID。原始 URL、query、Cookie、Authorization、CSRF、请求/响应 body 和用户身份禁止进入 trace。
6. 使用 SDK batch exporter 和 5 秒单批导出超时。导出失败不改变业务响应；优雅关闭在 Tokio blocking worker 中执行 5 秒有界 provider shutdown/flush。
7. 集成测试使用真实 loopback HTTP listener 接收 OTLP protobuf，核对传播标识、服务端 span ID、模板路由与服务名，而不依赖 Docker 或外部 SaaS。

## 备选方案

### OTLP/gRPC（Tonic）

- 优点：OTLP 的标准传输之一，collector 普遍支持，适合双向 HTTP/2 基础设施。
- 缺点：需要 Tonic/HTTP2/TLS feature 和更大的依赖表面积；当前只导出单一 trace 信号，HTTP protobuf 已满足无损 OTLP 数据模型。
- 结论：首版拒绝；出现明确吞吐或基础设施要求时再评估。

### `tracing-opentelemetry` subscriber layer

- 优点：可以自动把现有 `tracing` span/event 桥接到 OpenTelemetry，并自然覆盖未来内部子 span。
- 缺点：当前现有日志 instrumentation 未按外部遥测敏感性和基数逐项审计；全量桥接可能把错误文本或动态字段导出到第三方 collector。
- 结论：首版拒绝；先只导出显式、受控的 HTTP 请求 span。

### 自行编码 OTLP protobuf 和 HTTP client

- 优点：可减少 SDK 抽象并完全控制 payload。
- 缺点：需要自行维护 OTLP schema、采样、span 生命周期、批处理、重试和协议兼容，错误风险高于使用官方 SDK/exporter。
- 结论：拒绝；使用 OpenTelemetry 官方 Rust 实现。

## 后果

- 正面：collector 可跨进程接收标准 OTLP trace，响应、日志和导出 span 可用 trace ID/request ID 关联。
- 正面：默认关闭且 endpoint 严格校验，不会因部署环境遗漏配置产生意外外连；远程明文传输需要显式授权。
- 正面：导出字段为固定 allowlist，模板路由控制基数，避免身份、令牌或正文进入外部遥测系统。
- 代价：新增 15 个锁定传递包，并为现有 reqwest 启用 blocking feature；构建时间和二进制体积增加。
- 代价：当前只导出 HTTP 请求根/服务端 span，不自动导出数据库、Redis、Outbox 或插件内部子 span。
- 限制：batch exporter 在进程强制终止时无法保证 flush；正常优雅关闭提供 5 秒有界 shutdown。

## 复审条件

- 需要自动导出经过敏感性审计的内部 `tracing` 子 span。
- OTLP/HTTP 吞吐、延迟或 collector 兼容性不能满足生产预算。
- OpenTelemetry 0.32 出现未修复高危安全公告、协议不兼容或停止维护。
- 需要 mTLS、自定义认证 header、动态采样或跨服务 baggage。
