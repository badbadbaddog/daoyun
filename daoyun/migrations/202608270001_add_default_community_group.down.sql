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
    WHERE groups.internal_key = 'registered_member'
      AND groups.status = 'active'
      AND groups.is_base;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'active registered member community group is required';
    END IF;

    RETURN NEW;
END;
$$;

DROP INDEX community_groups_single_default_idx;

ALTER TABLE community_groups
    DROP CONSTRAINT community_groups_default_requires_active_base_check,
    DROP COLUMN is_default;
