use infrastructure::{
    CreateAuthorizationAssignmentRecord, CreateAuthorizationRoleRecord, Database,
    InstallationAdministrator, MutateAuthorizationAssignmentError, MutateAuthorizationRoleError,
    NewUserRecord, UpdateAuthorizationRoleRecord, permission_keys,
};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn capability_checks_apply_roles_scopes_and_user_status(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must grant administrator capabilities");

    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("default board must exist");
    assert!(
        database
            .has_permission(
                administrator_id,
                permission_keys::ADMIN_CONFIGURATION_READ,
                None,
            )
            .await
            .expect("administrator read capability must be queryable")
    );
    assert!(
        database
            .has_permission(
                administrator_id,
                permission_keys::MODERATION_TOPIC,
                Some(board_id),
            )
            .await
            .expect("administrator moderation capability must be queryable")
    );

    let member_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: member_id,
            username: "moderator".to_owned(),
            email: "moderator@example.com".to_owned(),
            display_name: "Moderator".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("moderator user must be creatable");

    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system)
         VALUES ($1, 'board_moderator', 'Board moderator', 'board', FALSE)",
    )
    .bind(Uuid::now_v7())
    .execute(&pool)
    .await
    .expect("scoped role must be insertable");
    let role_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM roles WHERE key = 'board_moderator'")
            .fetch_one(&pool)
            .await
            .expect("scoped role must be queryable");
    let permission_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM permissions WHERE permission_key = $1")
            .bind(permission_keys::MODERATION_TOPIC)
            .fetch_one(&pool)
            .await
            .expect("moderation permission must be seeded");
    sqlx::query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)")
        .bind(role_id)
        .bind(permission_id)
        .execute(&pool)
        .await
        .expect("role capability must be grantable");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::now_v7())
    .bind(member_id)
    .bind(role_id)
    .bind(administrator_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("scoped role assignment must be insertable");

    assert!(
        database
            .has_permission(member_id, permission_keys::MODERATION_TOPIC, Some(board_id),)
            .await
            .expect("scoped capability must be queryable")
    );
    assert!(
        !database
            .has_permission(
                member_id,
                permission_keys::MODERATION_TOPIC,
                Some(Uuid::now_v7()),
            )
            .await
            .expect("other-board capability must be queryable")
    );

    let child_board_id = Uuid::now_v7();
    let other_root_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO boards (
            id, slug, name, description, icon, tone, position, visibility, parent_id
         ) VALUES
            ($1, 'scope-child', 'Scope child', '', 'messages-square', 'blue', 1, 'public', $3),
            ($2, 'scope-other', 'Scope other', '', 'messages-square', 'blue', 91, 'public', NULL)",
    )
    .bind(child_board_id)
    .bind(other_root_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("scope boards must insert");
    assert!(
        !database
            .has_permission(
                member_id,
                permission_keys::MODERATION_TOPIC,
                Some(child_board_id),
            )
            .await
            .expect("exact scope must not cover descendants")
    );
    sqlx::query(
        "UPDATE role_assignments SET scope_mode = 'subtree'
         WHERE user_id = $1 AND role_id = $2 AND scope_id = $3",
    )
    .bind(member_id)
    .bind(role_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("assignment must become subtree-scoped");
    assert!(
        database
            .has_permission(
                member_id,
                permission_keys::MODERATION_TOPIC,
                Some(child_board_id),
            )
            .await
            .expect("subtree scope must cover descendants")
    );
    sqlx::query("UPDATE boards SET parent_id = $2 WHERE id = $1")
        .bind(child_board_id)
        .bind(other_root_id)
        .execute(&pool)
        .await
        .expect("child board must move to another subtree");
    assert!(
        !database
            .has_permission(
                member_id,
                permission_keys::MODERATION_TOPIC,
                Some(child_board_id),
            )
            .await
            .expect("subtree scope must follow the current board tree")
    );
    assert!(
        !database
            .has_permission(member_id, permission_keys::MODERATION_TOPIC, None)
            .await
            .expect("unscoped capability must be queryable")
    );

    sqlx::query("UPDATE users SET status = 'restricted' WHERE id = $1")
        .bind(member_id)
        .execute(&pool)
        .await
        .expect("member restriction fixture must update");
    assert!(
        database
            .has_permission(member_id, permission_keys::MODERATION_TOPIC, Some(board_id),)
            .await
            .expect("restricted capability must remain queryable")
    );

    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(member_id)
        .execute(&pool)
        .await
        .expect("member status must be mutable in the fixture");
    assert!(
        !database
            .has_permission(member_id, permission_keys::MODERATION_TOPIC, Some(board_id),)
            .await
            .expect("suspended capability must be queryable")
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn authorization_catalog_lists_permissions_roles_and_scoped_assignments(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "owner".to_owned(),
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must initialize");

    let member_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: member_id,
            username: "moderator".to_owned(),
            email: "moderator@example.com".to_owned(),
            display_name: "Moderator".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("moderator user must be creatable");
    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("default board must exist");
    let role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system) \
         VALUES ($1, 'board_moderator', 'Board moderator', 'board', FALSE)",
    )
    .bind(role_id)
    .execute(&pool)
    .await
    .expect("custom role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id) \
         SELECT $1, id FROM permissions WHERE permission_key = $2",
    )
    .bind(role_id)
    .bind(permission_keys::MODERATION_TOPIC)
    .execute(&pool)
    .await
    .expect("custom role permission must insert");
    let assignment_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(assignment_id)
    .bind(member_id)
    .bind(role_id)
    .bind(administrator_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("board assignment must insert");

    let permissions = database
        .list_authorization_permissions()
        .await
        .expect("permission catalog must load");
    assert!(permissions.windows(2).all(|pair| pair[0].key < pair[1].key));
    assert!(
        permissions
            .iter()
            .any(|permission| permission.key == permission_keys::AUTHORIZATION_ROLES_READ)
    );

    let roles = database
        .list_authorization_roles()
        .await
        .expect("role catalog must load");
    let moderator = roles
        .iter()
        .find(|role| role.id == role_id)
        .expect("custom role must be listed");
    assert_eq!(moderator.key, "board_moderator");
    assert_eq!(moderator.scope, "board");
    assert!(!moderator.is_system);
    assert_eq!(moderator.permission_keys, vec!["moderation.topic"]);
    assert_eq!(moderator.assignment_count, 1);
    assert_eq!(moderator.revision, 1);

    let assignments = database
        .list_authorization_role_assignments(
            Some("moderator"),
            Some(role_id),
            Some(board_id),
            None,
            2,
        )
        .await
        .expect("role assignments must load");
    assert_eq!(assignments.len(), 1);
    assert_eq!(assignments[0].id, assignment_id);
    assert_eq!(assignments[0].user_username, "moderator");
    assert_eq!(assignments[0].role_key, "board_moderator");
    assert_eq!(assignments[0].scope_id, Some(board_id));
    assert_eq!(assignments[0].assigned_by_username, "owner");

    let invalid_cursor = database
        .list_authorization_role_assignments(None, None, None, Some(Uuid::now_v7()), 2)
        .await;
    assert!(
        matches!(
            invalid_cursor,
            Err(infrastructure::ListAuthorizationAssignmentsError::InvalidCursor)
        ),
        "unknown assignment cursor must be rejected"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn custom_role_mutations_enforce_revision_system_and_in_use_boundaries(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "role_owner".to_owned(),
            email: "role_owner@example.com".to_owned(),
            display_name: "Role owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must initialize");
    let role_id = Uuid::now_v7();

    let created = database
        .create_authorization_role(
            administrator_id,
            CreateAuthorizationRoleRecord {
                id: role_id,
                key: "board_helper".to_owned(),
                name: "Board helper".to_owned(),
                scope: "board".to_owned(),
                permission_keys: vec![permission_keys::MODERATION_TOPIC.to_owned()],
            },
        )
        .await
        .expect("custom role must be creatable");
    assert_eq!(created.revision, 1);
    assert_eq!(created.permission_keys, vec!["moderation.topic"]);

    let updated = database
        .update_authorization_role(
            administrator_id,
            UpdateAuthorizationRoleRecord {
                role_id,
                name: "Board reviewer".to_owned(),
                permission_keys: vec![
                    permission_keys::GOVERNANCE_REPORTS_READ.to_owned(),
                    permission_keys::MODERATION_TOPIC.to_owned(),
                ],
                expected_revision: 1,
            },
        )
        .await
        .expect("custom role must be updatable");
    assert_eq!(updated.name, "Board reviewer");
    assert_eq!(updated.revision, 2);

    let stale = database
        .update_authorization_role(
            administrator_id,
            UpdateAuthorizationRoleRecord {
                role_id,
                name: "Stale update".to_owned(),
                permission_keys: vec![permission_keys::MODERATION_TOPIC.to_owned()],
                expected_revision: 1,
            },
        )
        .await;
    assert!(matches!(stale, Err(MutateAuthorizationRoleError::Conflict)));

    let system_role_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM roles WHERE key = 'super_admin'")
            .fetch_one(&pool)
            .await
            .expect("system role must exist");
    let system_update = database
        .update_authorization_role(
            administrator_id,
            UpdateAuthorizationRoleRecord {
                role_id: system_role_id,
                name: "Changed root".to_owned(),
                permission_keys: vec![permission_keys::AUTHORIZATION_ROLES_READ.to_owned()],
                expected_revision: 1,
            },
        )
        .await;
    assert!(matches!(
        system_update,
        Err(MutateAuthorizationRoleError::SystemManaged)
    ));

    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("default board must exist");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by, scope_id) \
         VALUES ($1, $2, $3, $2, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(administrator_id)
    .bind(role_id)
    .bind(board_id)
    .execute(&pool)
    .await
    .expect("role assignment fixture must insert");
    let in_use = database
        .delete_authorization_role(administrator_id, role_id)
        .await;
    assert!(matches!(in_use, Err(MutateAuthorizationRoleError::InUse)));
    sqlx::query("DELETE FROM role_assignments WHERE role_id = $1")
        .bind(role_id)
        .execute(&pool)
        .await
        .expect("role assignment fixture must delete");
    database
        .delete_authorization_role(administrator_id, role_id)
        .await
        .expect("unused custom role must delete");

    let audit_actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM admin_audit_log \
         WHERE resource_id = $1 ORDER BY created_at, id",
    )
    .bind(role_id)
    .fetch_all(&pool)
    .await
    .expect("role audit actions must load");
    assert_eq!(
        audit_actions,
        vec![
            "authorization.role.create",
            "authorization.role.update",
            "authorization.role.delete",
        ]
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn delegated_role_manager_cannot_grant_capabilities_it_does_not_hold(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "root_owner".to_owned(),
            email: "root_owner@example.com".to_owned(),
            display_name: "Root owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must initialize");
    let manager_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: manager_id,
            username: "role_manager".to_owned(),
            email: "role_manager@example.com".to_owned(),
            display_name: "Role manager".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("role manager must register");
    let manager_role_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO roles (id, key, name, scope, is_system) \
         VALUES ($1, 'limited_role_manager', 'Limited role manager', 'instance', FALSE)",
    )
    .bind(manager_role_id)
    .execute(&pool)
    .await
    .expect("manager role must insert");
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id) \
         SELECT $1, id FROM permissions WHERE permission_key IN ($2, $3)",
    )
    .bind(manager_role_id)
    .bind(permission_keys::AUTHORIZATION_ROLES_READ)
    .bind(permission_keys::AUTHORIZATION_ROLES_WRITE)
    .execute(&pool)
    .await
    .expect("manager capabilities must insert");
    sqlx::query(
        "INSERT INTO role_assignments (id, user_id, role_id, assigned_by) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(manager_id)
    .bind(manager_role_id)
    .bind(administrator_id)
    .execute(&pool)
    .await
    .expect("manager role assignment must insert");

    let escalation = database
        .create_authorization_role(
            manager_id,
            CreateAuthorizationRoleRecord {
                id: Uuid::now_v7(),
                key: "escalated_moderator".to_owned(),
                name: "Escalated moderator".to_owned(),
                scope: "board".to_owned(),
                permission_keys: vec![permission_keys::MODERATION_TOPIC.to_owned()],
            },
        )
        .await;
    assert!(matches!(
        escalation,
        Err(MutateAuthorizationRoleError::PermissionInvalid)
    ));
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn role_assignments_validate_users_scopes_duplicates_and_system_roles(pool: PgPool) {
    let database = Database::from_pool(pool.clone());
    let administrator_id = Uuid::now_v7();
    database
        .initialize_installation(InstallationAdministrator {
            id: administrator_id,
            username: "assignment_owner".to_owned(),
            email: "assignment_owner@example.com".to_owned(),
            display_name: "Assignment owner".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("installation must initialize");
    let member_id = Uuid::now_v7();
    database
        .register_user(NewUserRecord {
            id: member_id,
            username: "assigned_member".to_owned(),
            email: "assigned_member@example.com".to_owned(),
            display_name: "Assigned member".to_owned(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".to_owned(),
        })
        .await
        .expect("member must register");
    let role = database
        .create_authorization_role(
            administrator_id,
            CreateAuthorizationRoleRecord {
                id: Uuid::now_v7(),
                key: "assignment_moderator".to_owned(),
                name: "Assignment moderator".to_owned(),
                scope: "board".to_owned(),
                permission_keys: vec![permission_keys::MODERATION_TOPIC.to_owned()],
            },
        )
        .await
        .expect("custom role must be created");
    let suspended_role = database
        .create_authorization_role(
            administrator_id,
            CreateAuthorizationRoleRecord {
                id: Uuid::now_v7(),
                key: "suspended_account_role".to_owned(),
                name: "Suspended account role".to_owned(),
                scope: "site".to_owned(),
                permission_keys: vec![permission_keys::MODERATION_TOPIC.to_owned()],
            },
        )
        .await
        .expect("second custom role must be created");
    let board_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(&pool)
        .await
        .expect("default board must exist");

    let assignment = database
        .create_authorization_assignment(
            administrator_id,
            CreateAuthorizationAssignmentRecord {
                id: Uuid::now_v7(),
                username: "assigned_member".to_owned(),
                role_id: role.id,
                scope_id: Some(board_id),
                scope_mode: "exact".to_owned(),
            },
        )
        .await
        .expect("custom role assignment must be created");
    assert_eq!(assignment.user_username, "assigned_member");
    assert_eq!(assignment.role_key, "assignment_moderator");
    assert_eq!(assignment.scope_id, Some(board_id));

    let duplicate = database
        .create_authorization_assignment(
            administrator_id,
            CreateAuthorizationAssignmentRecord {
                id: Uuid::now_v7(),
                username: "assigned_member".to_owned(),
                role_id: role.id,
                scope_id: Some(board_id),
                scope_mode: "exact".to_owned(),
            },
        )
        .await;
    assert!(matches!(
        duplicate,
        Err(MutateAuthorizationAssignmentError::Conflict)
    ));

    let wrong_scope = database
        .create_authorization_assignment(
            administrator_id,
            CreateAuthorizationAssignmentRecord {
                id: Uuid::now_v7(),
                username: "assigned_member".to_owned(),
                role_id: role.id,
                scope_id: None,
                scope_mode: "exact".to_owned(),
            },
        )
        .await;
    assert!(matches!(
        wrong_scope,
        Err(MutateAuthorizationAssignmentError::ScopeInvalid)
    ));

    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(member_id)
        .execute(&pool)
        .await
        .expect("member status must update");
    let suspended = database
        .create_authorization_assignment(
            administrator_id,
            CreateAuthorizationAssignmentRecord {
                id: Uuid::now_v7(),
                username: "assigned_member".to_owned(),
                role_id: suspended_role.id,
                scope_id: None,
                scope_mode: "exact".to_owned(),
            },
        )
        .await
        .expect("a suspended account must remain administratively assignable");
    assert_eq!(suspended.user_id, member_id);

    let system_role_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM roles WHERE key = 'super_admin'")
            .fetch_one(&pool)
            .await
            .expect("system role must exist");
    let system_assignment = database
        .create_authorization_assignment(
            administrator_id,
            CreateAuthorizationAssignmentRecord {
                id: Uuid::now_v7(),
                username: "assignment_owner".to_owned(),
                role_id: system_role_id,
                scope_id: None,
                scope_mode: "exact".to_owned(),
            },
        )
        .await;
    assert!(matches!(
        system_assignment,
        Err(MutateAuthorizationAssignmentError::SystemManaged)
    ));

    database
        .delete_authorization_assignment(administrator_id, assignment.id)
        .await
        .expect("custom role assignment must be revocable");
    let removed = database
        .list_authorization_role_assignments(
            Some("assigned_member"),
            Some(role.id),
            Some(board_id),
            None,
            10,
        )
        .await
        .expect("assignment list must remain queryable");
    assert!(removed.is_empty());
}
