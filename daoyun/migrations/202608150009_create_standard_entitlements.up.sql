CREATE OR REPLACE FUNCTION daoyun_valid_standard_entitlement_quotas(candidate jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    quota_key text;
    quota_value jsonb;
BEGIN
    IF jsonb_typeof(candidate) <> 'object' THEN
        RETURN FALSE;
    END IF;
    FOR quota_key, quota_value IN SELECT key, value FROM jsonb_each(candidate)
    LOOP
        IF quota_key NOT IN (
            'topic.create.daily',
            'reply.create.daily',
            'message.send.daily',
            'attachment.upload.daily',
            'attachment.file.bytes',
            'attachment.storage.bytes',
            'attachment.download.bytes.daily',
            'content.external_link.daily'
        ) OR jsonb_typeof(quota_value) <> 'number'
          OR quota_value::text !~ '^[0-9]+$'
          OR (quota_value::text)::numeric > 9223372036854775807
        THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;

CREATE TABLE standard_entitlement_types (
    id uuid PRIMARY KEY,
    internal_key varchar(64) NOT NULL UNIQUE,
    display_name varchar(80) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    current_version integer NOT NULL DEFAULT 1,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT standard_entitlement_types_key_valid
        CHECK (internal_key ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT standard_entitlement_types_name_valid
        CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80),
    CONSTRAINT standard_entitlement_types_status_valid
        CHECK (status IN ('active', 'disabled', 'archived')),
    CONSTRAINT standard_entitlement_types_version_positive CHECK (current_version > 0),
    CONSTRAINT standard_entitlement_types_revision_positive CHECK (revision > 0)
);

CREATE TABLE standard_entitlement_versions (
    id uuid PRIMARY KEY,
    entitlement_type_id uuid NOT NULL REFERENCES standard_entitlement_types(id) ON DELETE RESTRICT,
    version integer NOT NULL,
    permission_keys varchar(80)[] NOT NULL DEFAULT '{}',
    quotas jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT standard_entitlement_versions_unique UNIQUE (entitlement_type_id, version),
    CONSTRAINT standard_entitlement_versions_version_positive CHECK (version > 0),
    CONSTRAINT standard_entitlement_versions_permissions_valid CHECK (
        permission_keys <@ ARRAY[
            'board.read', 'topic.read', 'topic.create', 'reply.create', 'message.send',
            'attachment.upload', 'attachment.download', 'topic.poll.create',
            'topic.bounty.create', 'topic.lottery.join', 'content.external_link.use',
            'profile.signature.use', 'content.pre_moderation.required'
        ]::varchar[]
    ),
    CONSTRAINT standard_entitlement_versions_quotas_valid
        CHECK (daoyun_valid_standard_entitlement_quotas(quotas))
);

CREATE TABLE user_standard_entitlements (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entitlement_type_id uuid NOT NULL REFERENCES standard_entitlement_types(id) ON DELETE RESTRICT,
    entitlement_key varchar(64) NOT NULL,
    type_version integer NOT NULL,
    permission_snapshot varchar(80)[] NOT NULL DEFAULT '{}',
    quota_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    source varchar(64) NOT NULL,
    source_reference_id varchar(128),
    reason varchar(200) NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    revoked_at timestamptz,
    revoked_by uuid REFERENCES users(id),
    revocation_reason varchar(200),
    idempotency_key varchar(128) NOT NULL,
    revoke_idempotency_key varchar(128),
    revision bigint NOT NULL DEFAULT 1,
    granted_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_standard_entitlements_idempotency_unique UNIQUE (user_id, idempotency_key),
    CONSTRAINT user_standard_entitlements_window_valid CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT user_standard_entitlements_permissions_valid CHECK (
        permission_snapshot <@ ARRAY[
            'board.read', 'topic.read', 'topic.create', 'reply.create', 'message.send',
            'attachment.upload', 'attachment.download', 'topic.poll.create',
            'topic.bounty.create', 'topic.lottery.join', 'content.external_link.use',
            'profile.signature.use', 'content.pre_moderation.required'
        ]::varchar[]
    ),
    CONSTRAINT user_standard_entitlements_quotas_valid
        CHECK (daoyun_valid_standard_entitlement_quotas(quota_snapshot)),
    CONSTRAINT user_standard_entitlements_source_valid
        CHECK (source ~ '^[a-z][a-z0-9:_-]{1,63}$'),
    CONSTRAINT user_standard_entitlements_reference_valid
        CHECK (source_reference_id IS NULL OR char_length(source_reference_id) BETWEEN 1 AND 128),
    CONSTRAINT user_standard_entitlements_reason_valid
        CHECK (char_length(reason) BETWEEN 1 AND 200 AND reason !~ '[[:cntrl:]]'),
    CONSTRAINT user_standard_entitlements_revision_positive CHECK (revision > 0),
    CONSTRAINT user_standard_entitlements_revocation_consistent CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL AND revoke_idempotency_key IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL AND revoke_idempotency_key IS NOT NULL)
    )
);

