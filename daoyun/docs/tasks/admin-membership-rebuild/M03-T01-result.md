# M03-T01 Task Result / Handoff

状态：DONE（2026-10-06）。M03 整体 NOT DONE；M03-T02 用户列表字段和筛选尚未实施。

## 已实现
- 新增 GET /api/v1/admin/users/{user_id}/membership-summary，公开 DTO 与 OpenAPI 已注册；账号、有效社区成员关系、独立 EXP/当前等级/下一已发布等级、独立积分账户、勋章、权益含历史聚合读取。
- 入口 admin.users.read；各栏目保留计划中的独立读取能力。未授权字段返回 null；readable_sections 区分不可读与未初始化。不创建账户，不合并写接口，不修改 Schema。
- 成长查询复用现有投影，新增 optional find 供只读聚合，原 get 的 RowNotFound 语义不变。积分 DTO 没有旧积分等级字段。
- 前端复用现有组/权益/勋章校验和映射，验证固定 UID、余额、来源、revision、快照、权限栏目一致性；错误直接传播，无降级读取。

## 当前验证
- RED：新增前端 7 项失败；Rust 2 项分别因缺路由/缺 OpenAPI 失败；真实旧服务接口 404。
- Targeted：前端 12 项通过；Rust users 7 项通过，包括仅账号读取、仅组目录不足以读成员关系、授权组/积分不扩大其他栏目、缺成长账户不被读取初始化，以及 401/403/404/422/request_id。
- 完整前端：120 文件/1124 项 PASS；TypeScript、e2e 类型、production build、OpenAPI 生成一致性、fmt、diff 空白检查均 PASS。
- 浏览器真实适配器成功读取 3 位现有用户，含实际权益记录；所有 UID/request_id 匹配。6 模块 × 5 宽度 × 2 主题零横向溢出、零浏览器错误/失败响应，截图已保存。
- cargo test --workspace：500 项 PASS，exit 0；cargo clippy --workspace --all-targets -- -D warnings：PASS，exit 0。完整插件配置恢复后实时 OpenAPI 再次校验一致，聚合及插件列表均 200。

证据：test-results/admin-membership-rebuild/M03/T01。首次 MSVC 缺 linker 与随后取消的工具链运行仅为环境日志，业务 RED 以 red-rust-gnu.log 为准。实际使用既有 Rust 1.94.1 GNU 工具链，无安装/依赖修改。

本地服务已用 wasm-plugins 功能重新构建并恢复原插件启用配置。临时无插件读取服务已停止；原服务启动失败及恢复过程保留 api-service.log，不掩盖。

## 后续
T01 全量后端、clippy 与复验已完成。下一步实施 M03-T02：批量用户列表会员投影与服务端筛选，不能逐行调用聚合接口。M04–M08 仍未开始。
