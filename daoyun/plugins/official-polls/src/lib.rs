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

struct Polls;

impl bindings::exports::daoyun::plugin_business::guest::Guest for Polls {
    fn on_event(_context: RequestContext, _event: Event) -> Result<Vec<CommandRequest>, String> {
        Ok(Vec::new())
    }

    fn ui_contributions(context: RequestContext) -> Result<Vec<UiContribution>, String> {
        if context.ui_slot != Some(UiSlot::AdminPlugin) {
            return Ok(Vec::new());
        }
        Ok(vec![UiContribution {
            slot: UiSlot::AdminPlugin,
            schema_json: r#"{"schema_version":1,"title":"单选投票","blocks":[{"kind":"status","tone":"success","text":"单选投票扩展已启用"},{"kind":"text","text":"作者可在发布器创建投票，成员在内容详情中参与。"}]}"#.to_owned(),
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
    use super::{Polls, bindings};
    bindings::export!(Polls with_types_in bindings);
}
