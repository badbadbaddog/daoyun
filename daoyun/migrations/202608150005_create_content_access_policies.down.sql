DROP FUNCTION IF EXISTS daoyun_can_access_content(text, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS daoyun_content_target_board(text, uuid);

DROP TABLE IF EXISTS content_access_policy_subjects;
DROP TABLE IF EXISTS content_access_policies;

DELETE FROM permissions
WHERE permission_key IN (
    'content.access_policies.read',
    'content.access_policies.write'
);
