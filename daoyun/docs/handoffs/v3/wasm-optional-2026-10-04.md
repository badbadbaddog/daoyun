# DYR-025 Wasm 编译期可选化交接

状态：DONE；AC-025-01/02/03 全部 PASS。HEAD 40bcff25ec920912bff7f4472bc6174e63b8e2d9，分支 codex/daoyun-home-foundation；保留前序未提交改动，未提交、未部署。G0/G1/G2 保持 ACCEPTED，G3–G6 保持 NOT_ACCEPTED。下一项 DYR-026 为 PLANNED，尚未启动。

## 构建与运行行为

daoyun-api 默认 features 为空，plugin-host 是 optional dependency，仅 wasm-plugins 启用。默认及 --no-default-features 的按包 resolved feature 图均不含 plugin-host、wasmtime、wasmtime-wasi；扩展图包含三者。Wasm 执行、缓存、宿主类型和业务 worker 按 feature 编译；全部 Native 路由、历史管理与 OpenAPI 保留。

纯 manifest/UI 校验、配置和错误类型搬到 api-contract::plugin_validation，plugin-host 保留原符号重新导出。独立复核确认迁移定义逐字等价，WIT/ABI、imports 白名单、fuel、内存/表/实例、输入输出、宿主调用、命令、epoch 与 WASI 限额未改。没有新增依赖版本、schema 或成长奖励写入者。

基础版支持五项 Native 配置、显式启停和历史读取；Wasm 安装、启用和执行先完成原鉴权/CSRF/输入校验，再返回既有不可用响应，request_id 关联保持。历史 Wasm 行完整保留，不自动停用或删除。wasm_supported=false，成长执行能力为 unsupported；Native 状态按业务配置返回。基础发布 exe 实测拒绝 DAOYUN_PLUGINS_ENABLED=true/1 及显式 DAOYUN_GROWTH_REWARDS_EXECUTOR=wasm，并在数据库访问前退出。

扩展发布 exe 实际以插件运行时和 Wasm 成长执行器启用配置启动，健康检查 200，能力快照 supported/runtime_enabled 均 true；随后关闭运行时，五项 Native 的配置、执行、停用拒写和幂等回放仍通过。启用外部插件的实例应继续使用扩展产物。

## 构建与契约证据

- 基础：cargo build -p daoyun-api --release --locked --no-default-features；52,642,283 bytes，SHA256 c1a37c41b4dd95ab4ee279aa8588c6052b857cd86719934f0f5f93037865ba1c。
- 扩展：cargo build -p daoyun-api --release --locked --no-default-features --features wasm-plugins；77,901,623 bytes，SHA256 e733d3ff72f90bfd0e46d70d9e69a6f8172881a34fc3881fdf5f876a98b15bc6。
- 两个 Windows GNU 发布产物分别保存在证据 runtime/。大小仅为产物标识，未作性能比较。
- 新增 pnpm verify:wasm-builds 检查三种依赖闭包；api:local/local 显式带 wasm-plugins，保留既有开发默认。现有 Dockerfile 的 infrastructure/s3 组合未执行，不作为本轮基础产物证据。
- 基础 example 导出、基础真实 HTTP、扩展真实 HTTP 的 OpenAPI 语义相同：176 paths、488 schemas；两次生成类型 --check 均通过，generated.d.ts 未改。

## 验证

- 前端全量 1083 PASS / 115 文件；最终应用类型、E2E 类型、生产构建 PASS。
- 基础包及 api-contract：253 PASS / 0 ignored；包括新基础启动拒绝、历史完整保留及授权/CSRF/校验回归。
- 开启 daoyun-api/wasm-plugins 的全工作区：485 PASS / 2 ignored；插件 API 6 PASS。基础版插件 API 4 PASS，两个构建的 executor 测试选择正确。
- plugin-host 单独 21 PASS / 1 ignored，亦包含在全工作区覆盖中；不能重复相加。两个真实成长组件 ignored 用例保留 NOT_RUN。
- 基础包和扩展工作区的 all-targets clippy -D warnings、cargo fmt --check、git diff --check PASS。
- 浏览器基础 6 PASS、扩展复验 6 PASS；共 100 张截图，320/390/768/1024/1440 无横向溢出，320/1440 axe 无违规，pageerror 为空。基础与扩展快照分别报告不支持 Wasm、运行时未启用。两库最终五项均 native，显式启用状态与投票历史保留。
- 前序唯一用例 156 保留；本轮基础新增 6，累计唯一 162；扩展版 6 为复验，单列而不重复累加。

## 失败记录与复核决定

真实 RED 捕获基础启动继续访问数据库、快照错误报告 Wasm 支持；此前 linker 缺失尝试属于环境失败，不算 RED。独立运行时复核曾用声明 feature 前的 RED 日志提出 cfg 失效；最终基础与扩展测试选择、无 cfg 警告及实际产物状态证明该结论不适用于当前实现，已关闭。

首次前端全量为 1080 PASS / 3 FAIL：一个状态断言在加载完成前读取，两个既有会话用例超时。仅把状态断言改为等待文本；maxWorkers=2 全量 1083 PASS，App.test.tsx 和前端产品源码保持不变，未跳过测试或增加 timeout。冷加载隔离失败记录亦保留。

首次扩展工作区、clippy 和发布构建因磁盘满失败，不计 PASS。核实路径后仅清理本仓库 target/debug/incremental 可重建缓存，恢复约 40 GiB 可用空间；未删源码、数据库或历史证据。最终 GNU 1.94.1、CARGO_BUILD_JOBS=2、CARGO_INCREMENTAL=0，工作区 dev/test debug symbols=0；前端使用已安装 CLI 的实际入口完成等价脚本检查。全工作区是开发覆盖，不能冒充基础构建的依赖、冷编译耗时或性能结果。

## 保留与下一步

未改 DYR-024 迁移、宿主业务写入、前端产品代码和 API 生成类型；其十项未涉及清单文件保持 SHA256 一致。18 项最终源码清单 SHA256 为 9c598d41384cd74f0b5af5560ba493480a7f32f3bc296b127eb036f67bfd4e2b。差异、原始失败与通过日志、独立复核、构建图、产物、截图及汇总位于 artifacts/v3/dyr025-2026-10-04；入口 verification.json、source-manifest.json、task-source-diff-final.patch。

本轮 API、预览和专用 PostgreSQL 已停止；3000/5173/3001/4174/15435/15436 均未监听。专用基础与扩展验收库、前序数据库及证据保留，私有环境只留证据 private/，不提交。真实移动设备/辅助技术、Linux Docker/S3 组合、生产部署和 DYR-029 五轮性能比较均 NOT_RUN。继续时从 DYR-026 开始，不自动接受 G3–G6。
