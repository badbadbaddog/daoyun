ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
    daoyun_valid_plugin_string_set(capabilities, ARRAY[
        'content.transform', 'ui.panel', 'events.subscribe', 'core.query',
        'points.write', 'experience.write', 'entitlements.write', 'notifications.write',
        'storage.read_write', 'tasks.schedule', 'topic.supplements', 'topic.edit_review'
    ], 1, 16)
);

ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
    (business_api_version IS NULL AND data_scopes = '[]'::jsonb
        AND capabilities <@ '["content.transform", "ui.panel"]'::jsonb)
    OR (business_api_version = '0.1.0' AND NOT capabilities ? 'content.transform'
        AND capabilities ?| ARRAY['events.subscribe', 'core.query', 'points.write',
            'experience.write', 'entitlements.write', 'notifications.write',
            'storage.read_write', 'tasks.schedule', 'topic.supplements', 'topic.edit_review'])
);

CREATE UNIQUE INDEX plugins_one_topic_edit_review_provider
    ON plugins ((true)) WHERE capabilities ? 'topic.edit_review';

CREATE TABLE edit_review_policies (
    board_id uuid PRIMARY KEY REFERENCES boards(id),
    topic_edits_require_review boolean NOT NULL DEFAULT false,
    reply_edits_require_review boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_edit_reviews (
    id uuid PRIMARY KEY,
    board_id uuid NOT NULL REFERENCES boards(id),
    topic_id uuid NOT NULL REFERENCES topics(id),
    post_id uuid NOT NULL REFERENCES posts(id),
    target_type varchar(16) NOT NULL CHECK (target_type IN ('topic', 'reply')),
    editor_id uuid NOT NULL REFERENCES users(id),
    base_revision integer NOT NULL CHECK (base_revision > 0),
    proposed_title text,
    proposed_excerpt text,
    proposed_content text,
    content_changed boolean NOT NULL DEFAULT false,
    proposed_rich_content jsonb,
    proposed_tags jsonb,
    status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    reviewer_id uuid REFERENCES users(id),
    review_reason text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX content_edit_reviews_one_pending_post
    ON content_edit_reviews(post_id) WHERE status = 'pending';
CREATE INDEX content_edit_reviews_board_queue
    ON content_edit_reviews(board_id, status, created_at, id);
