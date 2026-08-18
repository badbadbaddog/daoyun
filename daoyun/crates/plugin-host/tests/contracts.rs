use plugin_host::{
    BUSINESS_API_VERSION, MAX_MANIFEST_BYTES, PluginCapability, PluginDataScope,
    PluginEventSubscription, PluginHostConfig, PluginManifest, UiBlock, UiSchema,
    business::BusinessPluginHost, validate_manifest_json, validate_ui_schema_json,
};

const VALID_MANIFEST: &str = r#"{
    "schema_version": 1,
    "key": "example_plugin",
    "name": "Example plugin",
    "version": "1.2.3",
    "description": "A bounded plugin",
    "capabilities": ["ui.panel", "core.query", "points.write"],
    "business_api_version": "0.1.0",
    "data_scopes": ["site.read", "users.targeted"]
}"#;

#[test]
fn rust_sdk_and_host_share_the_exact_versioned_wit_contract() {
    let business_wit = include_str!("../wit-business/business.wit");
    assert_eq!(
        include_str!("../wit/plugin.wit"),
        include_str!("../../../sdk/plugin-rust-example/wit/plugin.wit")
    );
    assert_eq!(
        include_str!("../wit-business/business.wit"),
        include_str!("../../../sdk/plugin-rust-example/wit-business/business.wit")
    );
    assert_eq!(
        include_str!("../wit-business/business.wit"),
        include_str!("../../../sdk/plugin-business-rust-example/wit/business.wit")
    );
    assert_eq!(
        include_str!("../wit-business/business.wit"),
        include_str!("../../../plugins/official-growth-rewards/wit/business.wit")
    );
    assert!(
        business_wit.contains("payload-schema-version: u16"),
        "business events must expose their payload schema version"
    );
    assert!(
        business_wit.starts_with(&format!(
            "package daoyun:plugin-business@{BUSINESS_API_VERSION};"
        )),
        "the WIT package version must match the host business API version"
    );
    let mut resolve = wit_parser::Resolve::default();
    resolve
        .push_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("wit-business"))
        .expect("business WIT package must parse");
}

#[test]
fn official_growth_rewards_manifest_requests_only_its_runtime_boundaries() {
    let manifest = validate_manifest_json(include_str!(
        "../../../plugins/official-growth-rewards/plugin.json"
    ))
    .expect("official growth manifest must be valid");

    assert_eq!(
        manifest.capabilities,
        vec![
            PluginCapability::EventsSubscribe,
            PluginCapability::ExperienceWrite,
        ]
    );
    assert_eq!(manifest.data_scopes, vec![PluginDataScope::UsersTargeted]);
    assert_eq!(
        manifest.event_subscriptions,
        vec![
            PluginEventSubscription::TopicPublished,
            PluginEventSubscription::ReplyCreated,
        ]
    );
}

#[test]
#[ignore = "run after building plugins/official-growth-rewards for wasm32-wasip2"]
fn official_growth_component_instantiates_with_only_bounded_wasi_cli_imports() {
    let component_path = std::env::var("DAOYUN_OFFICIAL_GROWTH_COMPONENT")
        .expect("DAOYUN_OFFICIAL_GROWTH_COMPONENT must point to the release component");
    let component = std::fs::read(component_path).expect("official component must be readable");
    let manifest = validate_manifest_json(include_str!(
        "../../../plugins/official-growth-rewards/plugin.json"
    ))
    .expect("official growth manifest must be valid");
    let host =
        BusinessPluginHost::new(PluginHostConfig::default()).expect("business host must configure");

    let mut config = wasmtime::Config::new();
    config.wasm_component_model(true);
    let engine = wasmtime::Engine::new(&config).expect("inspection engine must configure");
    let inspected = wasmtime::component::Component::new(&engine, &component)
        .expect("official component must decode");
    let imports = inspected
        .component_type()
        .imports(&engine)
        .map(|(name, _)| name.to_owned())
        .collect::<Vec<_>>();
    assert!(imports.iter().all(|name| {
        name.starts_with("daoyun:plugin-business/")
            || name.starts_with("wasi:io/")
            || name.starts_with("wasi:cli/")
    }));

    host.compile(manifest, &component)
        .expect("official component must instantiate with only bounded CLI and DaoYun imports");
}

