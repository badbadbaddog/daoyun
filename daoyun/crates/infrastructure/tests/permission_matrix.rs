use infrastructure::{Database, InstallationAdministrator, NewUserRecord};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(pool: &PgPool) -> (Database, Uuid, Uuid) {
    let db = Database::from_pool(pool.clone());
    let owner = Uuid::now_v7();
    db.initialize_installation(InstallationAdministrator {
        id: owner,
        username: "owner".into(),
        email: "owner@example.com".into(),
        display_name: "Owner".into(),
        password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".into(),
    })
    .await
    .unwrap();
    let user = Uuid::now_v7();
    db.register_user(NewUserRecord {
        id: user,
        username: "subject".into(),
        email: "subject@example.com".into(),
        display_name: "Subject".into(),
        password_hash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$ZmFrZWhhc2g".into(),
    })
    .await
    .unwrap();
    let board = sqlx::query_scalar("SELECT id FROM boards WHERE slug = 'general'")
        .fetch_one(pool)
        .await
        .unwrap();
    (db, user, board)
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn inactive_accounts_are_denied_before_public_browse_conditions(pool: PgPool) {
    let (db, user, board) = fixture(&pool).await;
    for status in ["active", "restricted"] {
        sqlx::query("UPDATE users SET status = $2 WHERE id = $1")
            .bind(user)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        let check = db
            .permission_check(board, user, "browse", None, None, None, None)
            .await
            .unwrap();
        assert_eq!(check.scenarios[0].actions[0].decision, "allowed");
    }
    sqlx::query("UPDATE users SET status = 'suspended' WHERE id = $1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let matrix = db
        .board_permission_matrix(board, &[], Some(user))
        .await
        .unwrap();
    let browse = matrix.scenarios[0]
        .actions
        .iter()
        .find(|a| a.action == "browse")
        .unwrap();
    assert_eq!(
        browse.decision, "denied",
        "suspended must override public access"
    );
    assert_eq!(browse.reason, "account.inactive");
    let check = db
        .permission_check(board, user, "browse", None, None, None, None)
        .await
        .unwrap();
    assert_eq!(check.scenarios[0].actions[0].decision, "denied");
    assert_eq!(check.scenarios[0].actions[0].reason, "account.inactive");
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn governance_matrix_uses_assignments_and_current_tree_without_ordinary_grants(pool: PgPool) {
    let (db, user, root) = fixture(&pool).await;
    let child = Uuid::now_v7();
    let other = Uuid::now_v7();
    sqlx::query("INSERT INTO boards(id,slug,name,parent_id) VALUES ($1,'child','Child',$3),($2,'other','Other',NULL)")
        .bind(child).bind(other).bind(root).execute(&pool).await.unwrap();
    let group: Uuid = sqlx::query_scalar("SELECT group_id FROM community_group_memberships WHERE user_id=$1 AND revoked_at IS NULL LIMIT 1")
        .bind(user).fetch_one(&pool).await.unwrap();
    let matrix = db
        .board_permission_matrix(child, &[group], Some(user))
        .await
        .unwrap();
    for action in [
        "moderation_browse",
        "topic_pin",
        "topic_feature",
        "topic_lock",
        "topic_move",
    ] {
        let group_action = matrix.scenarios[0]
            .actions
            .iter()
            .find(|a| a.action == action)
            .expect("governance rows must exist");
        assert_eq!(group_action.decision, "not_applicable");
        assert!(group_action.source_ids.is_empty());
        let user_action = matrix.scenarios[1]
            .actions
            .iter()
            .find(|a| a.action == action)
            .unwrap();
        assert_eq!(user_action.decision, "denied");
        assert_eq!(user_action.reason, "governance.permission_not_provided");
    }
    let assignment = Uuid::now_v7();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,assigned_by,scope_id,scope_mode) SELECT $1,$2,id,$2,$3,'exact' FROM roles WHERE key='board_moderator'")
        .bind(assignment).bind(user).bind(root).execute(&pool).await.unwrap();
    for (board, expected) in [(root, "missing_context"), (child, "denied")] {
        let matrix = db
            .board_permission_matrix(board, &[], Some(user))
            .await
            .unwrap();
        let pin = matrix.scenarios[0]
            .actions
            .iter()
            .find(|a| a.action == "topic_pin")
            .unwrap();
        assert_eq!(pin.decision, expected);
        assert_eq!(
            db.has_permission(user, "moderation.topic.pin", Some(board))
                .await
                .unwrap(),
            pin.permission_provided
        );
    }
    sqlx::query("UPDATE role_assignments SET scope_mode='subtree' WHERE id=$1")
        .bind(assignment)
        .execute(&pool)
        .await
        .unwrap();
    let matrix = db
        .board_permission_matrix(child, &[], Some(user))
        .await
        .unwrap();
    let pin = matrix.scenarios[0]
        .actions
        .iter()
        .find(|a| a.action == "topic_pin")
        .unwrap();
    assert_eq!(pin.decision, "missing_context");
    assert_eq!(pin.source_ids, vec![assignment]);
    assert!(
        matrix.scenarios[0]
            .sources
            .iter()
            .any(|s| s.id == assignment && s.kind == "role")
    );
    sqlx::query("UPDATE boards SET parent_id=$2 WHERE id=$1")
        .bind(child)
        .bind(other)
        .execute(&pool)
        .await
        .unwrap();
    let matrix = db
        .board_permission_matrix(child, &[], Some(user))
        .await
        .unwrap();
    assert_eq!(
        matrix.scenarios[0]
            .actions
            .iter()
            .find(|a| a.action == "topic_pin")
            .unwrap()
            .decision,
        "denied"
    );
    // Even a persisted ordinary key in a role cannot enter the community grant path.
    let permission = Uuid::now_v7();
    sqlx::query("INSERT INTO permissions(id,permission_key,name) VALUES ($1,'topic.create','Ordinary fixture') ON CONFLICT(permission_key) DO NOTHING")
        .bind(permission).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.key='board_moderator' AND p.permission_key='topic.create'")
        .execute(&pool).await.unwrap();
    // Governance never replaces the group/entitlement path or consumes its quota.
    sqlx::query("DELETE FROM community_group_permissions WHERE permission_key='topic.create'")
        .execute(&pool)
        .await
        .unwrap();
    let matrix = db
        .board_permission_matrix(root, &[], Some(user))
        .await
        .unwrap();
    let create = matrix.scenarios[0]
        .actions
        .iter()
        .find(|a| a.action == "topic_create")
        .unwrap();
    assert_eq!(create.reason, "community.permission_not_provided");
    assert!(create.source_ids.is_empty());
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn governance_resources_check_both_move_scopes_and_reauthorize_real_writes(pool: PgPool) {
    let (db, user, board) = fixture(&pool).await;
    let target = Uuid::now_v7();
    let topic = Uuid::now_v7();
    let assignment = Uuid::now_v7();
    sqlx::query("INSERT INTO boards(id,slug,name) VALUES ($1,'destination','Destination')")
        .bind(target)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO topics(id,board_id,author_id,title,content,status,published_at,governance_revision) VALUES ($1,$2,$3,'Source','Body','published',CURRENT_TIMESTAMP,1)")
        .bind(topic).bind(board).bind(user).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,assigned_by,scope_id) SELECT $1,$2,id,$2,$3 FROM roles WHERE key='board_moderator'")
        .bind(assignment).bind(user).bind(board).execute(&pool).await.unwrap();
    let before: (i64,i64,i64,i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM community_quota_usage),(SELECT count(*) FROM admin_audit_log),(SELECT count(*) FROM outbox_events),(SELECT count(*) FROM point_ledger_entries),(SELECT count(*) FROM experience_ledger_entries)").fetch_one(&pool).await.unwrap();
    let denied = db
        .permission_check(
            board,
            user,
            "topic_move",
            Some(topic),
            None,
            None,
            Some(target),
        )
        .await
        .unwrap();
    assert_eq!(
        denied.scenarios[0].actions[0].reason,
        "governance.target_permission_not_provided"
    );
    let role = denied.scenarios[0]
        .sources
        .iter()
        .find(|s| s.id == assignment)
        .unwrap()
        .role
        .as_ref()
        .unwrap();
    assert!(role.scope_matches);
    assert_eq!(role.target_scope_matches, Some(false));
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,assigned_by,scope_id) SELECT $1,$2,id,$2,$3 FROM roles WHERE key='board_moderator'")
        .bind(Uuid::now_v7()).bind(user).bind(target).execute(&pool).await.unwrap();
    assert_eq!(
        db.permission_check(
            board,
            user,
            "topic_move",
            Some(topic),
            None,
            None,
            Some(target)
        )
        .await
        .unwrap()
        .scenarios[0]
            .actions[0]
            .decision,
        "allowed"
    );
    sqlx::query("UPDATE boards SET visibility='hidden' WHERE id=$1")
        .bind(target)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        db.permission_check(
            board,
            user,
            "topic_move",
            Some(topic),
            None,
            None,
            Some(target)
        )
        .await
        .unwrap()
        .scenarios[0]
            .actions[0]
            .reason,
        "resource.unavailable"
    );
    sqlx::query("UPDATE boards SET visibility='hidden' WHERE id=$1")
        .bind(board)
        .execute(&pool)
        .await
        .unwrap();
    for action in [
        "moderation_browse",
        "topic_pin",
        "topic_feature",
        "topic_lock",
    ] {
        let check = db
            .permission_check(board, user, action, Some(topic), None, None, None)
            .await
            .unwrap();
        assert_eq!(check.scenarios[0].actions[0].decision, "allowed");
        assert_eq!(check.topic_revision, Some(1));
    }
    sqlx::query("UPDATE users SET status='restricted' WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        db.permission_check(
            board,
            user,
            "moderation_browse",
            Some(topic),
            None,
            None,
            None
        )
        .await
        .unwrap()
        .scenarios[0]
            .actions[0]
            .decision,
        "allowed"
    );
    sqlx::query("UPDATE topics SET status='hidden' WHERE id=$1")
        .bind(topic)
        .execute(&pool)
        .await
        .unwrap();
    for action in ["moderation_browse", "topic_pin"] {
        assert_eq!(
            db.permission_check(board, user, action, Some(topic), None, None, None)
                .await
                .unwrap()
                .scenarios[0]
                .actions[0]
                .reason,
            "resource.unavailable"
        );
    }
    sqlx::query("UPDATE topics SET status='published' WHERE id=$1")
        .bind(topic)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET status='suspended' WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        db.permission_check(board, user, "topic_pin", Some(topic), None, None, None)
            .await
            .unwrap()
            .scenarios[0]
            .actions[0]
            .reason,
        "account.inactive"
    );
    sqlx::query("UPDATE users SET status='active' WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let pin = db
        .permission_check(board, user, "topic_pin", Some(topic), None, None, None)
        .await
        .unwrap();
    assert_eq!(pin.scenarios[0].actions[0].decision, "allowed");
    let after: (i64,i64,i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM community_quota_usage),(SELECT count(*) FROM admin_audit_log),(SELECT count(*) FROM outbox_events),(SELECT count(*) FROM point_ledger_entries),(SELECT count(*) FROM experience_ledger_entries)").fetch_one(&pool).await.unwrap();
    assert_eq!(
        before, after,
        "diagnostic reads have no business side effects"
    );
    sqlx::query("DELETE FROM role_assignments WHERE user_id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let actual = db
        .govern_topic(infrastructure::TopicGovernanceInput {
            actor_id: user,
            topic_id: topic,
            action: infrastructure::TopicGovernanceAction::Pin,
            expected_revision: 1,
            target_board_id: None,
            reason: None,
        })
        .await;
    assert!(
        matches!(actual, Err(infrastructure::TopicGovernanceError::Forbidden)),
        "a prior diagnostic cannot authorize a later write"
    );
}

#[sqlx::test(migrator = "infrastructure::MIGRATOR")]
async fn role_sources_count_towards_the_complete_snapshot_bound(pool: PgPool) {
    let (db, user, board) = fixture(&pool).await;
    sqlx::query("INSERT INTO roles(id,key,name,scope,is_system) SELECT gen_random_uuid(),'bounded_role_'||n,'Role '||n,'instance',false FROM generate_series(1,124) n").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO role_assignments(id,user_id,role_id,assigned_by) SELECT gen_random_uuid(),$1,id,$1 FROM roles WHERE key LIKE 'bounded_role_%'")
        .bind(user).execute(&pool).await.unwrap();
    let entitlement_type = Uuid::now_v7();
    sqlx::query("INSERT INTO standard_entitlement_types(id,internal_key,display_name,status) VALUES ($1,'bounded_entitlement','Bounded entitlement','disabled')")
        .bind(entitlement_type).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO user_standard_entitlements(id,user_id,entitlement_type_id,entitlement_key,type_version,source,reason,starts_at,ends_at,granted_by,idempotency_key) SELECT gen_random_uuid(),$1,$2,'bounded_entitlement',1,'admin','Bound test',CURRENT_TIMESTAMP-INTERVAL '2 days',CASE WHEN n=3 THEN CURRENT_TIMESTAMP-INTERVAL '1 day' ELSE NULL END,$1,'bounded-entitlement-'||n FROM generate_series(1,3) n")
        .bind(user).bind(entitlement_type).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO user_standard_entitlements(id,user_id,entitlement_type_id,entitlement_key,type_version,source,reason,starts_at,granted_by,idempotency_key,revoked_at,revoked_by,revocation_reason,revoke_idempotency_key) VALUES (gen_random_uuid(),$1,$2,'bounded_entitlement',1,'admin','Bound test',CURRENT_TIMESTAMP-INTERVAL '2 days',$1,'bounded-entitlement-revoked',CURRENT_TIMESTAMP,$1,'Revoked fixture','bounded-revoke')")
        .bind(user).bind(entitlement_type).execute(&pool).await.unwrap();
    let matrix = db
        .board_permission_matrix(board, &[], Some(user))
        .await
        .unwrap();
    let scenario = &matrix.scenarios[0];
    assert!(scenario.complete);
    assert_eq!(scenario.sources.len(), 128);
    assert_eq!(
        scenario
            .sources
            .iter()
            .filter(|s| s.kind == "group")
            .count(),
        1
    );
    assert_eq!(
        scenario
            .sources
            .iter()
            .filter(|s| s.kind == "entitlement")
            .count(),
        2
    );
    assert_eq!(
        scenario.sources.iter().filter(|s| s.kind == "role").count(),
        125
    );
    let group = Uuid::now_v7();
    let membership = Uuid::now_v7();
    sqlx::query("INSERT INTO community_groups(id,internal_key,display_name,display_order) VALUES ($1,'bounded_additional','Bounded additional',100)").bind(group).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO community_group_memberships(id,user_id,group_id,membership_kind,source,reason,starts_at,idempotency_key) VALUES ($1,$2,$3,'additional','admin','Bound test',CURRENT_TIMESTAMP-INTERVAL '1 day','bounded-additional')").bind(membership).bind(user).bind(group).execute(&pool).await.unwrap();
    assert!(matches!(
        db.board_permission_matrix(board, &[], Some(user)).await,
        Err(infrastructure::PermissionMatrixError::SourceLimit)
    ));
    assert!(matches!(
        db.permission_check(board, user, "topic_pin", None, None, None, None)
            .await,
        Err(infrastructure::PermissionMatrixError::SourceLimit)
    ));
    sqlx::query("UPDATE community_group_memberships SET ends_at=CURRENT_TIMESTAMP-INTERVAL '1 hour' WHERE id=$1").bind(membership).execute(&pool).await.unwrap();
    assert_eq!(
        db.permission_check(board, user, "topic_pin", None, None, None, None)
            .await
            .unwrap()
            .scenarios[0]
            .sources
            .len(),
        128
    );
    sqlx::query("DELETE FROM user_standard_entitlements WHERE user_id=$1 AND idempotency_key='bounded-entitlement-2'").bind(user).execute(&pool).await.unwrap();
    assert_eq!(
        db.board_permission_matrix(board, &[], Some(user))
            .await
            .unwrap()
            .scenarios[0]
            .sources
            .len(),
        127
    );
}
