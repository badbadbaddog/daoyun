# 插件平台规格

## 目标

为 DaoYun 自托管实例提供默认关闭、管理员显式安装的 WebAssembly Component 插件平台。插件使用固定版本 WIT world 与宿主通信，不获得环境继承、网络、文件系统、数据库或进程等环境能力；所有业务能力必须同时通过安装清单、宿主支持列表和调用入口校验。

本切片包含：Wasmtime 组件宿主、Rust WIT SDK 示例、权限清单、CPU/内存/输入输出配额、安装/启用/停用/卸载生命周期、管理 API、管理后台、隔离存储、事件和任务 worker、受控查询/命令，以及由宿主执行固定 action 的受限 UI Schema 扩展点。业务插件使用独立 `daoyun:plugin-business@0.1.0` 契约，不改变既有 `daoyun:plugin@0.1.0` 调用 ABI。

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

业务扩展契约位于 `crates/plugin-host/wit-business/business.wit`，固定 package `daoyun:plugin-business@0.1.0`。它定义 request/site/actor/subject/UI slot 权威上下文、显式 `payload-schema-version` 的版本化事件、最小查询 DTO、Points/EXP/标准权益/通知受控命令、固定 UI action、计划任务、隔离存储和资源配额。事件 worker 将 Outbox 原始 `created_at` 作为 `occurred-at-unix-ms`，重试时间不会改变插件业务日。为兼容 Rust `wasm32-wasip2` 产物，宿主只链接空环境、空标准流及其 `wasi:io` 支撑接口，并把资源表限制为 64 项；不链接 clocks、random、filesystem 或 sockets，因此组件不能读取宿主时间/随机源、创建网络句柄或阻塞在远期计时器上。业务访问只能经过显式 DaoYun host import。

## 插件包与清单

安装请求包含 UTF-8 JSON manifest 与 base64 编码的 Component bytes。manifest 只接受以下固定字段，未知字段拒绝：

- `schema_version = 1`。
- `key`：3-64 个小写字母、数字和下划线，字母开头。
- `name`：1-80 个 Unicode 字符，无控制字符。
- `version`：严格三段非负十进制 `major.minor.patch`，每段不超过 `u32`，不接受预发布、构建元数据或前导零。
- `description`：0-500 个 Unicode 字符，无控制字符。
- `capabilities`：1-16 个唯一固定值。旧 ABI 使用 `content.transform`、`ui.panel`；业务能力固定为 `events.subscribe`、`core.query`、`points.write`、`experience.write`、`entitlements.write`、`notifications.write`、`storage.read_write`、`tasks.schedule`。业务插件可以额外申请 `ui.panel`，但不能申请 `content.transform`。
- `business_api_version`：可选；声明任一业务能力时必须严格为 `0.1.0`，并拒绝混用旧 ABI `content.transform`；未声明业务能力时必须省略，且不能声明数据范围或事件订阅。
- `data_scopes`：0-8 个唯一固定值，可选值为 `site.read`、`actor.read`、`users.read.basic`、`users.read.membership`、`users.targeted`、`boards.read`。`users.read.basic` 只允许公开基础资料，会员状态必须单独批准 `users.read.membership`；用户写入能力必须同时审批 `users.targeted`。
- `event_subscriptions`：0-6 个唯一固定值，可选值为 `user.created`、`topic.published`、`reply.created`、`points.changed`、`experience.changed`、`entitlement.changed`；非空时必须同时申请 `events.subscribe`。

边界：manifest JSON 不超过 16 KiB，解码后组件不超过 8 MiB，SHA-256 由服务端计算。响应从不返回组件 bytes、数据库内部状态或完整 trap/backtrace。

## 资源配额与执行

每次调用创建独立 Store 和实例，不复用 guest 内存：

