use std::process::Command;

#[test]
fn unsupported_growth_executors_are_rejected_before_database_work() {
    for executor in ["builtin", "wasm,builtin", "builtin,wasm", "unknown"] {
        let result = Command::new(env!("CARGO_BIN_EXE_daoyun-api"))
            .env("DAOYUN_GROWTH_REWARDS_EXECUTOR", executor)
            .env("DAOYUN_PLUGINS_ENABLED", "false")
            .env("DATABASE_URL", "deliberately-invalid-database-url")
            .output()
            .expect("API must start to validate executor configuration");
        assert!(!result.status.success());
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(
            stderr.contains("InvalidConfiguration"),
            "executor {executor} must fail before database configuration: {stderr}"
        );
    }
}

#[cfg(feature = "wasm-plugins")]
#[test]
fn wasm_selection_preserves_the_existing_runtime_configuration() {
    let result = Command::new(env!("CARGO_BIN_EXE_daoyun-api"))
        .env("DAOYUN_GROWTH_REWARDS_EXECUTOR", "wasm")
        .env("DAOYUN_PLUGINS_ENABLED", "false")
        .env("DATABASE_URL", "deliberately-invalid-database-url")
        .output()
        .expect("API must validate the supported executor before the database");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(
        stderr.contains("RelativeUrlWithoutBase"),
        "Wasm selection must reach database configuration: {stderr}"
    );
}

#[cfg(not(feature = "wasm-plugins"))]
#[test]
fn base_build_rejects_wasm_configuration_before_database_work() {
    for (executor, enabled) in [("wasm", "false"), ("", "true"), ("", "1")] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_daoyun-api"));
        command.env_remove("DAOYUN_GROWTH_REWARDS_EXECUTOR");
        if !executor.is_empty() {
            command.env("DAOYUN_GROWTH_REWARDS_EXECUTOR", executor);
        }
        let result = command
            .env("DAOYUN_PLUGINS_ENABLED", enabled)
            .env("DATABASE_URL", "deliberately-invalid-database-url")
            .output()
            .expect("API must validate unsupported Wasm before the database");
        assert!(!result.status.success());
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(
            stderr.contains("InvalidConfiguration"),
            "unsupported Wasm must fail before database configuration: {stderr}"
        );
        assert!(!stderr.contains("RelativeUrlWithoutBase"));
    }
}
