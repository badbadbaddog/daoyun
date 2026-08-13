#![deny(unsafe_code)]

#[allow(unsafe_code)]
mod bindings {
    wit_bindgen::generate!({
        path: "wit",
        world: "plugin",
    });
}

struct ExamplePlugin;

impl bindings::Guest for ExamplePlugin {
    fn invoke(
        operation: bindings::daoyun::plugin::types::Operation,
        payload: Vec<u8>,
    ) -> Vec<u8> {
        match operation {
            bindings::daoyun::plugin::types::Operation::ContentTransform => payload
                .into_iter()
                .map(|byte| byte.to_ascii_uppercase())
                .collect(),
            bindings::daoyun::plugin::types::Operation::UiRender => payload,
        }
    }
}

// `wit-bindgen` generates the canonical ABI export shim. The example's
// handwritten implementation remains covered by `deny(unsafe_code)`.
#[allow(unsafe_code)]
mod component_export {
    use super::{ExamplePlugin, bindings};

    bindings::export!(ExamplePlugin with_types_in bindings);
}
