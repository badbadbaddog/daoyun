CREATE TABLE member_drafts (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>0), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2097152),
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at timestamptz
);
CREATE INDEX member_drafts_owner ON member_drafts(owner_id,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE member_draft_attachments (
 draft_id uuid NOT NULL REFERENCES member_drafts(id) ON DELETE CASCADE,
 attachment_id uuid NOT NULL REFERENCES topic_attachments(id) ON DELETE CASCADE,
 PRIMARY KEY(draft_id,attachment_id)
);
CREATE INDEX member_draft_attachments_attachment ON member_draft_attachments(attachment_id);
