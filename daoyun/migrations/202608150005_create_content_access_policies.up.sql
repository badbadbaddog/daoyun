CREATE TABLE content_access_policies (
    id uuid PRIMARY KEY DEFAULT daoyun_uuid_v7(),
    target_type varchar(16) NOT NULL,
    target_id uuid NOT NULL,
    operator varchar(8) NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT content_access_policies_target_type_valid CHECK (
        target_type IN ('board', 'topic', 'post', 'attachment')
    ),
    CONSTRAINT content_access_policies_operator_valid CHECK (operator IN ('any_of', 'all_of')),
    CONSTRAINT content_access_policies_revision_positive CHECK (revision > 0),
    CONSTRAINT content_access_policies_target_unique UNIQUE (target_type, target_id)
);

CREATE TABLE content_access_policy_subjects (
    id uuid PRIMARY KEY DEFAULT daoyun_uuid_v7(),
    policy_id uuid NOT NULL REFERENCES content_access_policies (id) ON DELETE CASCADE,
    subject_type varchar(24) NOT NULL,
    community_group_id uuid REFERENCES community_groups (id),
    subject_key varchar(128),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT content_access_policy_subjects_type_valid CHECK (
        subject_type IN (
            'public', 'authenticated', 'community_group', 'entitlement', 'governance'
        )
    ),
    CONSTRAINT content_access_policy_subjects_shape_valid CHECK (
        (subject_type IN ('public', 'authenticated')
            AND community_group_id IS NULL AND subject_key IS NULL)
        OR (subject_type = 'community_group'
            AND community_group_id IS NOT NULL AND subject_key IS NULL)
        OR (subject_type IN ('entitlement', 'governance')
            AND community_group_id IS NULL
            AND subject_key IS NOT NULL
            AND subject_key = btrim(subject_key)
            AND char_length(subject_key) BETWEEN 1 AND 128
            AND subject_key !~ '[[:cntrl:]]')
    )
);

CREATE UNIQUE INDEX content_access_policy_subjects_unique
    ON content_access_policy_subjects (
        policy_id,
        subject_type,
        COALESCE(community_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(subject_key, '')
    );

CREATE INDEX content_access_policy_subjects_group_index
    ON content_access_policy_subjects (community_group_id)
    WHERE community_group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION daoyun_content_target_board(
    requested_target_type text,
    requested_target_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT CASE requested_target_type
        WHEN 'board' THEN (
            SELECT board.id FROM boards AS board
            WHERE board.id = requested_target_id AND board.deleted_at IS NULL
        )
        WHEN 'topic' THEN (
            SELECT topic.board_id FROM topics AS topic
            WHERE topic.id = requested_target_id AND topic.deleted_at IS NULL
        )
        WHEN 'post' THEN (
            SELECT topic.board_id
            FROM posts AS post
            JOIN topics AS topic ON topic.id = post.topic_id
            WHERE post.id = requested_target_id
              AND post.deleted_at IS NULL AND topic.deleted_at IS NULL
        )
        WHEN 'attachment' THEN (
            SELECT topic.board_id
            FROM topic_attachments AS attachment
            JOIN topics AS topic ON topic.id = attachment.topic_id
            WHERE attachment.id = requested_target_id
              AND topic.deleted_at IS NULL
        )
        ELSE NULL
    END
$$;

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
                                 AND assignment.scope_id = daoyun_content_target_board(
                                     requested_target_type,
                                     requested_target_id
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

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (daoyun_uuid_v7(), 'content.access_policies.read', '读取内容访问策略', '查看内容访问策略及主体'),
    (daoyun_uuid_v7(), 'content.access_policies.write', '管理内容访问策略', '创建和修改内容访问策略')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'content.access_policies.read',
      'content.access_policies.write'
  )
ON CONFLICT DO NOTHING;
