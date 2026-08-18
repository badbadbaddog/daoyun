CREATE FUNCTION daoyun_uuid_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    timestamp_hex text;
    random_hex text;
    variant_hex text;
BEGIN
    timestamp_hex := lpad(
        to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint),
        12,
        '0'
    );
    random_hex := md5(random()::text || clock_timestamp()::text);
    variant_hex := to_hex(8 + floor(random() * 4)::integer);
    RETURN (
        substr(timestamp_hex, 1, 8) || '-' ||
        substr(timestamp_hex, 9, 4) || '-' ||
        '7' || substr(random_hex, 1, 3) || '-' ||
        variant_hex || substr(random_hex, 4, 3) || '-' ||
        substr(random_hex, 7, 12)
    )::uuid;
END;
$$;

CREATE TABLE community_groups (
    id uuid PRIMARY KEY,
    internal_key varchar(64) NOT NULL UNIQUE,
    display_name varchar(80) NOT NULL,
    description text NOT NULL DEFAULT '',
    is_base boolean NOT NULL DEFAULT false,
    status varchar(16) NOT NULL DEFAULT 'active',
    display_order integer NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT community_groups_internal_key_check
        CHECK (internal_key ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT community_groups_display_name_check
        CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80),
    CONSTRAINT community_groups_description_check CHECK (char_length(description) <= 500),
    CONSTRAINT community_groups_status_check CHECK (status IN ('active', 'disabled', 'archived')),
    CONSTRAINT community_groups_display_order_check CHECK (display_order > 0),
    CONSTRAINT community_groups_revision_check CHECK (revision > 0)
);

CREATE UNIQUE INDEX community_groups_display_order_active_idx
    ON community_groups (display_order)
    WHERE status <> 'archived';

INSERT INTO community_groups (
    id, internal_key, display_name, description, is_base, status, display_order
) VALUES
    ('01a001a0-1001-7001-8001-000000000001', 'registered_member', '注册会员', '注册成功后自动加入的基础社区用户组。', true, 'active', 1),
    ('01a001a0-1002-7002-8002-000000000002', 'established_member', '正式会员', '可使用私信、附件和部分社区活动。', false, 'active', 2),
    ('01a001a0-1003-7003-8003-000000000003', 'verified_author', '认证作者', '面向认证创作者的附加用户组。', false, 'active', 3),
    ('01a001a0-1004-7004-8004-000000000004', 'internal_member', '内部成员', '面向内部板块和资源的附加用户组。', false, 'active', 4),
    ('01a001a0-1005-7005-8005-000000000005', 'partner', '合作伙伴', '面向限时合作关系的附加用户组。', false, 'active', 5);

CREATE TABLE community_group_permissions (
    group_id uuid NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
    permission_key varchar(80) NOT NULL,
    allowed boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, permission_key),
    CONSTRAINT community_group_permissions_key_check
        CHECK (permission_key ~ '^[a-z][a-z0-9_.]{2,79}$'),
    CONSTRAINT community_group_permissions_allow_only_check CHECK (allowed)
);

CREATE INDEX community_group_permissions_key_idx
    ON community_group_permissions (permission_key, group_id);

INSERT INTO community_group_permissions (group_id, permission_key)
SELECT groups.id, permissions.permission_key
FROM community_groups AS groups
JOIN (
    VALUES
        ('registered_member', 'board.read'),
        ('registered_member', 'topic.read'),
        ('registered_member', 'topic.create'),
        ('registered_member', 'reply.create'),
        ('registered_member', 'message.send'),
        ('registered_member', 'attachment.upload'),
        ('registered_member', 'attachment.download'),
        ('established_member', 'message.send'),
        ('established_member', 'attachment.upload'),
        ('established_member', 'attachment.download'),
        ('verified_author', 'content.external_link.use'),
        ('verified_author', 'profile.signature.use'),
        ('verified_author', 'topic.poll.create'),
        ('verified_author', 'topic.bounty.create'),
        ('partner', 'attachment.download')
) AS permissions(group_key, permission_key)
    ON groups.internal_key = permissions.group_key;

CREATE TABLE community_group_quota_rules (
    group_id uuid NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
    quota_key varchar(80) NOT NULL,
    quota_value bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, quota_key),
    CONSTRAINT community_group_quota_rules_key_check
        CHECK (quota_key ~ '^[a-z][a-z0-9_.]{2,79}$'),
    CONSTRAINT community_group_quota_rules_value_check CHECK (quota_value >= 0)
);

CREATE INDEX community_group_quota_rules_key_idx
    ON community_group_quota_rules (quota_key, group_id);

