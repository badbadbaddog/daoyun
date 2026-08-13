use plugin_host::{
    PluginCapability, PluginHostConfig, PluginManifest, UiBlock, UiSchema, validate_manifest_json,
    validate_ui_schema_json,
};

const VALID_MANIFEST: &str = r#"{
    "schema_version": 1,
    "key": "example_plugin",
    "name": "Example plugin",
    "version": "1.2.3",
    "description": "A bounded plugin",
    "capabilities": ["content.transform", "ui.panel"]
}"#;

#[test]
fn rust_sdk_and_host_share_the_exact_versioned_wit_contract() {
    assert_eq!(
        include_str!("../wit/plugin.wit"),
        include_str!("../../../sdk/plugin-rust-example/wit/plugin.wit")
    );
}

#[test]
fn manifest_accepts_only_the_versioned_bounded_contract() {
    let manifest = validate_manifest_json(VALID_MANIFEST).expect("manifest must be valid");
    assert_eq!(manifest.key, "example_plugin");
    assert_eq!(manifest.version, "1.2.3");
    assert_eq!(
        manifest.capabilities,
        vec![
            PluginCapability::ContentTransform,
            PluginCapability::UiPanel
        ]
    );

    for invalid in [
        VALID_MANIFEST.replace("1.2.3", "01.2.3"),
        VALID_MANIFEST.replace("example_plugin", "Example-Plugin"),
        VALID_MANIFEST.replace(
            "\"content.transform\", \"ui.panel\"",
            "\"content.transform\", \"content.transform\"",
        ),
        VALID_MANIFEST.replace(
            "\"capabilities\":",
            "\"unexpected\": true, \"capabilities\":",
        ),
    ] {
        assert!(validate_manifest_json(&invalid).is_err(), "{invalid}");
    }
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
            {"kind": "status", "tone": "success", "text": "Enabled"}
          ]
        }"#,
    )
    .expect("schema must be valid");
    assert_eq!(schema.blocks.len(), 3);
    assert!(matches!(schema.blocks[0], UiBlock::Text { .. }));

    for invalid in [
        r#"{"schema_version":1,"title":"Panel","blocks":[{"kind":"html","html":"<script>1</script>"}]}"#,
        r#"{"schema_version":1,"title":"Panel","blocks":[{"kind":"text","text":"ok","url":"https://example.com"}]}"#,
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
