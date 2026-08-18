# DaoYun business plugin example

This example implements the versioned `daoyun:plugin-business@0.1.0` component
contract. It demonstrates an event subscription, isolated storage, a controlled
notification command, a scheduled task, and bounded UI contributions for the
fixed `admin_plugin`, `user_profile`, `membership_panel`, and `admin_user` slots.
The admin contribution also exposes a host-validated action that executes the
controlled notification command without granting the guest HTML, script, or
route access.

```powershell
rustup target add wasm32-wasip2 --toolchain 1.94.1
cargo +1.94.1 build --target wasm32-wasip2 --release
```

The installable component is written to:

```text
target/wasm32-wasip2/release/daoyun_plugin_business_rust_example.wasm
```

The host supplies a sandboxed WASI Preview 2 context. The guest does not inherit
host environment variables, standard streams, directories, or network access.
