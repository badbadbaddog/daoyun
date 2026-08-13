use plugin_host::{
    PluginCapability, PluginHost, PluginHostConfig, PluginHostError, PluginManifest,
    PluginOperation,
};

const IDENTITY_COMPONENT: &str = include_str!("fixtures/identity-component.wat");

fn manifest(capabilities: Vec<PluginCapability>) -> PluginManifest {
    PluginManifest {
        schema_version: 1,
        key: "identity_plugin".to_owned(),
        name: "Identity plugin".to_owned(),
        version: "1.0.0".to_owned(),
        description: String::new(),
        capabilities,
    }
}

fn infinite_component() -> Vec<u8> {
    let identity_body = r#"      i32.const 0
      local.get 1
      i32.store
      i32.const 4
      local.get 2
      i32.store
      i32.const 0)"#;
    let infinite_body = r#"      (loop $spin
        br $spin)
      unreachable)"#;
    let source = IDENTITY_COMPONENT.replace(identity_body, infinite_body);
    assert_ne!(source, IDENTITY_COMPONENT, "fixture body must be replaced");
    wat::parse_str(source).expect("infinite component must parse")
}

fn memory_hungry_component() -> Vec<u8> {
    let identity_body = r#"      i32.const 0
      local.get 1
      i32.store
      i32.const 4
      local.get 2
      i32.store
      i32.const 0)"#;
    let hungry_body = r#"      i32.const 1024
      memory.grow
      drop
      i32.const 0
      local.get 1
      i32.store
      i32.const 4
      local.get 2
      i32.store
      i32.const 0)"#;
    let source = IDENTITY_COMPONENT.replace(identity_body, hungry_body);
    assert_ne!(source, IDENTITY_COMPONENT, "fixture body must be replaced");
    wat::parse_str(source).expect("memory-hungry component must parse")
}

#[test]
fn component_is_compiled_against_wit_and_invoked_with_fresh_limits() {
    let host = PluginHost::new(PluginHostConfig::default()).expect("host must configure");
    let bytes = wat::parse_str(IDENTITY_COMPONENT).expect("fixture component must parse");
    let plugin = host
        .compile(manifest(vec![PluginCapability::ContentTransform]), &bytes)
        .expect("component must compile");
    assert_eq!(plugin.component_size(), bytes.len());

    let output = host
        .invoke(&plugin, PluginOperation::ContentTransform, b"hello")
        .expect("component must run");
    assert_eq!(output, b"hello");
    assert_eq!(
        host.invoke(&plugin, PluginOperation::UiRender, b"{}"),
        Err(PluginHostError::CapabilityDenied)
    );
}

#[test]
fn core_modules_and_oversized_components_are_rejected_before_persistence() {
    let host = PluginHost::new(PluginHostConfig::default()).expect("host must configure");
    let core_module = wat::parse_str("(module)").expect("core module must parse");
    assert!(matches!(
        host.compile(
            manifest(vec![PluginCapability::ContentTransform]),
            &core_module
        ),
        Err(PluginHostError::InvalidComponent)
    ));
    assert!(matches!(
        host.compile(
            manifest(vec![PluginCapability::ContentTransform]),
            &vec![0; plugin_host::MAX_COMPONENT_BYTES + 1]
        ),
        Err(PluginHostError::InvalidComponent)
    ));
}

#[test]
fn input_and_output_are_bounded_independently_of_guest_memory() {
    let config = PluginHostConfig {
        max_input_bytes: 4,
        max_output_bytes: 4,
        ..PluginHostConfig::default()
    };
    let host = PluginHost::new(config).expect("host must configure");
    let bytes = wat::parse_str(IDENTITY_COMPONENT).expect("fixture component must parse");
    let plugin = host
        .compile(manifest(vec![PluginCapability::ContentTransform]), &bytes)
        .expect("component must compile");

    assert_eq!(
        host.invoke(&plugin, PluginOperation::ContentTransform, b"12345"),
        Err(PluginHostError::InputTooLarge)
    );
    assert_eq!(
        host.invoke(&plugin, PluginOperation::ContentTransform, b"1234"),
        Ok(b"1234".to_vec())
    );

    let output_host = PluginHost::new(PluginHostConfig {
        max_input_bytes: 8,
        max_output_bytes: 4,
        ..PluginHostConfig::default()
    })
    .expect("host must configure");
    let output_plugin = output_host
        .compile(manifest(vec![PluginCapability::ContentTransform]), &bytes)
        .expect("component must compile");
    assert_eq!(
        output_host.invoke(&output_plugin, PluginOperation::ContentTransform, b"12345"),
        Err(PluginHostError::OutputTooLarge)
    );
}

#[test]
fn fuel_exhaustion_is_reported_without_guest_details() {
    let host = PluginHost::new(PluginHostConfig {
        fuel: 100_000,
        ..PluginHostConfig::default()
    })
    .expect("host must configure");
    let bytes = infinite_component();
    let plugin = host
        .compile(manifest(vec![PluginCapability::ContentTransform]), &bytes)
        .expect("component must compile");

    assert_eq!(
        host.invoke(&plugin, PluginOperation::ContentTransform, b"hello"),
        Err(PluginHostError::ResourceExhausted)
    );
}

#[test]
fn guest_memory_growth_is_limited_and_reported_as_resource_exhaustion() {
    let host = PluginHost::new(PluginHostConfig {
        memory_bytes: 64 * 1024,
        ..PluginHostConfig::default()
    })
    .expect("host must configure");
    let bytes = memory_hungry_component();
    let plugin = host
        .compile(manifest(vec![PluginCapability::ContentTransform]), &bytes)
        .expect("component must compile within its initial memory");

    assert_eq!(
        host.invoke(&plugin, PluginOperation::ContentTransform, b"hello"),
        Err(PluginHostError::ResourceExhausted)
    );
}

#[test]
fn ui_render_output_must_be_valid_utf8_and_the_static_schema() {
    let host = PluginHost::new(PluginHostConfig::default()).expect("host must configure");
    let bytes = wat::parse_str(IDENTITY_COMPONENT).expect("fixture component must parse");
    let plugin = host
        .compile(manifest(vec![PluginCapability::UiPanel]), &bytes)
        .expect("component must compile");
    let valid = br#"{"schema_version":1,"title":"Panel","blocks":[{"kind":"text","text":"ok"}]}"#;

    assert_eq!(
        host.invoke(&plugin, PluginOperation::UiRender, valid),
        Ok(valid.to_vec())
    );
    assert_eq!(
        host.invoke(&plugin, PluginOperation::UiRender, b"not-json"),
        Err(PluginHostError::InvalidUiSchema)
    );
    assert_eq!(
        host.invoke(&plugin, PluginOperation::UiRender, &[0xff, 0xfe]),
        Err(PluginHostError::InvalidUiSchema)
    );
}
