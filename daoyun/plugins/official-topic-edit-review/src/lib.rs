#![deny(unsafe_code)]

#[allow(unsafe_code)]
mod bindings {
    wit_bindgen::generate!({
        path: "../../crates/plugin-host/wit-business",
        world: "business-plugin",
    });
}

use bindings::daoyun::plugin_business::types::{
    CommandRequest, Event, RequestContext, UiAction, UiContribution, UiSlot,
};

struct TopicEditReview;

impl bindings::exports::daoyun::plugin_business::guest::Guest for TopicEditReview {
    fn on_event(_context: RequestContext, _event: Event) -> Result<Vec<CommandRequest>, String> {
        Ok(Vec::new())
    }

    fn ui_contributions(context: RequestContext) -> Result<Vec<UiContribution>, String> {
        if context.ui_slot != Some(UiSlot::AdminPlugin) {
            return Ok(Vec::new());
        }
        Ok(vec![UiContribution {
            slot: UiSlot::AdminPlugin,
            schema_json: r#"{"schema_version":1,"title":"编辑审核","blocks":[{"kind":"status","tone":"success","text":"编辑审核扩展已启用"},{"kind":"text","text":"可按版块分别配置主题与回复编辑审核。待审期间继续公开旧版本。"}]}"#.to_owned(),
        }])
    }

    fn on_ui_action(
        _context: RequestContext,
        _action: UiAction,
    ) -> Result<Vec<CommandRequest>, String> {
        Err("action.unsupported".to_owned())
    }

    fn run_task(
        _context: RequestContext,
        _task_key: String,
        _payload_json: String,
    ) -> Result<Vec<CommandRequest>, String> {
        Ok(Vec::new())
    }
}

#[allow(unsafe_code)]
mod component_export {
    use super::{TopicEditReview, bindings};
    bindings::export!(TopicEditReview with_types_in bindings);
}
