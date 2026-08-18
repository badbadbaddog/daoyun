ALTER TABLE topics
    ADD COLUMN locked_at timestamptz,
    ADD COLUMN locked_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN governance_revision bigint NOT NULL DEFAULT 1;

ALTER TABLE topics
    ADD CONSTRAINT topics_governance_revision_positive CHECK (governance_revision > 0),
    ADD CONSTRAINT topics_lock_state_consistent CHECK (
        (locked_at IS NULL AND locked_by IS NULL)
        OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)
    );

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ('follow', 'reply', 'like', 'message', 'report', 'topic_governance'));

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (daoyun_uuid_v7(), 'moderation.topic.pin', 'Pin topics', 'Pin and unpin topics within an authorized board scope.'),
    (daoyun_uuid_v7(), 'moderation.topic.feature', 'Feature topics', 'Feature and unfeature topics within an authorized board scope.'),
    (daoyun_uuid_v7(), 'moderation.topic.lock', 'Lock topics', 'Lock and unlock topics within an authorized board scope.'),
    (daoyun_uuid_v7(), 'moderation.topic.move', 'Move topics', 'Move topics between authorized board scopes.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'moderation.topic.pin',
      'moderation.topic.feature',
      'moderation.topic.lock',
      'moderation.topic.move'
  )
ON CONFLICT DO NOTHING;

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
                   WHEN 'entitlement' THEN FALSE
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