- fuel：默认 10,000,000，允许部署配置在 100,000-100,000,000 内调整。
- 旧 ABI 单线性内存上限：32 MiB；业务 ABI 只允许 1 个线性 memory，guest 总内存额外收紧到 4 MiB。
- table：最多 10,000 个 element；最多 4 张 table。
- 实例：最多 16 个。
- 输入 bytes：64 KiB；输出 bytes：64 KiB。业务 ABI 对所有导出入口参数、host import 参数与 host 返回值分别执行总输入上限，对整批命令和整批 UI contribution 执行总输出上限，不能用大量小记录绕过；`content-transform` 和 `ui-render` 的业务适配层额外要求 UTF-8。
- 业务 ABI 每次调用最多执行 32 次 host call、返回 32 条命令或 8 个 UI contribution；guest 执行时间上限 5 秒，单次数据库 host I/O 上限 2 秒。
- UI Schema：解码后 32 KiB、最多 32 个 block、所有文本字段有独立长度上限。
- 单进程全局同时最多执行 4 个插件编译或调用任务；同一业务插件先取得进程内执行槽，再以 PostgreSQL owner-token 租约保证事件、任务和 UI action 在多 API/worker 进程间仍最多执行 1 次。忙碌请求不排队占用 worker claim；已验证组件按“组件 bytes + manifest”键缓存，最多保留 128 项。
- 插件存储按 plugin ID 隔离并同时限制单对象与总字节；后台任务、事件投递和受控命令分别限制待处理数量、重试次数和每日用量。

组件编译和调用在 Tokio blocking pool 执行，不阻塞 Axum worker。编译失败、接口不匹配、fuel 耗尽、执行超时、资源拒绝和 guest trap 统一映射为稳定泛化错误；内部日志只记录 plugin ID/key、request ID、错误类别和耗时，不记录组件 bytes、payload、输出或 Wasmtime backtrace。公开 `user_profile` 渲染不能调用任何 host import；私有/后台 UI 渲染只允许查询、配额读取和隔离存储读取，且用户查询绑定权威 subject。渲染阶段拒绝写命令、任务调度和存储写入；UI action 可执行批准的受控写命令，但目标必须等于权威页面 subject，权益撤销按权益所有者校验，且 UI action 始终禁止任务调度。

## 持久化与生命周期

新增可回滚 `plugins` 表：

- `id`、`key`、`name`、`version`、`description`、`capabilities jsonb`。
- `manifest_schema_version`、`business_api_version`、`data_scopes jsonb`、`event_subscriptions jsonb`，用于从安装请求到运行时重建同一份批准事实。
- `component_bytes bytea`、`component_sha256 char(64)`。
- `status`：`disabled` 或 `enabled`；安装默认 disabled。
- `revision`、`installed_by`、`created_at`、`updated_at`。

业务运行时另持久化事件/任务队列、按插件配额、稳定命令收据和跨进程执行租约。命令收据以 `(plugin_key, idempotency_key)` 为稳定主键，不因卸载重装更换命名空间；输入在预留收据或扣减配额前完成解析校验，pending 收据与执行租约都使用 owner token、到期回收和条件完成，旧执行者不能覆盖新执行者结果。

生命周期：

1. install：边界校验 -> Wasmtime 编译/接口校验 -> 单事务写插件和审计。
2. enable：重新从事实来源 bytes 编译校验 -> revision 条件更新 -> 审计。
3. invoke：仅 enabled；重新校验调用 capability，在有界编译缓存命中或编译后执行。
4. disable：revision 条件更新前锁定插件；存在未过期执行租约或 pending 命令 owner 时返回冲突，待调用收尾后再停用，避免旧安装在停用完成后继续写核心数据。
5. uninstall：仅 disabled 且无活动执行/命令 owner，删除记录与审计同事务；不执行 guest 卸载代码。

回滚到业务 ABI 之前的数据库版本时，旧 schema 无法表示业务组件；只要仍安装任一 enabled/disabled 业务插件，down migration 就在删除运行时表之前拒绝执行且保留全部数据。运维人员必须先备份并显式卸载业务插件，才能恢复旧约束；旧 ABI 插件不受影响。

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
- `GET /api/v1/admin/plugins/{plugin_id}/ui-contributions`
- `POST /api/v1/admin/plugins/{plugin_id}/ui-actions`
- `GET /api/v1/plugin-ui/{slot}/{subject_id}`
- `POST /api/v1/plugin-ui/{slot}/{subject_id}/{plugin_id}/actions`

前端隐藏无权限控件只用于可用性，服务端和事务内 capability 校验始终是事实来源。

