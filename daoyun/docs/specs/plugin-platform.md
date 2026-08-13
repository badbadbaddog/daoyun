# 插件平台规格

## 目标

为 DaoYun 自托管实例提供默认关闭、管理员显式安装的 WebAssembly Component 插件平台。插件使用固定版本 WIT world 与宿主通信，不能直接获得 WASI、网络、文件系统、环境变量、时钟、随机数、数据库或进程能力；所有能力必须同时通过安装清单、宿主支持列表和调用入口校验。

本切片包含：Wasmtime 组件宿主、Rust WIT SDK 示例、权限清单、CPU/内存/输入输出配额、安装/启用/停用/卸载生命周期、管理 API、管理后台，以及只渲染受限 UI Schema 的 sandbox iframe 扩展点。

## 官方来源与固定版本

- 固定 `wasmtime = 47.0.3`，关闭默认 feature，只启用 `std`、`runtime`、`cranelift` 和 `component-model`。该版本 MSRV 为 Rust 1.94.0，许可证为 Apache-2.0 WITH LLVM-exception：<https://crates.io/crates/wasmtime/47.0.3>。
- 宿主绑定使用 Wasmtime `component::bindgen!` 从仓库内 WIT world 生成；官方说明该宏会为 WIT world 生成类型安全的实例化和调用绑定：<https://docs.rs/wasmtime/47.0.3/wasmtime/component/macro.bindgen.html>。
- CPU 使用 `Config::consume_fuel` 和每个 Store 的 `set_fuel` 限制；官方说明 Store 默认无 fuel，耗尽会 trap：<https://docs.rs/wasmtime/47.0.3/wasmtime/struct.Config.html#method.consume_fuel>、<https://docs.rs/wasmtime/47.0.3/wasmtime/struct.Store.html#method.set_fuel>。
- Wasm 内存、表、实例数量使用 `StoreLimitsBuilder` 和 `Store::limiter`；官方同时指出 ResourceLimiter 只覆盖 guest WebAssembly 分配，宿主输入输出仍需独立限制：<https://docs.rs/wasmtime/47.0.3/wasmtime/struct.StoreLimitsBuilder.html>、<https://docs.rs/wasmtime/47.0.3/wasmtime/struct.Store.html#method.limiter>。
- Rust guest 使用 `wit-bindgen` 的 `generate!`/`export!` 和 `wasm32-wasip2` 产出组件，遵循 Bytecode Alliance Component Model 官方示例：<https://component-model.bytecodealliance.org/language-support/building-a-simple-component/rust.html>。

## WIT 契约

WIT package 固定为 `daoyun:plugin@0.1.0`，world 固定为 `plugin`：

```wit
package daoyun:plugin@0.1.0;

enum operation {
  content-transform,
  ui-render,
}

world plugin {
  export invoke: func(operation: operation, payload: list<u8>) -> list<u8>;
}
```

- `content-transform` 要求清单 capability `content.transform`。
- `ui-render` 要求清单 capability `ui.panel`，返回 bytes 必须是 UTF-8 且包含通过宿主/客户端双重校验的 UI Schema JSON。
- WIT world 不导入任何宿主接口，也不链接 WASI。包含未满足 import 或导出类型不匹配的组件在安装前编译校验阶段被拒绝。
- WIT 的 major/minor 兼容由 package version 明确控制；DaoYun 不为旧论坛或未发布 world 添加兼容层。

## 插件包与清单

安装请求包含 UTF-8 JSON manifest 与 base64 编码的 Component bytes。manifest 只接受以下固定字段，未知字段拒绝：

- `schema_version = 1`。
- `key`：3-64 个小写字母、数字和下划线，字母开头。
- `name`：1-80 个 Unicode 字符，无控制字符。
- `version`：严格三段非负十进制 `major.minor.patch`，每段不超过 `u32`，不接受预发布、构建元数据或前导零。
- `description`：0-500 个 Unicode 字符，无控制字符。
- `capabilities`：1-8 个唯一固定值，目前仅 `content.transform`、`ui.panel`。

边界：manifest JSON 不超过 16 KiB，解码后组件不超过 8 MiB，SHA-256 由服务端计算。响应从不返回组件 bytes、数据库内部状态或完整 trap/backtrace。

## 资源配额与执行

每次调用创建独立 Store 和实例，不复用 guest 内存：

- fuel：默认 10,000,000，允许部署配置在 100,000-100,000,000 内调整。
- 单线性内存：32 MiB；最多 2 个 memory。
- table：最多 10,000 个 element；最多 4 张 table。
- 实例：最多 16 个。
- 输入 bytes：64 KiB；输出 bytes：64 KiB。`content-transform` 和 `ui-render` 的业务适配层额外要求 UTF-8。
- UI Schema：解码后 32 KiB、最多 32 个 block、所有文本字段有独立长度上限。

