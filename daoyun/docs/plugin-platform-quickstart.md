# DaoYun 插件开发速查（快速上手）

本页面向 DaoYun 社区系统的插件开发与安装。

## 1) 设计原理（核心）

DaoYun 的插件是“受控的 WebAssembly 组件”模式：

- 插件本体是 `Wasm Component`，不直接运行在站点进程里。
- 插件运行在 `Wasmtime` 组件执行环境中，默认不具备：
  - 网络
  - 文件系统
  - 环境变量
  - 数据库直接连接
  - 主机任意系统调用
- 先天有资源上限（CPU/fuel、内存、输入输出大小、host 调用次数、并发）。
- 接口和能力双重校验：
  - 安装时校验清单（manifest）
  - 安装/启用时校验 WIT ABI
  - 调用时按状态（enabled/disabled）与能力重新校验

## 2) 两套能力模型

### 2.1 旧 ABI（轻量）
- WIT：`daoyun:plugin@0.1.0`
- World：`plugin`
- 导出：`invoke(operation, payload) -> bytes`
- operation：`content-transform`, `ui-render`
- 适合：内容转换、静态面板输出。

### 2.2 业务 ABI（推荐）
- WIT：`daoyun:plugin-business@0.1.0`
- World：`business-plugin`
- 支持：事件、受控查询/命令、任务、隔离存储、配额、UI 贡献与动作。
- 适合：积分/经验、会员权益、通知、后台面板、自动化规则。

## 3) 上传的文件是什么

插件安装时需要两部分：

1. `plugin.json`（清单）
2. `*.wasm`（已编译的组件）

前端安装里是把组件读取后转成 base64 发送给
`POST /api/v1/admin/plugins`。

清单关键点（示例见下）：

- `schema_version: 1`
- `key`: 3-64 位小写字母/数字/下划线，字母开头
- `name/version/description`
- `capabilities`: 声明能力
- 若业务能力：必须带 `business_api_version: "0.1.0"`
- 与 `business_api_version` 相关时通常还需要 `data_scopes`、`event_subscriptions`

> 旧 ABI（content-transform/ui.panel）和业务 ABI 不能混用同一清单。

## 4) 最小文件结构（推荐）

可直接从官方示例抄起步：

- `sdk/plugin-rust-example/`（旧 ABI）
- `sdk/plugin-business-rust-example/`（业务 ABI）
- `plugins/official-growth-rewards/`（真实业务插件目录）

## 5) Rust 业务插件开发最小模板

### WIT 接口（`wit-business/business.wit`）

```wit
package daoyun:plugin-business@0.1.0;
world business-plugin {
  import host;
  export guest;
}
```

### Rust 组件实现（核心骨架）

```rust
#[allow(unsafe_code)]
mod bindings {
  wit_bindgen::generate!({
    path: "wit",
    world: "business-plugin",
  });
}

use bindings::daoyun::plugin_business::types::{
  Event, EventKind, RequestContext, CommandRequest, CommandKind, UiAction, UiContribution,
};

struct MyPlugin;

impl bindings::exports::daoyun::plugin_business::guest::Guest for MyPlugin {
  fn on_event(_context: RequestContext, event: Event) -> Result<Vec<CommandRequest>, String> {
    // TODO: 处理 event，返回受控命令
    Ok(match event.kind {
      EventKind::UserCreated => vec![CommandRequest {
        kind: CommandKind::NotificationSend,
        subject_id: event.aggregate_id.unwrap_or_default(),
        idempotency_key: format!("my-plugin:user-created:{}", event.id),
        payload_json: r#"{\"kind\":\"message\",\"target_type\":\"user\",\"target_id\":\"...\"}"#.to_owned(),
      }],
      _ => Vec::new(),
    })
  }

  fn ui_contributions(_context: RequestContext) -> Result<Vec<UiContribution>, String> {
    Ok(Vec::new())
  }

  fn on_ui_action(_context: RequestContext, action: UiAction) -> Result<Vec<CommandRequest>, String> {
    if action.action_key == "test" {
      Ok(vec![])
    } else {
      Err("action.unsupported".to_owned())
    }
  }

  fn run_task(_context: RequestContext, _task_key: String, _payload_json: String) -> Result<Vec<CommandRequest>, String> {
    Ok(Vec::new())
  }
}

#[allow(unsafe_code)]
mod component_export {
  use super::{MyPlugin, bindings};
  bindings::export!(MyPlugin with_types_in bindings);
}
```

### 注意
- 所有 host 能力调用都要经过 `bindings::daoyun::plugin_business::host::*`，不能越权。
- 业务能力（读写命令）请只返回命令列表，最终写入由核心执行。

## 6) `plugin.json` 示例

```json
{
  "schema_version": 1,
  "key": "my_custom_plugin",
  "name": "我的业务插件",
  "version": "0.1.0",
  "description": "示例插件：监听事件并触发受控命令",
  "capabilities": ["events.subscribe", "notification.send"],
  "business_api_version": "0.1.0",
  "data_scopes": ["users.targeted"],
  "event_subscriptions": ["user.created"]
}
```

## 7) 编译命令

先确保 Rust 版本和目标：

```bash
rustup target add wasm32-wasip2 --toolchain 1.94.1
cargo +1.94.1 build --manifest-path <你的插件目录>/Cargo.toml --target wasm32-wasip2 --release
```

生成产物：

```text
<你的插件目录>/target/wasm32-wasip2/release/<crate_name>.wasm
```

## 8) 安装与启用流程

1. 进入“站点管理 → 插件管理”。
2. 点击“安装插件”。
3. 上传 `plugin.json`，选择 `*.wasm` 文件。
4. 安装成功后通常默认停用。
5. 点击启用。
6. 如具备 `plugins.invoke` 权限，可通过“开发者工具”做自检。

## 9) 上线前自检清单

- `plugin.json` 与 `.wasm` 能通过安装/启用校验。
- manifest 与能力不冲突（业务 ABI 与旧 ABI 不混用）。
- 事件处理返回结果有幂等键（推荐）。
- content-transform 与 ui.panel/业务能力边界清晰。
- UI Schema 仅使用白名单字段（text/metric/status/action）。
- 异常返回有稳定错误码（便于排障）。

---

后续如果你要，我可以直接再给你一份：
- 可直接运行的“最小业务插件”完整工程（含 Cargo.toml、WIT、src/lib.rs、plugin.json），
- 并附上事件入库到成功触发一次命令的端到端测试步骤。