插件列表与安装表单同时展示业务 ABI、能力清单和数据范围。安装默认停用；业务写入能力缺少定向用户范围时，前端预检、API manifest 校验和数据库约束都会拒绝。

## UI Schema 与 sandbox iframe

`ui-render` 的成功输出只接受 schema version 1：

```json
{
  "schema_version": 1,
  "title": "插件面板",
  "blocks": [
    { "kind": "text", "text": "只读文本" },
    { "kind": "metric", "label": "状态", "value": "正常" },
    { "kind": "status", "tone": "neutral", "text": "已启用" },
    { "kind": "action", "label": "发送测试通知", "action_key": "notification.send_test" }
  ]
}
```

- 固定 block kind 为 `text`、`metric`、`status`、`action`；tone 为 `neutral`、`success`、`warning`、`danger`。action key 只能使用受限的分段小写标识符。
- 不接受 HTML、Markdown、URL、图片、表单、脚本、事件处理器或任意 CSS。
- React 将已校验 schema 转成转义后的静态 `srcdoc`，iframe 使用空 sandbox（不含 `allow-scripts`、`allow-same-origin`、导航或弹窗权限）和禁止网络的 CSP。
- action 不进入 iframe；父页面仅渲染固定按钮。执行前服务端重新渲染相同 subject/slot 上下文，确认 action 确实由目标插件公开，再校验会话、CSRF、页面权限、插件能力、数据范围、配额和幂等键。
- 公共 action 请求正文最多 16 KiB，并按 actor/plugin 做有界速率限制；同插件忙碌时立即返回稳定资源错误，单次 action 等待最多 5 秒。超时后的 guest 由后台收尾并继续持有执行槽/数据库租约，避免与下一次调用重叠。
- 只有申请 `ui.panel` 的已启用业务插件会进入公共 UI 候选集合；每个 surface 最多取 8 个候选，忙碌插件立即跳过，服务端先取得独立/全局执行槽再读取 Component bytes，并限制单插件 2 秒、surface 5 秒、最多 32 个 contribution 和 128 KiB 总 schema。
- 固定 slot 为 `user_profile`、`membership_panel`、`admin_user`、`admin_plugin`。公开资料只允许匿名读取静态贡献，不能查询核心或读取插件存储；会员插槽绑定当前用户；后台用户插槽沿用用户读取/治理权限。所有 surface 响应均为 `Cache-Control: private, no-store`、`Vary: Cookie`。
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
- PostgreSQL：迁移正反向（含已安装业务插件降级卸载）、唯一/状态/revision/大小约束、安装/生命周期/审计原子性和事务内撤权。
- API/OpenAPI：认证、CSRF、四项 RBAC、body 上限、base64、稳定错误、request ID、隐私字段和 blocking 隔离。
- 前端：运行时 DTO/UI Schema 拒绝、权限驱动控件、文件边界、冲突恢复、sandbox/CSP/转义和无障碍标签。
- Chromium：安装测试组件、启用、调用/渲染静态 iframe、停用后拒绝调用、卸载；桌面/移动无 axe、溢出或控制台错误。
- 官方业务插件：原生测试严格解析事件 v1、UTC 日界和 payload/aggregate 一致性；PostgreSQL 并发与重装测试证明相同奖励命令只有一条 EXP 流水；CI 构建真实 Component，并由 Outbox、fanout、实际 Wasmtime guest、worker、收据/配额到核心账本完成主题、回复、跨日、未知 schema 版本及配额延期恢复闭环。
- 依赖：`cargo audit` 必须为 0 个已知漏洞，并记录 Wasmtime 精确版本与许可证。

## 成功标准

- 未受信任组件无法通过默认宿主访问 TCP、UDP、名称解析、文件、环境、数据库或宿主时钟，并受到 CPU、wall-clock、guest 内存、输入输出、host call、数量和并发配额约束。
- manifest capability、管理员 RBAC 和实际调用 operation 三层一致；任一层缺失都拒绝。
- 安装、启用、停用、卸载和调用具有稳定 API/OpenAPI 与审计证据。
- UI 插件只能产出经校验的受限 Schema；sandbox iframe 不执行插件脚本或同源内容，固定 action 只能由宿主页面和受控命令层执行。
- Rust、前端、真实浏览器、依赖审计和项目质量门禁全部通过。
