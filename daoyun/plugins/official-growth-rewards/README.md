# DaoYun 官方成长奖励插件

该插件实现 `docs/specs/official-growth-rewards-plugin.md` 的首个成长纵向切片。它监听
`topic.published` 与 `reply.created` v1 事件，并为每位用户每天首次主题和首次回复返回
幂等的 `experience.append` 命令。

```powershell
rustup target add wasm32-wasip2 --toolchain 1.94.1
cargo +1.94.1 build --target wasm32-wasip2 --release
```

可安装 Component：

```text
target/wasm32-wasip2/release/daoyun_official_growth_rewards.wasm
```

安装时使用同目录的 `plugin.json`。插件不申请 UI、存储、任务、通知、Points 或网络能力。
核心以稳定插件 key、规则、用户和 UTC 业务日组合最终命令幂等键，因此卸载后重装不会重复
发放同日奖励；命令日配额耗尽时投递会延期到下一个 UTC 配额窗口继续处理。
