ALTER TABLE community_groups
    ADD COLUMN is_default boolean NOT NULL DEFAULT false;

UPDATE community_groups
SET is_default = true
WHERE internal_key = 'registered_member'
  AND is_base
  AND status = 'active';

ALTER TABLE community_groups
    ADD CONSTRAINT community_groups_default_requires_active_base_check
        CHECK (NOT is_default OR (is_base AND status = 'active'));

CREATE UNIQUE INDEX community_groups_single_default_idx
    ON community_groups (is_default)
    WHERE is_default;

CREATE OR REPLACE FUNCTION initialize_community_group_membership_for_user()
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
    WHERE groups.is_default
      AND groups.status = 'active'
      AND groups.is_base;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'active default community group is required';
    END IF;

    RETURN NEW;
END;
$$;
