use serde_json::Value;
use url::Url;
use uuid::Uuid;

const MAX_NODES: usize = 20_000;
const MAX_DEPTH: usize = 32;
const MAX_IMAGES: usize = 20;
const MIN_IMAGE_DIMENSION: u64 = 40;
const MAX_IMAGE_DIMENSION: u64 = 2_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RichContentError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReplyGateProjection {
    pub document: Value,
    pub plain_text: String,
    pub has_locked_content: bool,
}

pub(crate) fn validate_and_project(
    document: Value,
    max_text_chars: usize,
) -> Result<(Value, String), RichContentError> {
    let mut state = ValidationState::default();
    validate_document(&document, &mut state)?;
    let text = project_plain_text(&document);
    let character_count = text.chars().count();
    if !(1..=max_text_chars).contains(&character_count)
        || text.chars().any(disallowed_content_control)
    {
        return Err(RichContentError);
    }
    Ok((document, text))
}

pub(crate) fn redact_reply_gates(mut document: Value, unlocked: bool) -> ReplyGateProjection {
    let mut has_locked_content = false;
    redact_reply_gate_node(&mut document, unlocked, &mut has_locked_content);
    let plain_text = project_plain_text(&document);
    ReplyGateProjection {
        document,
        plain_text,
        has_locked_content,
    }
}

#[derive(Default)]
struct ValidationState {
    nodes: usize,
    images: usize,
}

#[derive(Clone, Copy)]
enum ChildContext {
    Block,
    Inline,
    ListItem,
}

fn validate_document(value: &Value, state: &mut ValidationState) -> Result<(), RichContentError> {
    let object = value.as_object().ok_or(RichContentError)?;
    if !has_only_keys(object, &["type", "content"])
        || object.get("type").and_then(Value::as_str) != Some("doc")
    {
        return Err(RichContentError);
    }
    let content = object
        .get("content")
        .and_then(Value::as_array)
        .ok_or(RichContentError)?;
    for node in content {
        validate_node(node, ChildContext::Block, 1, state)?;
    }
    Ok(())
}

fn validate_node(
    value: &Value,
    context: ChildContext,
    depth: usize,
    state: &mut ValidationState,
) -> Result<(), RichContentError> {
    if depth > MAX_DEPTH {
        return Err(RichContentError);
    }
    state.nodes += 1;
    if state.nodes > MAX_NODES {
        return Err(RichContentError);
    }
    let object = value.as_object().ok_or(RichContentError)?;
    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or(RichContentError)?;
    match node_type {
        "paragraph" => {
            require_context(context, &[ChildContext::Block])?;
            validate_container(object, ChildContext::Inline, depth, state)
        }
        "heading" => {
            require_context(context, &[ChildContext::Block])?;
            if !has_only_keys(object, &["type", "attrs", "content"]) {
                return Err(RichContentError);
            }
            let attrs = object
                .get("attrs")
                .and_then(Value::as_object)
                .ok_or(RichContentError)?;
            if !has_only_keys(attrs, &["level"])
                || !matches!(attrs.get("level").and_then(Value::as_u64), Some(2..=4))
            {
                return Err(RichContentError);
            }
            validate_children(object, ChildContext::Inline, depth, state)
        }
        "blockquote" => {
            require_context(context, &[ChildContext::Block])?;
            validate_container(object, ChildContext::Block, depth, state)
        }
        "replyGate" => {
            require_context(context, &[ChildContext::Block])?;
            validate_container(object, ChildContext::Block, depth, state)
        }
        "bulletList" => {
            require_context(context, &[ChildContext::Block])?;
            validate_container(object, ChildContext::ListItem, depth, state)
        }
        "orderedList" => {
            require_context(context, &[ChildContext::Block])?;
            if !has_only_keys(object, &["type", "attrs", "content"]) {
                return Err(RichContentError);
            }
            let attrs = object
                .get("attrs")
                .and_then(Value::as_object)
                .ok_or(RichContentError)?;
            if !has_only_keys(attrs, &["start"])
                || !matches!(attrs.get("start").and_then(Value::as_u64), Some(1..=10_000))
            {
                return Err(RichContentError);
            }
            validate_children(object, ChildContext::ListItem, depth, state)
        }
        "listItem" => {
            require_context(context, &[ChildContext::ListItem])?;
            validate_container(object, ChildContext::Block, depth, state)
        }
        "codeBlock" => {
            require_context(context, &[ChildContext::Block])?;
            if !has_only_keys(object, &["type", "attrs", "content"]) {
                return Err(RichContentError);
            }
            if let Some(attrs) = object.get("attrs") {
                let attrs = attrs.as_object().ok_or(RichContentError)?;
                if !has_only_keys(attrs, &["language"])
                    || attrs.get("language").is_some_and(|language| {
                        !language.is_null()
                            && language
                                .as_str()
                                .is_none_or(|value| value.len() > 40 || !value.is_ascii())
                    })
                {
                    return Err(RichContentError);
                }
            }
            validate_code_children(object, depth, state)
        }
        "horizontalRule" => {
            require_context(context, &[ChildContext::Block])?;
            if !has_only_keys(object, &["type"]) {
                return Err(RichContentError);
            }
            Ok(())
        }
        "image" => validate_image(object, context, state),
        "hardBreak" => {
            require_context(context, &[ChildContext::Inline])?;
            if !has_only_keys(object, &["type"]) {
                return Err(RichContentError);
            }
            Ok(())
        }
        "text" => validate_text(object, context),
        _ => Err(RichContentError),
    }
}

