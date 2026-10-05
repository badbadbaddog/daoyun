# DYR-025 Wasm 编译期可选化

用户继续指令授权执行既定 DYR-025，保留工作区、数据库与门禁状态，未提交、未部署。

## 验收与实现顺序

1. RED：基础版显式选择 Wasm 或启用 Wasm 必须在数据库迁移前拒绝；能力快照精确报告 supported/unsupported。
2. 把已有纯 manifest/UI 校验搬到 api-contract::plugin_validation，plugin-host 重新导出原符号；不复制校验、不修改 ABI/沙箱。先复跑宿主契约测试。
3. daoyun-api 默认 features 空，wasm-plugins = [dep:plugin-host]；只 cfg 执行代码、缓存与 worker，保留路由/OpenAPI/Native 和授权。
4. 基础/扩展按包 cargo tree、test/build/clippy/OpenAPI 实验；全 workspace 开启 daoyun-api/wasm-plugins 单独记开发覆盖。基础包默认及 --no-default-features 闭包必须无 plugin-host/wasmtime。
5. 隔离 PostgreSQL、实际 API/桌面手机浏览器确认五项 Native 与基础版状态；定向回归前端 gates，独立审查、交接和真实状态更新。

## 边界

不升级外部依赖，不改数据库 schema，不迁移/删除历史，不新增成长写入者。保留插件主机原安全测试及两个需真实组件的 ignored 用例，明确标注 NOT_RUN。基础版拒绝 DAOYUN_PLUGINS_ENABLED=true/1 和显式 DAOYUN_GROWTH_REWARDS_EXECUTOR=wasm；无配置可正常启动。已启用外部插件的站点必须使用扩展版。S3 全组合与性能五轮仍归 DYR-029。G3–G6 不自动接受。

Cargo 官方依据：https://doc.rust-lang.org/cargo/reference/features.html#optional-dependencies 及 https://doc.rust-lang.org/cargo/commands/cargo-tree.html 。