组件编译和调用在 Tokio blocking pool 执行，不阻塞 Axum worker。编译失败、接口不匹配、fuel 耗尽、资源拒绝和 guest trap 统一映射为稳定泛化错误；内部日志只记录 plugin ID/key、request ID、错误类别和耗时，不记录组件 bytes、payload、输出或 Wasmtime backtrace。

## 持久化与生命周期

新增可回滚 `plugins` 表：

- `id`、`key`、`name`、`version`、`description`、`capabilities jsonb`。
- `component_bytes bytea`、`component_sha256 char(64)`。
- `status`：`disabled` 或 `enabled`；安装默认 disabled。
- `revision`、`installed_by`、`created_at`、`updated_at`。

生命周期：

1. install：边界校验 -> Wasmtime 编译/接口校验 -> 单事务写插件和审计。
2. enable：重新从事实来源 bytes 编译校验 -> revision 条件更新 -> 审计。
3. invoke：仅 enabled；重新校验调用 capability，在有界编译缓存命中或编译后执行。
4. disable：revision 条件更新后立即阻止新调用；已进入 Store 的调用不获得额外能力。
5. uninstall：仅 disabled，删除记录与审计同事务；不执行 guest 卸载代码。

插件列表稳定按 key 排序，组件 bytes 不进入列表或详情响应。相同 key 冲突和陈旧 revision 返回稳定 `409`。

## RBAC 与公共管理 API

新增固定 capability 并可逆授予 `super_admin`：

- `plugins.read`
- `plugins.install`
- `plugins.lifecycle`
- `plugins.invoke`

端点全部使用 Cookie 会话、统一 envelope/OpenAPI/request ID；写请求要求 CSRF：

- `GET /api/v1/admin/plugins`
- `POST /api/v1/admin/plugins`
- `PATCH /api/v1/admin/plugins/{plugin_id}`
- `DELETE /api/v1/admin/plugins/{plugin_id}`
- `POST /api/v1/admin/plugins/{plugin_id}/invoke`

前端隐藏无权限控件只用于可用性，服务端和事务内 capability 校验始终是事实来源。

## UI Schema 与 sandbox iframe

`ui-render` 的成功输出只接受 schema version 1：

```json
{
  "schema_version": 1,
  "title": "插件面板",
  "blocks": [
    { "kind": "text", "text": "只读文本" },
    { "kind": "metric", "label": "状态", "value": "正常" },
    { "kind": "status", "tone": "neutral", "text": "已启用" }
  ]
}
```

- 固定 block kind 为 `text`、`metric`、`status`；tone 为 `neutral`、`success`、`warning`、`danger`。
- 不接受 HTML、Markdown、URL、图片、表单、脚本、事件处理器或任意 CSS。
- React 将已校验 schema 转成转义后的静态 `srcdoc`，iframe 使用空 sandbox（不含 `allow-scripts`、`allow-same-origin`、导航或弹窗权限）和禁止网络的 CSP。
- iframe 有标题和固定高度边界；父页面仍执行 320/768/1024/1440px 溢出与 axe 回归。

## 稳定错误

- `plugin.invalid_manifest`
- `plugin.invalid_component`
- `plugin.not_found`
- `plugin.conflict`
- `plugin.disabled`
- `plugin.capability_denied`
- `plugin.execution_failed`
- `plugin.resource_exhausted`
- `plugin.output_invalid`

校验错误可带固定字段名；编译器、数据库、trap、主机路径和依赖版本详情不得进入客户端响应。

## 测试策略

- plugin-host：manifest 边界、WIT 接口、成功调用、未声明 capability、fuel、内存、输入输出和 UI Schema 限制。
- PostgreSQL：迁移正反向、唯一/状态/revision/大小约束、安装/生命周期/审计原子性和事务内撤权。
- API/OpenAPI：认证、CSRF、四项 RBAC、body 上限、base64、稳定错误、request ID、隐私字段和 blocking 隔离。
- 前端：运行时 DTO/UI Schema 拒绝、权限驱动控件、文件边界、冲突恢复、sandbox/CSP/转义和无障碍标签。
- Chromium：安装测试组件、启用、调用/渲染静态 iframe、停用后拒绝调用、卸载；桌面/移动无 axe、溢出或控制台错误。
- 依赖：`cargo audit` 必须为 0 个已知漏洞，并记录 Wasmtime 精确版本与许可证。

## 成功标准

- 未受信任组件无法通过默认宿主访问网络、文件、环境、数据库或时钟，并受到 CPU、guest 内存、输入输出和数量配额约束。
- manifest capability、管理员 RBAC 和实际调用 operation 三层一致；任一层缺失都拒绝。
- 安装、启用、停用、卸载和调用具有稳定 API/OpenAPI 与审计证据。
- UI 插件只能产出经校验的静态 Schema，sandbox iframe 不执行插件脚本或同源内容。
- Rust、前端、真实浏览器、依赖审计和项目质量门禁全部通过。