fn validate_image(
    object: &serde_json::Map<String, Value>,
    context: ChildContext,
    state: &mut ValidationState,
) -> Result<(), RichContentError> {
    require_context(context, &[ChildContext::Block])?;
    if !has_only_keys(object, &["type", "attrs"]) {
        return Err(RichContentError);
    }
    let attrs = object
        .get("attrs")
        .and_then(Value::as_object)
        .ok_or(RichContentError)?;
    if !has_only_keys(attrs, &["attachmentId", "alt", "width", "height"]) {
        return Err(RichContentError);
    }
    let attachment_id = attrs
        .get("attachmentId")
        .and_then(Value::as_str)
        .ok_or(RichContentError)?;
    Uuid::parse_str(attachment_id).map_err(|_| RichContentError)?;
    if attrs.get("alt").is_some_and(|alt| {
        !alt.is_null()
            && alt.as_str().is_none_or(|value| {
                value.len() > 300 || value.chars().any(disallowed_content_control)
            })
    }) {
        return Err(RichContentError);
    }
    for dimension in ["width", "height"] {
        if attrs.get(dimension).is_some_and(|value| {
            !matches!(
                value.as_u64(),
                Some(MIN_IMAGE_DIMENSION..=MAX_IMAGE_DIMENSION)
            )
        }) {
            return Err(RichContentError);
        }
    }
    state.images += 1;
    if state.images > MAX_IMAGES {
        return Err(RichContentError);
    }
    Ok(())
}

fn validate_container(
    object: &serde_json::Map<String, Value>,
    child_context: ChildContext,
    depth: usize,
    state: &mut ValidationState,
) -> Result<(), RichContentError> {
    if !has_only_keys(object, &["type", "content"]) {
        return Err(RichContentError);
    }
    validate_children(object, child_context, depth, state)
}

fn validate_children(
    object: &serde_json::Map<String, Value>,
    child_context: ChildContext,
    depth: usize,
    state: &mut ValidationState,
) -> Result<(), RichContentError> {
    let Some(content) = object.get("content") else {
        return Ok(());
    };
    let content = content.as_array().ok_or(RichContentError)?;
    for child in content {
        validate_node(child, child_context, depth + 1, state)?;
    }
    Ok(())
}

fn validate_code_children(
    object: &serde_json::Map<String, Value>,
    depth: usize,
    state: &mut ValidationState,
) -> Result<(), RichContentError> {
    let Some(content) = object.get("content") else {
        return Ok(());
    };
    let content = content.as_array().ok_or(RichContentError)?;
    for child in content {
        let child_object = child.as_object().ok_or(RichContentError)?;
        if child_object.get("type").and_then(Value::as_str) != Some("text")
            || child_object.contains_key("marks")
        {
            return Err(RichContentError);
        }
        validate_node(child, ChildContext::Inline, depth + 1, state)?;
    }
    Ok(())
}

