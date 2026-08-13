# ADR-004：使用 Wasmtime Component Model 作为插件执行边界

## 状态

Accepted

## 日期

2026-08-11

## 背景

DaoYun 需要自托管插件能力，但插件代码来自实例管理员选择的第三方，必须按未受信任输入处理。目标包括稳定跨语言接口、显式权限、CPU/内存配额、可审计生命周期和可测试 UI 扩展，同时禁止插件直接取得进程、数据库、网络、文件系统或浏览器同源权限。

项目使用 Rust 1.94.1。依赖评审时 crates.io 最新稳定 Wasmtime 为 47.0.3，MSRV 1.94.0，许可证为 Apache-2.0 WITH LLVM-exception。Wasmtime 官方组件 API用 WIT world 生成类型安全宿主绑定，并提供 fuel 与 Store ResourceLimiter：

- <https://crates.io/crates/wasmtime/47.0.3>
- <https://docs.rs/wasmtime/47.0.3/wasmtime/component/macro.bindgen.html>
- <https://docs.rs/wasmtime/47.0.3/wasmtime/struct.Config.html#method.consume_fuel>
- <https://docs.rs/wasmtime/47.0.3/wasmtime/struct.StoreLimitsBuilder.html>

## 决策

1. 固定 `wasmtime = 47.0.3`，关闭默认 feature，只启用当前宿主必需的 `std`、`runtime`、`cranelift` 和 `component-model`。
2. 只接受 WebAssembly Component，不接受裸 core module、原生动态库、JavaScript bundle 或服务器脚本。
3. 用仓库内 `daoyun:plugin@0.1.0` WIT world 生成宿主与 Rust guest SDK 绑定；版本变化通过新 WIT package version 显式发布。
4. 首个 world 没有 import，也不链接 WASI。未来每个 host import 都必须有新的 capability、配额、审计和 ADR 更新。
5. 每次调用使用新 Store/实例、fuel 和 StoreLimits；组件编译可有界缓存，guest 内存绝不跨调用复用。
6. 插件 UI 不接收第三方 HTML/JS。插件只返回受限 JSON UI Schema，前端转义后放入空 sandbox 且 CSP 禁网的静态 iframe。
7. 插件安装默认 disabled；启用前重新编译校验。卸载不执行第三方清理钩子。

## 备选方案

### 原生 Rust 动态库

- 优点：调用开销低、Rust 类型集成直接。
- 缺点：与宿主同进程同权限，ABI/平台耦合，无法可靠限制网络、文件、内存或崩溃。
- 结论：拒绝；不满足未受信任插件边界。

### 独立子进程插件

- 优点：可使用操作系统进程隔离，语言选择广。
- 缺点：Windows/Linux 沙箱策略不同，需要进程监管、IPC、文件分发、升级和额外运维面；默认子进程仍可能访问网络和文件。
- 结论：本阶段拒绝；可作为未来高隔离执行器重新评估，不作为 Wasmtime 的隐式回退。

### Wasmer 或自定义 WebAssembly 运行时

- 优点：同样可执行 WebAssembly。
- 缺点：项目需要自行建立不同组件接口/安全/配额集成；Wasmtime 的 Component Model、WIT bindings、MSRV 和 Bytecode Alliance 官方文档与当前目标直接匹配。
- 结论：拒绝；减少运行时与接口工具链分叉。

### 第三方 iframe HTML/JavaScript

- 优点：UI 自由度高。
- 缺点：需要复杂 postMessage 协议、来源校验、内容托管与浏览器权限策略，容易形成 XSS、同源数据和导航风险。
- 结论：拒绝；首版只支持静态、受限、转义后的 UI Schema。

## 后果

- 正面：插件默认无外部能力，接口可跨语言，配额与 capability 可测试，生命周期可审计。
- 正面：禁用默认 Wasmtime feature，避免无需求的 WASI、GC、profiling、cache 和 async 表面积。
- 代价：Cranelift 编译依赖较大，安装/首次调用必须使用 blocking pool 和有界缓存，构建磁盘与时间门禁需单线程执行。
- 代价：fuel 是确定性指令预算而非严格墙钟时限；当前无 host import 的 world 可用 fuel 有界。加入异步 host I/O 前必须重新评估 epoch/async timeout。
- 代价：Store ResourceLimiter 只限制 guest Wasm 分配，宿主必须继续独立限制组件 bytes、manifest、输入、输出、缓存和并发数。
- 限制：静态 UI Schema 不支持插件脚本、表单或任意网络交互；扩展协议需要新 ADR。

## 复审条件

- Wasmtime 47 出现未修复高危安全公告或停止维护。
- 需要网络/文件/WASI、异步 host import、跨进程隔离或交互式 UI。
- 插件编译吞吐、内存或冷启动超过运营监控预算。
