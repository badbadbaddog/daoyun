# DaoYun Rust 插件示例

此示例只实现 `daoyun:plugin@0.1.0/plugin` 的两个导出操作，不导入 WASI 或任何宿主能力。

```powershell
rustup target add wasm32-wasip2 --toolchain 1.94.1-x86_64-pc-windows-gnu
cargo +1.94.1-x86_64-pc-windows-gnu build --manifest-path sdk/plugin-rust-example/Cargo.toml --target wasm32-wasip2 --release
```

生成组件位于 `sdk/plugin-rust-example/target/wasm32-wasip2/release/daoyun_plugin_rust_example.wasm`。安装清单中的能力必须与实际调用一致：`content.transform` 对应 `content-transform`，`ui.panel` 对应 `ui-render`。

`ui-render` 输出必须是符合 `docs/specs/plugin-platform.md` 的 UTF-8 UI Schema JSON。宿主会再次校验输出、fuel、内存和输入输出边界。

实现方式遵循 `wit-bindgen` 官方 `generate!`/`export!` 导出模式：<https://docs.rs/wit-bindgen/0.58.0/wit_bindgen/macro.generate.html>。
