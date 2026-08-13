DROP INDEX role_assignments_scope_index;
DROP INDEX role_assignments_user_role_scope_unique;

ALTER TABLE role_assignments
    DROP COLUMN scope_id;

ALTER TABLE role_assignments
    ADD CONSTRAINT role_assignments_user_role_unique UNIQUE (user_id, role_id);

DROP TABLE role_permissions;
DROP TABLE permissions;
