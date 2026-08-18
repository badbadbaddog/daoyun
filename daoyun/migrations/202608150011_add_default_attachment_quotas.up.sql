INSERT INTO community_group_quota_rules (group_id, quota_key, quota_value)
SELECT groups.id, quotas.quota_key, quotas.quota_value
FROM community_groups AS groups
JOIN (
    VALUES
        ('registered_member', 'attachment.storage.bytes', 104857600::bigint),
        ('registered_member', 'attachment.download.bytes.daily', 104857600::bigint),
        ('established_member', 'attachment.storage.bytes', 1073741824::bigint),
        ('established_member', 'attachment.download.bytes.daily', 536870912::bigint)
) AS quotas(group_key, quota_key, quota_value)
    ON groups.internal_key = quotas.group_key
ON CONFLICT (group_id, quota_key) DO NOTHING;