fn validate_text(
    object: &serde_json::Map<String, Value>,
    context: ChildContext,
) -> Result<(), RichContentError> {
    require_context(context, &[ChildContext::Inline])?;
    if !has_only_keys(object, &["type", "text", "marks"]) {
        return Err(RichContentError);
    }
    let text = object
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or(RichContentError)?;
    if text.chars().any(disallowed_content_control) {
        return Err(RichContentError);
    }
    let Some(marks) = object.get("marks") else {
        return Ok(());
    };
    let marks = marks.as_array().ok_or(RichContentError)?;
    if marks.len() > 5 {
        return Err(RichContentError);
    }
    let mut mark_types = Vec::with_capacity(marks.len());
    for mark in marks {
        let mark = mark.as_object().ok_or(RichContentError)?;
        let mark_type = mark
            .get("type")
            .and_then(Value::as_str)
            .ok_or(RichContentError)?;
        if mark_types.contains(&mark_type) {
            return Err(RichContentError);
        }
        mark_types.push(mark_type);
        match mark_type {
            "bold" | "italic" | "strike" | "code" => {
                if !has_only_keys(mark, &["type"]) {
                    return Err(RichContentError);
                }
            }
            "link" => validate_link_mark(mark)?,
            _ => return Err(RichContentError),
        }
    }
    Ok(())
}

fn validate_link_mark(mark: &serde_json::Map<String, Value>) -> Result<(), RichContentError> {
    if !has_only_keys(mark, &["type", "attrs"]) {
        return Err(RichContentError);
    }
    let attrs = mark
        .get("attrs")
        .and_then(Value::as_object)
        .ok_or(RichContentError)?;
    if !has_only_keys(attrs, &["href"]) {
        return Err(RichContentError);
    }
    let href = attrs
        .get("href")
        .and_then(Value::as_str)
        .filter(|href| (1..=2_048).contains(&href.len()))
        .ok_or(RichContentError)?;
    if href.starts_with('/') && !href.starts_with("//") && !href.chars().any(char::is_control) {
        return Ok(());
    }
    let url = Url::parse(href).map_err(|_| RichContentError)?;
    if matches!(url.scheme(), "http" | "https") {
        Ok(())
    } else {
        Err(RichContentError)
    }
}

fn has_only_keys(object: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

fn require_context(actual: ChildContext, allowed: &[ChildContext]) -> Result<(), RichContentError> {
    let matches = allowed.iter().any(|expected| {
        matches!(
            (actual, *expected),
            (ChildContext::Block, ChildContext::Block)
                | (ChildContext::Inline, ChildContext::Inline)
                | (ChildContext::ListItem, ChildContext::ListItem)
        )
    });
    if matches {
        Ok(())
    } else {
        Err(RichContentError)
    }
}

fn project_plain_text(document: &Value) -> String {
    let mut output = String::new();
    project_node(document, &mut output);
    output.trim().to_owned()
}

fn project_node(value: &Value, output: &mut String) {
    let Some(object) = value.as_object() else {
        return;
    };
    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if node_type == "text" {
        if let Some(text) = object.get("text").and_then(Value::as_str) {
            output.push_str(text);
        }
        return;
    }
    if node_type == "hardBreak" {
        push_newline(output);
        return;
    }
    if node_type == "replyGate"
        && object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("locked"))
            .and_then(Value::as_bool)
            == Some(true)
    {
        output.push_str("回复主题后可见");
        push_newline(output);
        return;
    }
    if let Some(content) = object.get("content").and_then(Value::as_array) {
        for child in content {
            project_node(child, output);
        }
    }
    if matches!(
        node_type,
        "paragraph"
            | "heading"
            | "blockquote"
            | "replyGate"
            | "listItem"
            | "codeBlock"
            | "horizontalRule"
    ) {
        push_newline(output);
    }
}

fn redact_reply_gate_node(value: &mut Value, unlocked: bool, has_locked_content: &mut bool) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if object.get("type").and_then(Value::as_str) == Some("replyGate") {
        *has_locked_content = true;
        if !unlocked {
            *value = serde_json::json!({
                "type": "replyGate",
                "attrs": { "locked": true }
            });
            return;
        }
    }
    if let Some(content) = object.get_mut("content").and_then(Value::as_array_mut) {
        for child in content {
            redact_reply_gate_node(child, unlocked, has_locked_content);
        }
    }
}

fn push_newline(output: &mut String) {
    if !output.ends_with('\n') {
        output.push('\n');
    }
}

