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

struct TopicSupplements;

impl bindings::exports::daoyun::plugin_business::guest::Guest for TopicSupplements {
    fn on_event(_context: RequestContext, _event: Event) -> Result<Vec<CommandRequest>, String> {
        Ok(Vec::new())
    }

    fn ui_contributions(context: RequestContext) -> Result<Vec<UiContribution>, String> {
        if context.ui_slot != Some(UiSlot::AdminPlugin) {
            return Ok(Vec::new());
        }
        Ok(vec![UiContribution {
            slot: UiSlot::AdminPlugin,
            schema_json: r#"{"schema_version":1,"title":"帖子补充","blocks":[{"kind":"status","tone":"success","text":"作者补充扩展已启用"},{"kind":"text","text":"通过插件设置调整全站次数。作者可在原帖正文下方提交补充，保存后直接发布。"}]}"#.to_owned(),
        }])
    }

    fn on_ui_action(
        _context: RequestContext,
        _action: UiAction,
    ) -> Result<Vec<CommandRequest>, String> {
        // Content writes use the host-owned topic.supplements capability, not arbitrary guest commands.
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
    use super::{TopicSupplements, bindings};
    bindings::export!(TopicSupplements with_types_in bindings);
}
