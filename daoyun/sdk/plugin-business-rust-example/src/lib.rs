#![deny(unsafe_code)]

#[allow(unsafe_code)]
mod bindings {
    wit_bindgen::generate!({
        path: "wit",
        world: "business-plugin",
    });
}

use bindings::daoyun::plugin_business::types::{
    CommandKind, CommandRequest, Event, EventKind, RequestContext, StoragePutRequest, TaskRequest,
    UiAction, UiContribution, UiSlot,
};

struct ExampleBusinessPlugin;

impl bindings::exports::daoyun::plugin_business::guest::Guest for ExampleBusinessPlugin {
    fn on_event(
        context: RequestContext,
        event: Event,
    ) -> Result<Vec<CommandRequest>, String> {
        if event.kind != EventKind::UserCreated {
            return Ok(Vec::new());
        }
        let Some(subject_id) = event.aggregate_id else {
            return Ok(Vec::new());
        };
        bindings::daoyun::plugin_business::host::storage_put(
            &context,
            &StoragePutRequest {
                key: "last.user-created".to_owned(),
                value: event.id.as_bytes().to_vec(),
                content_type: "text/plain".to_owned(),
                expected_revision: None,
            },
        )?;
        bindings::daoyun::plugin_business::host::schedule(
            &context,
            &TaskRequest {
                task_key: "official.noop".to_owned(),
                run_at_unix_ms: context.occurred_at_unix_ms.saturating_add(1_000),
                idempotency_key: format!("official-example:task:{}", event.id),
                payload_json: r#"{"source":"user.created"}"#.to_owned(),
            },
        )?;
        Ok(vec![CommandRequest {
            kind: CommandKind::NotificationSend,
            subject_id: subject_id.clone(),
            idempotency_key: format!("official-example:event:{}", event.id),
            payload_json: format!(
                r#"{{"kind":"message","target_type":"user","target_id":"{subject_id}"}}"#
            ),
        }])
    }

    fn ui_contributions(context: RequestContext) -> Result<Vec<UiContribution>, String> {
        let Some(slot) = context.ui_slot else {
            return Ok(Vec::new());
        };
        let schema_json = match slot {
            UiSlot::AdminPlugin => r#"{"schema_version":1,"title":"官方业务插件","blocks":[{"kind":"status","tone":"success","text":"事件、任务、命令与隔离存储运行时已连接"},{"kind":"action","label":"发送测试通知","action_key":"notification.send_test"}]}"#,
            UiSlot::UserProfile => r#"{"schema_version":1,"title":"用户资料扩展","blocks":[{"kind":"text","text":"官方示例插件已接入用户资料插槽"}]}"#,
            UiSlot::MembershipPanel => r#"{"schema_version":1,"title":"会员扩展","blocks":[{"kind":"status","tone":"success","text":"会员业务扩展运行正常"}]}"#,
            UiSlot::AdminUser => r#"{"schema_version":1,"title":"用户管理扩展","blocks":[{"kind":"text","text":"官方示例插件已接入后台用户插槽"}]}"#,
        };
        Ok(vec![UiContribution {
            slot,
            schema_json: schema_json.to_owned(),
        }])
    }

    fn on_ui_action(
        context: RequestContext,
        action: UiAction,
    ) -> Result<Vec<CommandRequest>, String> {
        if action.slot != UiSlot::AdminPlugin || action.action_key != "notification.send_test" {
            return Err("action.unsupported".to_owned());
        }
        let actor_id = context.actor_id.ok_or_else(|| "actor.required".to_owned())?;
        Ok(vec![CommandRequest {
            kind: CommandKind::NotificationSend,
            subject_id: actor_id.clone(),
            idempotency_key: action.idempotency_key,
            payload_json: format!(
                r#"{{"kind":"message","target_type":"user","target_id":"{actor_id}"}}"#
            ),
        }])
    }

    fn run_task(
        _context: RequestContext,
        task_key: String,
        payload_json: String,
    ) -> Result<Vec<CommandRequest>, String> {
        if task_key != "membership.expire" {
            return Ok(Vec::new());
        }
        Ok(vec![CommandRequest {
            kind: CommandKind::EntitlementRevoke,
            subject_id: "scheduled-subject".to_owned(),
            idempotency_key: format!("official-example:task:{payload_json}"),
            payload_json,
        }])
    }
}

#[allow(unsafe_code)]
mod component_export {
    use super::{ExampleBusinessPlugin, bindings};

    bindings::export!(ExampleBusinessPlugin with_types_in bindings);
}