INSERT INTO community_group_quota_rules (group_id, quota_key, quota_value)
SELECT groups.id, quotas.quota_key, quotas.quota_value
FROM community_groups AS groups
JOIN (
    VALUES
        ('registered_member', 'topic.create.daily', 10::bigint),
        ('registered_member', 'reply.create.daily', 50::bigint),
        ('registered_member', 'message.send.daily', 30::bigint),
        ('registered_member', 'attachment.upload.daily', 5::bigint),
        ('registered_member', 'attachment.file.bytes', 5242880::bigint),
        ('established_member', 'topic.create.daily', 20::bigint),
        ('established_member', 'reply.create.daily', 100::bigint),
        ('established_member', 'message.send.daily', 30::bigint),
        ('established_member', 'attachment.upload.daily', 20::bigint),
        ('established_member', 'attachment.file.bytes', 10485760::bigint),
        ('verified_author', 'topic.create.daily', 50::bigint),
        ('verified_author', 'content.external_link.daily', 100::bigint),
        ('partner', 'attachment.download.bytes.daily', 1073741824::bigint)
) AS quotas(group_key, quota_key, quota_value)
    ON groups.internal_key = quotas.group_key;

CREATE TABLE community_group_memberships (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES community_groups(id) ON DELETE RESTRICT,
    membership_kind varchar(16) NOT NULL,
    source varchar(32) NOT NULL,
    source_reference_id uuid,
    reason varchar(200) NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    revoked_at timestamptz,
    revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    revocation_reason varchar(200),
    idempotency_key varchar(128) NOT NULL,
    revoke_idempotency_key varchar(128),
    revision bigint NOT NULL DEFAULT 1,
    granted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT community_group_memberships_kind_check
        CHECK (membership_kind IN ('base', 'additional')),
    CONSTRAINT community_group_memberships_source_check
        CHECK (source ~ '^[a-z][a-z0-9_.]{2,31}$'),
    CONSTRAINT community_group_memberships_reason_check
        CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 3 AND 200),
    CONSTRAINT community_group_memberships_time_check
        CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT community_group_memberships_revocation_check
        CHECK (
            (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL AND revoke_idempotency_key IS NULL)
            OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revoke_idempotency_key IS NOT NULL)
        ),
    CONSTRAINT community_group_memberships_revocation_reason_check
        CHECK (
            revocation_reason IS NULL
            OR (revocation_reason = btrim(revocation_reason) AND char_length(revocation_reason) BETWEEN 3 AND 200)
        ),
    CONSTRAINT community_group_memberships_idempotency_key_check
        CHECK (idempotency_key ~ '^[!-~]{1,128}$'),
    CONSTRAINT community_group_memberships_revoke_idempotency_key_check
        CHECK (revoke_idempotency_key IS NULL OR revoke_idempotency_key ~ '^[!-~]{1,128}$'),
    CONSTRAINT community_group_memberships_revision_check CHECK (revision > 0),
    CONSTRAINT community_group_memberships_user_idempotency_key
        UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX community_group_memberships_unrevoked_base_idx
    ON community_group_memberships (user_id)
    WHERE membership_kind = 'base' AND revoked_at IS NULL;

CREATE INDEX community_group_memberships_active_user_idx
    ON community_group_memberships (user_id, starts_at, ends_at, group_id)
    WHERE revoked_at IS NULL;

CREATE INDEX community_group_memberships_group_idx
    ON community_group_memberships (group_id, user_id, starts_at)
    WHERE revoked_at IS NULL;

INSERT INTO community_group_memberships (
    id, user_id, group_id, membership_kind, source, reason, idempotency_key,
    starts_at, created_at, updated_at
)
SELECT
    daoyun_uuid_v7(),
    users.id,
    groups.id,
    'base',
    'schema_backfill',
    'Membership V2 community group backfill',
    'schema.community_groups.backfill',
    users.created_at,
    users.created_at,
    users.created_at
FROM users
CROSS JOIN community_groups AS groups
WHERE groups.internal_key = 'registered_member';

CREATE FUNCTION initialize_community_group_membership_for_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO community_group_memberships (
        id, user_id, group_id, membership_kind, source, reason, idempotency_key
    )
    SELECT
        daoyun_uuid_v7(),
        NEW.id,
        groups.id,
        'base',
        'account_creation',
        'Account creation base community membership',
        'account.creation.base_group'
    FROM community_groups AS groups
    WHERE groups.internal_key = 'registered_member'
      AND groups.status = 'active'
      AND groups.is_base;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'active registered member community group is required';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER users_initialize_community_group_membership
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION initialize_community_group_membership_for_user();
