ALTER TABLE roles
    ADD COLUMN protection_level smallint NOT NULL DEFAULT 1;

ALTER TABLE roles
    ADD CONSTRAINT roles_protection_level_valid
        CHECK (protection_level BETWEEN 0 AND 1000);

UPDATE roles SET protection_level = 1000 WHERE key = 'super_admin';

CREATE TABLE board_user_restrictions (
    id uuid PRIMARY KEY,
    board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actions varchar(32)[] NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    reason varchar(1000) NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    updated_by uuid NOT NULL REFERENCES users(id),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT board_user_restrictions_board_user_unique UNIQUE (board_id, user_id),
    CONSTRAINT board_user_restrictions_actions_nonempty CHECK (cardinality(actions) > 0),
    CONSTRAINT board_user_restrictions_actions_valid CHECK (
        actions <@ ARRAY['topic.create', 'reply.create', 'attachment.upload']::varchar[]
    ),
    CONSTRAINT board_user_restrictions_window_valid CHECK (
        ends_at IS NULL OR ends_at > starts_at
    ),
    CONSTRAINT board_user_restrictions_reason_valid CHECK (
        char_length(reason) BETWEEN 1 AND 1000 AND reason !~ '[[:cntrl:]]'
    ),
    CONSTRAINT board_user_restrictions_revision_positive CHECK (revision > 0)
);

CREATE INDEX board_user_restrictions_effective_lookup
    ON board_user_restrictions (user_id, board_id, starts_at, ends_at);

INSERT INTO permissions (id, permission_key, name, description)
VALUES (
    daoyun_uuid_v7(),
    'moderation.user.restrict_in_scope',
    'Restrict users in board scope',
    'Create and update temporary user posting restrictions in an authorized board scope.'
)
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key = 'moderation.user.restrict_in_scope'
ON CONFLICT DO NOTHING;
