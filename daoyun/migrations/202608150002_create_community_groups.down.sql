DROP TRIGGER IF EXISTS users_initialize_community_group_membership ON users;
DROP FUNCTION IF EXISTS initialize_community_group_membership_for_user();
DROP TABLE IF EXISTS community_group_memberships;
DROP TABLE IF EXISTS community_group_quota_rules;
DROP TABLE IF EXISTS community_group_permissions;
DROP TABLE IF EXISTS community_groups;
DROP FUNCTION IF EXISTS daoyun_uuid_v7();
