#![deny(unsafe_code)]

#[allow(unsafe_code)]
mod bindings {
    wit_bindgen::generate!({
        path: "wit",
        world: "business-plugin",
    });
}

use bindings::daoyun::plugin_business::types::{
    CommandKind, CommandRequest, Event, EventKind, RequestContext, UiAction, UiContribution,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

const UTC_DAY_MILLISECONDS: u64 = 86_400_000;
const CLAIM_NAMESPACE: Uuid = Uuid::from_bytes([
    0x01, 0x98, 0xf0, 0xd2, 0x1a, 0x65, 0x77, 0xd6, 0x92, 0xb0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
]);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TopicPublishedV1 {
    topic_id: Uuid,
    #[serde(rename = "board_id")]
    _board_id: Uuid,
    author_id: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplyCreatedV1 {
    reply_id: Uuid,
    #[serde(rename = "topic_id")]
    _topic_id: Uuid,
    #[serde(rename = "board_id")]
    _board_id: Uuid,
    author_id: Uuid,
}

struct OfficialGrowthRewards;

fn growth_commands_for_event(
    context: &RequestContext,
    event: &Event,
) -> Result<Vec<CommandRequest>, String> {
    let (author_id, rule_key, amount) = match event.kind {
        EventKind::TopicPublished => {
            require_v1(event)?;
            let payload: TopicPublishedV1 = serde_json::from_str(&event.payload_json)
                .map_err(|_| "event.payload_invalid".to_owned())?;
            require_aggregate(event, payload.topic_id)?;
            (payload.author_id, "growth.topic_first_daily", 10)
        }
        EventKind::ReplyCreated => {
            require_v1(event)?;
            let payload: ReplyCreatedV1 = serde_json::from_str(&event.payload_json)
                .map_err(|_| "event.payload_invalid".to_owned())?;
            require_aggregate(event, payload.reply_id)?;
            (payload.author_id, "growth.reply_first_daily", 3)
        }
        _ => return Ok(Vec::new()),
    };
    let business_day = context.occurred_at_unix_ms / UTC_DAY_MILLISECONDS;
    let idempotency_key = format!("growth:{rule_key}:{author_id}:{business_day}");
    let source_resource_id = Uuid::new_v5(&CLAIM_NAMESPACE, idempotency_key.as_bytes());

    Ok(vec![CommandRequest {
        kind: CommandKind::ExperienceAppend,
        subject_id: author_id.to_string(),
        idempotency_key,
        payload_json: json!({
            "amount": amount,
            "reason": rule_key,
            "source_resource_id": source_resource_id,
        })
        .to_string(),
    }])
}

fn require_v1(event: &Event) -> Result<(), String> {
    if event.payload_schema_version == 1 {
        Ok(())
    } else {
        Err("event.schema_version.unsupported".to_owned())
    }
}

fn require_aggregate(event: &Event, payload_id: Uuid) -> Result<(), String> {
    let aggregate_id = event
        .aggregate_id
        .as_deref()
        .ok_or_else(|| "event.aggregate_invalid".to_owned())
        .and_then(|value| {
            Uuid::parse_str(value).map_err(|_| "event.aggregate_invalid".to_owned())
        })?;
    if aggregate_id == payload_id {
        Ok(())
    } else {
        Err("event.aggregate_mismatch".to_owned())
    }
}

impl bindings::exports::daoyun::plugin_business::guest::Guest for OfficialGrowthRewards {
    fn on_event(context: RequestContext, event: Event) -> Result<Vec<CommandRequest>, String> {
        growth_commands_for_event(&context, &event)
    }

    fn ui_contributions(_context: RequestContext) -> Result<Vec<UiContribution>, String> {
        Ok(Vec::new())
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
    use super::{OfficialGrowthRewards, bindings};

    bindings::export!(OfficialGrowthRewards with_types_in bindings);
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use uuid::Uuid;

    use super::*;
    use bindings::daoyun::plugin_business::types::{CommandKind, EventKind};

    const USER_ID: &str = "0198f0d2-1a5b-7d3c-9e10-112233445566";
    const BOARD_ID: &str = "0198f0d2-1a5c-7e4d-8f20-223344556677";
    const TOPIC_ID: &str = "0198f0d2-1a5d-7f5e-9a30-334455667788";
    const REPLY_ID: &str = "0198f0d2-1a5e-706f-8b40-445566778899";

    fn context(occurred_at_unix_ms: u64) -> RequestContext {
        RequestContext {
            request_id: "0198f0d2-1a5f-7170-9c50-556677889900".to_owned(),
            site_id: "default".to_owned(),
            actor_id: None,
            subject_id: None,
            ui_slot: None,
            occurred_at_unix_ms,
        }
    }

    fn topic_event(topic_id: &str, payload_schema_version: u16) -> Event {
        Event {
            id: "0198f0d2-1a60-7281-8d60-667788990011".to_owned(),
            kind: EventKind::TopicPublished,
            aggregate_id: Some(topic_id.to_owned()),
            payload_schema_version,
            payload_json: json!({
                "topic_id": topic_id,
                "board_id": BOARD_ID,
                "author_id": USER_ID,
            })
            .to_string(),
        }
    }

    #[test]
    fn first_topic_rule_returns_a_bounded_idempotent_experience_command() {
        let first =
            growth_commands_for_event(&context(1_700_000_000_000), &topic_event(TOPIC_ID, 1))
                .expect("v1 topic event must be accepted");
        let second_topic = "0198f0d2-1a61-7392-9e70-778899001122";
        let replay =
            growth_commands_for_event(&context(1_700_000_030_000), &topic_event(second_topic, 1))
                .expect("a second topic on the same UTC day must be accepted");

        assert_eq!(first.len(), 1);
        assert_eq!(replay.len(), 1);
        assert_eq!(first[0].kind, replay[0].kind);
        assert_eq!(first[0].subject_id, replay[0].subject_id);
        assert_eq!(first[0].idempotency_key, replay[0].idempotency_key);
        assert_eq!(first[0].payload_json, replay[0].payload_json);
        assert_eq!(first[0].kind, CommandKind::ExperienceAppend);
        assert_eq!(first[0].subject_id, USER_ID);
        assert_eq!(
            first[0].idempotency_key,
            format!("growth:growth.topic_first_daily:{USER_ID}:19675")
        );
        let payload: Value =
            serde_json::from_str(&first[0].payload_json).expect("command payload must be JSON");
        assert_eq!(payload["amount"], 10);
        assert_eq!(payload["reason"], "growth.topic_first_daily");
        Uuid::parse_str(
            payload["source_resource_id"]
                .as_str()
                .expect("claim source must be a string"),
        )
        .expect("claim source must be a UUID");
    }

    #[test]
    fn next_utc_day_and_reply_rule_create_distinct_claims() {
        let today =
            growth_commands_for_event(&context(1_700_000_000_000), &topic_event(TOPIC_ID, 1))
                .expect("today topic event must be accepted");
        let tomorrow =
            growth_commands_for_event(&context(1_700_086_400_000), &topic_event(TOPIC_ID, 1))
                .expect("tomorrow topic event must be accepted");
        let reply = Event {
            id: "0198f0d2-1a62-74a3-8f80-889900112233".to_owned(),
            kind: EventKind::ReplyCreated,
            aggregate_id: Some(REPLY_ID.to_owned()),
            payload_schema_version: 1,
            payload_json: json!({
                "reply_id": REPLY_ID,
                "topic_id": TOPIC_ID,
                "board_id": BOARD_ID,
                "author_id": USER_ID,
            })
            .to_string(),
        };
        let reply = growth_commands_for_event(&context(1_700_000_000_000), &reply)
            .expect("v1 reply event must be accepted");

        assert_ne!(today[0].idempotency_key, tomorrow[0].idempotency_key);
        assert_ne!(today[0].idempotency_key, reply[0].idempotency_key);
        let payload: Value =
            serde_json::from_str(&reply[0].payload_json).expect("command payload must be JSON");
        assert_eq!(payload["amount"], 3);
        assert_eq!(payload["reason"], "growth.reply_first_daily");
    }

    #[test]
    fn unsupported_or_inconsistent_event_payloads_are_rejected() {
        assert!(matches!(
            growth_commands_for_event(&context(1_700_000_000_000), &topic_event(TOPIC_ID, 2)),
            Err(error) if error == "event.schema_version.unsupported"
        ));

        let mut mismatched = topic_event(TOPIC_ID, 1);
        mismatched.aggregate_id = Some("0198f0d2-1a63-75b4-9090-990011223344".to_owned());
        assert!(matches!(
            growth_commands_for_event(&context(1_700_000_000_000), &mismatched),
            Err(error) if error == "event.aggregate_mismatch"
        ));

        let mut malformed = topic_event(TOPIC_ID, 1);
        malformed.payload_json = "not-json".to_owned();
        assert!(matches!(
            growth_commands_for_event(&context(1_700_000_000_000), &malformed),
            Err(error) if error == "event.payload_invalid"
        ));
    }

    #[test]
    fn unrelated_events_do_not_create_growth_commands() {
        let event = Event {
            id: "0198f0d2-1a64-76c5-81a0-001122334455".to_owned(),
            kind: EventKind::PointsChanged,
            aggregate_id: Some(USER_ID.to_owned()),
            payload_schema_version: 1,
            payload_json: "{}".to_owned(),
        };

        assert!(
            growth_commands_for_event(&context(1_700_000_000_000), &event)
                .expect("unrelated events must be ignored")
                .is_empty()
        );
    }
}