#[test]
fn manifest_accepts_only_the_versioned_bounded_contract() {
    let manifest = validate_manifest_json(VALID_MANIFEST).expect("manifest must be valid");
    assert_eq!(manifest.key, "example_plugin");
    assert_eq!(manifest.version, "1.2.3");
    assert_eq!(
        manifest.capabilities,
        vec![
            PluginCapability::UiPanel,
            PluginCapability::CoreQuery,
            PluginCapability::PointsWrite,
        ]
    );
    assert_eq!(manifest.business_api_version.as_deref(), Some("0.1.0"));
    assert_eq!(
        manifest.data_scopes,
        vec![PluginDataScope::SiteRead, PluginDataScope::UsersTargeted]
    );

    for invalid in [
        VALID_MANIFEST.replace("1.2.3", "01.2.3"),
        VALID_MANIFEST.replace("example_plugin", "Example-Plugin"),
        VALID_MANIFEST.replace(
            "\"ui.panel\", \"core.query\", \"points.write\"",
            "\"ui.panel\", \"ui.panel\"",
        ),
        VALID_MANIFEST.replace(
            "\"capabilities\":",
            "\"unexpected\": true, \"capabilities\":",
        ),
        VALID_MANIFEST.replace("\"schema_version\": 1", "\"schema_version\": 2"),
        VALID_MANIFEST.replace("\"core.query\"", "\"core.unknown\""),
        VALID_MANIFEST.replace("\"0.1.0\"", "\"9.0.0\""),
        VALID_MANIFEST.replace(
            "\"site.read\", \"users.targeted\"",
            "\"site.read\", \"site.read\"",
        ),
    ] {
        assert!(validate_manifest_json(&invalid).is_err(), "{invalid}");
    }
    assert!(validate_manifest_json(&"x".repeat(MAX_MANIFEST_BYTES + 1)).is_err());
}

#[test]
fn manifest_keeps_legacy_and_business_component_abis_mutually_exclusive() {
    let mixed = VALID_MANIFEST.replace(
        "\"ui.panel\", \"core.query\", \"points.write\"",
        "\"content.transform\", \"ui.panel\", \"core.query\", \"points.write\"",
    );
    assert!(validate_manifest_json(&mixed).is_err());

    let legacy = r#"{
        "schema_version": 1,
        "key": "legacy_plugin",
        "name": "Legacy plugin",
        "version": "1.0.0",
        "description": "Legacy ABI fixture",
        "capabilities": ["content.transform", "ui.panel"]
    }"#;
    assert!(validate_manifest_json(legacy).is_ok());
}

#[test]
fn manifest_models_do_not_accept_unvalidated_construction_as_valid() {
    let invalid = PluginManifest {
        schema_version: 1,
        key: "bad-key".to_owned(),
        name: "Plugin".to_owned(),
        version: "1.0.0".to_owned(),
        description: String::new(),
        capabilities: vec![PluginCapability::UiPanel],
        business_api_version: None,
        data_scopes: Vec::new(),
        event_subscriptions: Vec::new(),
    };
    assert!(invalid.validate().is_err());
}

#[test]
fn host_limits_reject_zero_or_unbounded_configuration() {
    assert!(PluginHostConfig::default().validate().is_ok());
    assert!(
        PluginHostConfig {
            fuel: 0,
            ..PluginHostConfig::default()
        }
        .validate()
        .is_err()
    );
    assert!(
        PluginHostConfig {
            memory_bytes: 33 * 1024 * 1024,
            ..PluginHostConfig::default()
        }
        .validate()
        .is_err()
    );
}

#[test]
fn ui_schema_accepts_only_static_bounded_blocks() {
    let schema = validate_ui_schema_json(
        r#"{
          "schema_version": 1,
          "title": "Example panel",
          "blocks": [
            {"kind": "text", "text": "Static content"},
            {"kind": "metric", "label": "State", "value": "Ready"},
            {"kind": "status", "tone": "success", "text": "Enabled"},
            {"kind": "action", "label": "Refresh", "action_key": "panel.refresh"}
          ]
        }"#,
    )
    .expect("schema must be valid");
    assert_eq!(schema.blocks.len(), 4);
    assert!(matches!(schema.blocks[0], UiBlock::Text { .. }));

    for invalid in [
        r#"{"schema_version":1,"title":"Panel","blocks":[{"kind":"html","html":"<script>1</script>"}]}"#,
        r#"{"schema_version":1,"title":"Panel","blocks":[{"kind":"text","text":"ok","url":"https://example.com"}]}"#,
        r#"{"schema_version":1,"title":"Panel","blocks":[{"kind":"action","label":"Run","action_key":"Bad Action"}]}"#,
        r#"{"schema_version":2,"title":"Panel","blocks":[]}"#,
    ] {
        assert!(validate_ui_schema_json(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn ui_schema_models_still_require_explicit_validation() {
    let invalid = UiSchema {
        schema_version: 1,
        title: "".to_owned(),
        blocks: Vec::new(),
    };
    assert!(invalid.validate().is_err());
}
