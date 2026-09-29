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

struct PointsRedemption;

impl bindings::exports::daoyun::plugin_business::guest::Guest for PointsRedemption {
    fn on_event(_context: RequestContext, _event: Event) -> Result<Vec<CommandRequest>, String> {
        Ok(Vec::new())
    }

    fn ui_contributions(context: RequestContext) -> Result<Vec<UiContribution>, String> {
        if context.ui_slot != Some(UiSlot::AdminPlugin) {
            return Ok(Vec::new());
        }
        Ok(vec![UiContribution {
            slot: UiSlot::AdminPlugin,
            schema_json: r#"{"schema_version":1,"title":"积分兑换","blocks":[{"kind":"status","tone":"success","text":"积分兑换扩展已启用"},{"kind":"text","text":"管理员在会员经济配置兑换商品，成员在会员中心兑换限时权益。"}]}"#.to_owned(),
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
    use super::{PointsRedemption, bindings};
    bindings::export!(PointsRedemption with_types_in bindings);
}