CREATE INDEX user_standard_entitlements_active_lookup
    ON user_standard_entitlements (user_id, entitlement_key, starts_at, ends_at)
    WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION daoyun_can_access_content(
    requested_target_type text,
    requested_target_id uuid,
    viewer_user_id uuid,
    effective_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    WITH selected_policy AS (
        SELECT policy.id, policy.operator
        FROM content_access_policies AS policy
        WHERE policy.target_type = requested_target_type
          AND policy.target_id = requested_target_id
    ), subject_results AS (
        SELECT policy.id AS policy_id, policy.operator,
               CASE subject.subject_type
                   WHEN 'public' THEN TRUE
                   WHEN 'authenticated' THEN viewer_user_id IS NOT NULL AND EXISTS (
                       SELECT 1 FROM users AS account
                       WHERE account.id = viewer_user_id
                         AND account.status IN ('active', 'restricted')
                   )
                   WHEN 'community_group' THEN viewer_user_id IS NOT NULL AND EXISTS (
                       SELECT 1
                       FROM community_group_memberships AS membership
                       JOIN community_groups AS community_group
                         ON community_group.id = membership.group_id
                       JOIN users AS account ON account.id = membership.user_id
                       WHERE membership.user_id = viewer_user_id
                         AND membership.group_id = subject.community_group_id
                         AND membership.revoked_at IS NULL
                         AND membership.starts_at <= effective_at
                         AND (membership.ends_at IS NULL OR membership.ends_at > effective_at)
                         AND community_group.status = 'active'
                         AND account.status IN ('active', 'restricted')
                   )
                   WHEN 'governance' THEN viewer_user_id IS NOT NULL AND EXISTS (
                       SELECT 1
                       FROM role_assignments AS assignment
                       JOIN roles AS role ON role.id = assignment.role_id
                       JOIN role_permissions AS role_permission
                         ON role_permission.role_id = role.id
                       JOIN permissions AS permission
                         ON permission.id = role_permission.permission_id
                       JOIN users AS account ON account.id = assignment.user_id
                       WHERE assignment.user_id = viewer_user_id
                         AND permission.permission_key = subject.subject_key
                         AND account.status IN ('active', 'restricted')
                         AND (
                             (role.scope IN ('instance', 'site') AND assignment.scope_id IS NULL)
                             OR (
                                 role.scope = 'board'
                                 AND daoyun_board_scope_covers(
                                     assignment.scope_id,
                                     assignment.scope_mode,
                                     daoyun_content_target_board(
                                         requested_target_type,
                                         requested_target_id
                                     )
                                 )
                             )
                         )
                   )
                   WHEN 'entitlement' THEN viewer_user_id IS NOT NULL AND EXISTS (
                       SELECT 1
                       FROM user_standard_entitlements AS entitlement
                       JOIN users AS account ON account.id = entitlement.user_id
                       WHERE entitlement.user_id = viewer_user_id
                         AND entitlement.entitlement_key = subject.subject_key
                         AND entitlement.revoked_at IS NULL
                         AND entitlement.starts_at <= effective_at
                         AND (entitlement.ends_at IS NULL OR entitlement.ends_at > effective_at)
                         AND account.status IN ('active', 'restricted')
                   )
                   ELSE FALSE
               END AS matched
        FROM selected_policy AS policy
        JOIN content_access_policy_subjects AS subject ON subject.policy_id = policy.id
    )
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM selected_policy) THEN TRUE
        WHEN (SELECT operator FROM selected_policy) = 'any_of' THEN
            COALESCE((SELECT bool_or(matched) FROM subject_results), FALSE)
        ELSE COALESCE((SELECT bool_and(matched) FROM subject_results), FALSE)
    END
$$;

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (daoyun_uuid_v7(), 'entitlements.types.read', 'Read entitlement types', 'Read versioned standard entitlement types.'),
    (daoyun_uuid_v7(), 'entitlements.types.write', 'Write entitlement types', 'Publish standard entitlement type versions.'),
    (daoyun_uuid_v7(), 'entitlements.grants.read', 'Read user entitlements', 'Read user standard entitlement projections.'),
    (daoyun_uuid_v7(), 'entitlements.grants.write', 'Write user entitlements', 'Grant and revoke user standard entitlement projections.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'entitlements.types.read', 'entitlements.types.write',
      'entitlements.grants.read', 'entitlements.grants.write'
  )
ON CONFLICT DO NOTHING;