fn disallowed_content_control(character: char) -> bool {
    character.is_control() && !matches!(character, '\n' | '\r' | '\t')
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{redact_reply_gates, validate_and_project};

    #[test]
    fn reply_gate_redaction_never_returns_hidden_text_to_locked_viewers() {
        let document = json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "公开开头" }]
                },
                {
                    "type": "replyGate",
                    "content": [{
                        "type": "paragraph",
                        "content": [{ "type": "text", "text": "隐藏答案 42" }]
                    }]
                }
            ]
        });
        let (validated, projected) = validate_and_project(document.clone(), 100).unwrap();
        assert_eq!(projected, "公开开头\n隐藏答案 42");

        let locked = redact_reply_gates(validated.clone(), false);
        assert!(locked.has_locked_content);
        assert_eq!(locked.plain_text, "公开开头\n回复主题后可见");
        assert!(!locked.document.to_string().contains("隐藏答案 42"));
        assert_eq!(
            locked.document["content"][1],
            json!({ "type": "replyGate", "attrs": { "locked": true } })
        );

        let unlocked = redact_reply_gates(validated.clone(), true);
        assert!(unlocked.has_locked_content);
        assert_eq!(unlocked.plain_text, "公开开头\n隐藏答案 42");
        assert_eq!(unlocked.document, validated);
    }

    #[test]
    fn accepts_supported_tiptap_json_and_projects_plain_text() {
        let document = json!({
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": { "level": 2 },
                    "content": [{ "type": "text", "text": "欢迎" }]
                },
                {
                    "type": "paragraph",
                    "content": [
                        { "type": "text", "text": "阅读" },
                        { "type": "hardBreak" },
                        {
                            "type": "text",
                            "text": "文档",
                            "marks": [{ "type": "link", "attrs": { "href": "https://example.com" } }]
                        }
                    ]
                }
            ]
        });

        let (validated, text) = validate_and_project(document.clone(), 100).unwrap();

        assert_eq!(validated, document);
        assert_eq!(text, "欢迎\n阅读\n文档");
    }

    #[test]
    fn rejects_unknown_nodes_unsafe_links_and_excessive_depth() {
        let unknown = json!({
            "type": "doc",
            "content": [{ "type": "image", "attrs": { "src": "https://example.com/x.png" } }]
        });
        let unsafe_link = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": "危险",
                    "marks": [{ "type": "link", "attrs": { "href": "javascript:alert(1)" } }]
                }]
            }]
        });
        let mut deep = json!({ "type": "paragraph" });
        for _ in 0..34 {
            deep = json!({ "type": "blockquote", "content": [deep] });
        }
        let deep = json!({ "type": "doc", "content": [deep] });

        assert!(validate_and_project(unknown, 100).is_err());
        assert!(validate_and_project(unsafe_link, 100).is_err());
        assert!(validate_and_project(deep, 100).is_err());
    }

    #[test]
    fn accepts_private_attachment_images_but_rejects_external_sources() {
        let attachment_id = "0198d874-e991-7b62-8b38-3986f55c8d3d";
        let document = json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "配图说明" }]
                },
                {
                    "type": "image",
                    "attrs": { "attachmentId": attachment_id, "alt": "配图" }
                }
            ]
        });
        let external = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "正文" }] },
                { "type": "image", "attrs": { "src": "https://example.com/x.png" } }
            ]
        });

        let (validated, text) = validate_and_project(document.clone(), 100).unwrap();
        assert_eq!(validated, document);
        assert_eq!(text, "配图说明");
        assert!(validate_and_project(external, 100).is_err());
    }

    #[test]
    fn accepts_safe_image_dimensions_and_rejects_invalid_dimensions() {
        let attachment_id = "0198d874-e991-7b62-8b38-3986f55c8d3d";
        let resized = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "正文" }] },
                {
                    "type": "image",
                    "attrs": {
                        "attachmentId": attachment_id,
                        "alt": "缩放图",
                        "width": 640,
                        "height": 360
                    }
                }
            ]
        });
        let invalid = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "正文" }] },
                {
                    "type": "image",
                    "attrs": {
                        "attachmentId": attachment_id,
                        "alt": "非法尺寸",
                        "width": "100%",
                        "height": -1
                    }
                }
            ]
        });

        assert!(validate_and_project(resized, 100).is_ok());
        assert!(validate_and_project(invalid, 100).is_err());
    }

    #[test]
    fn rejects_empty_and_oversized_plain_text() {
        let empty = json!({ "type": "doc", "content": [{ "type": "paragraph" }] });
        let oversized = json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "四个字符" }] }]
        });

        assert!(validate_and_project(empty, 100).is_err());
        assert!(validate_and_project(oversized, 3).is_err());
    }
}
