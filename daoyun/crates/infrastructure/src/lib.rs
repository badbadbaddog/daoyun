#![forbid(unsafe_code)]

mod admin;
mod attachments;
mod auth;
mod authorization;
mod board_user_restrictions;
mod boards;
mod community_groups;
mod community_permissions;
mod content_access_policies;
mod experience;
mod governance;
mod idempotency;
mod installation;
mod membership;
mod messages;
mod mfa;
mod notifications;
mod operations;
mod outbox;
mod passkeys;
mod plugin_business_runtime;
mod plugins;
mod relations;
mod standard_entitlements;
mod storage;
mod topics;
mod users;

use std::{error::Error, fmt, time::Duration};

use sqlx::{
    PgPool,
    migrate::{Migrate, MigrateError, Migrator},
    postgres::PgPoolOptions,
};

pub use admin::{
    AdminAuditRecord, AdminBoardDeletionImpactRecord, AdminBoardRecord, AdminConfigError,
    BrandAssetError, BrandAssetRecord, BrandLinkRecord, CreateAdminBoardRecord,
    GovernancePolicyRecord, ListAdminAuditError, ListAdminAuditFilter, ListRiskAlertsError,
    RiskAlertRecord, SiteBrandingRecord, UpdateAdminBoardRecord, UpdateRiskAlertError,
    UpdateSiteBrandingRecord,
};
pub use attachments::{
    AttachmentCleanupError, AttachmentCleanupResultRecord, AttachmentError, AttachmentRecord,
    CreateAttachmentInput, ListAttachmentsError, MAX_ATTACHMENT_BYTES,
};
pub use auth::{
    BindExternalIdentityError, ChangePasswordError, DeviceSessionRecord, ExternalIdentityError,
    ExternalIdentityRecord, ExternalIdentityUserRecord, LoginUserRecord, NewExternalIdentityRecord,
    NewSessionRecord, NewUserRecord, RecentAuthenticationRecord, RegisterUserError,
    SecurityAuditEvent, SessionRecord, SessionUserRecord, UnlinkExternalIdentityError,
};
pub use authorization::{
    AuthorizationPermissionRecord, AuthorizationRoleAssignmentRecord, AuthorizationRoleRecord,
    CreateAuthorizationAssignmentRecord, CreateAuthorizationRoleRecord,
    ListAuthorizationAssignmentsError, MutateAuthorizationAssignmentError,
    MutateAuthorizationRoleError, UpdateAuthorizationRoleRecord, permission_keys,
};
pub use board_user_restrictions::{
    BoardUserRestrictionAction, BoardUserRestrictionMutationError, BoardUserRestrictionRecord,
    PutBoardUserRestrictionRecord,
};
pub use boards::BoardRecord;
pub use community_groups::{
    COMMUNITY_PERMISSION_KEYS, COMMUNITY_QUOTA_KEYS, CommunityGroupConfigurationRecord,
    CommunityGroupMembershipRecord, CommunityGroupMutationError, CommunityMembershipMutationError,
    CommunityMembershipMutationResult, CreateCommunityGroupRecord, GrantCommunityMembershipRecord,
    UpdateCommunityGroupRecord,
};
pub use community_permissions::{
    CommunityAccessError, CommunityAccessSnapshot, CommunityGroupPolicy, StandardEntitlementPolicy,
    merge_community_access_policies, merge_community_group_policies,
};
pub use content_access_policies::{
    ContentAccessPolicyMutationError, ContentAccessPolicyRecord, ContentAccessPolicySubjectRecord,
    PutContentAccessPolicyRecord,
};
pub use experience::{
    AdminGrowthLevelRecord, AppendExperienceError, CreateGrowthLevelRecord,
    ExperienceAccountRecord, ExperienceLedgerResult, GrowthLevelRecord, MutateGrowthLevelError,
    UpdateGrowthLevelRecord,
};
pub use governance::{
    ContentReportCreationRecord, ContentReportDetailRecord, ContentReportRecord,
    CreateContentReportError, GetContentReportDetailError, ListContentReportsError,
    ModerateContentReportError, ModerateContentReportRecord, ModerateReportUserRecord,
    NewContentReportRecord, ReportAuthorContextRecord, ReportContentContextRecord,
    ReportContextItemRecord, ReportHandlingRecordRecord, ReportHistoryItemRecord,
    ReportModerationResultRecord, ReportModerationUserResultRecord, UpdateContentReportError,
    UpdateContentReportRecord,
};
pub use installation::{InitializeInstallationError, InstallationAdministrator};
pub use membership::{
    AppendPointsLedgerError, GrantMembershipMedalError, GrantMembershipMedalResult,
    MembershipAccountRecord, MembershipLedgerResult, MembershipLevelRuleRecord,
    MembershipMedalRecord, MembershipMedalRuleRecord, UpdateMembershipLevelRuleError,
    UpdateMembershipLevelRuleRecord, UpdateMembershipMedalRuleError,
    UpdateMembershipMedalRuleRecord,
};
pub use messages::{
    ArchiveConversationError, ConversationLastMessageRecord, ConversationReadStateRecord,
    ConversationSummaryRecord, CreateConversationError, DirectMessageRecord,
    ListConversationsError, ListDirectMessagesError, MarkConversationReadError,
    NewDirectMessageRecord, SendDirectMessageError, SendDirectMessageResult,
};
pub use mfa::{
    MfaChallengeRecord, MfaChallengeUserRecord, MfaError, MfaRecoveryCodeRecord,
    MfaSecurityMutationError, MfaStatusRecord, MfaTotpRecord, MfaVerificationRecord,
    NewMfaChallengeRecord,
};
pub use notifications::{
    ListNotificationsError, NotificationMutationError, NotificationRecord,
    NotificationUnreadCountRecord,
};
pub use operations::{
    ListOperationsAlertsError, MutateOperationsAlertError, OperationsAlertRecord,
    OperationsAlertRuleRecord, OperationsAlertTransitionRecord, OperationsMetricValues,
    OperationsSummaryRecord, UpdateOperationsAlertRuleRecord,
};
pub use outbox::{
    ClaimedOutboxEvent, NewOutboxEvent, OutboxError, OutboxEventDisposition, OutboxEventRecord,
};
pub use passkeys::{
    DeletePasskeyError, NewPasskeyChallengeRecord, NewPasskeyCredentialRecord,
    PasskeyChallengeKind, PasskeyCredentialRecord, PasskeyUserRecord, RegisterPasskeyError,
};
pub use plugin_business_runtime::{
    ClaimedPluginEventDelivery, ClaimedPluginTask, ExecutePluginCommandRecord,
    PluginBusinessExecutableRecord, PluginCommandKind, PluginCommandResult, PluginQueryKind,
    PluginQueueDisposition, PluginQuotaSnapshot, PluginRuntimeError, PluginStorageObjectRecord,
    PluginTaskRecord, PutPluginStorageObjectRecord, SchedulePluginTaskRecord,
};
pub use plugins::{
    InstallPluginRecord, ListPluginsError, PluginExecutableRecord, PluginInvokeError,
    PluginMutationError, PluginRecord, UpdatePluginStatusRecord,
};
pub use relations::{
    BookmarkMutationError, BookmarkStateRecord, ListBookmarksError, PostLikeMutationError,
    PostLikeStateRecord,
};
pub use standard_entitlements::{
    GrantStandardEntitlementRecord, PutStandardEntitlementTypeRecord,
    RevokeStandardEntitlementRecord, StandardEntitlementGrantResult,
    StandardEntitlementMutationError, StandardEntitlementRecord, StandardEntitlementTypeRecord,
};
pub use topics::{
    CreateReplyError, CreateReplyResult, CreateTopicError, CreateTopicResult, IdempotencyInput,
    ListModerationTopicsError, ListPublicRepliesError, ListPublicTopicsError,
    ListTopicRevisionsError, ModerationBoardRecord, ModerationTopicFilters, ModerationTopicRecord,
    NewReplyRecord, NewTagRecord, NewTopicRecord, PublicReplyRecord, PublicTagRecord,
    PublicTagUsageRecord, PublicTopicDetailRecord, PublicTopicFilters, PublicTopicRecord,
    ReplyMutationError, ReplyRevisionRecord, TopicDeleteError, TopicGovernanceAction,
    TopicGovernanceError, TopicGovernanceInput, TopicGovernanceResultRecord, TopicModerationError,
    TopicModerationResultRecord, TopicRevisionRecord, TopicSort, UpdateReplyRecord,
    UpdateReplyResult, UpdateTopicError, UpdateTopicRecord, UpdateTopicResult,
};
pub use users::{
    AdminUserContentRecord, AdminUserDetailRecord, AdminUserReadError, AdminUserRoleRecord,
    AdminUserStatusUpdateRecord, AdminUserSummaryRecord, BlockMutationError, BlockStateRecord,
    FollowMutationError, FollowStateRecord, ListUserRelationsError, PublicUserProfileRecord,
    PublicUserSummaryRecord, UpdateAdminUserStatusError, UpdateAdminUserStatusRecord,
    UpdateUserProfileError, UpdateUserProfileRecord, UserProfileViewerRecord, UserRelationKind,
};

use storage::AttachmentStore;

// Source: https://docs.rs/sqlx/0.9.0/sqlx/macro.migrate.html
pub static MIGRATOR: Migrator = sqlx::migrate!("../../migrations");

#[derive(Clone, Debug)]
pub struct Database {
    pool: PgPool,
    attachment_store: AttachmentStore,
}

impl Database {
    pub fn from_pool(pool: PgPool) -> Self {
        Self {
            pool,
            attachment_store: AttachmentStore::from_environment(),
        }
    }

    // Source: https://docs.rs/sqlx/0.9.0/sqlx/postgres/type.PgPoolOptions.html#method.connect
    pub async fn connect_and_migrate(database_url: &str) -> Result<Self, DatabaseError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(3))
            .connect(database_url)
            .await?;
        let database = Self::from_pool(pool);
        database.migrate().await?;
        Ok(database)
    }

    pub async fn migrate(&self) -> Result<(), DatabaseError> {
        // Source: https://docs.rs/sqlx/0.9.0/sqlx/migrate/struct.Migrator.html#method.run
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    pub async fn check_readiness(&self) -> Result<(), DatabaseError> {
        let mut connection = self.pool.acquire().await?;
        let migrations_table_exists =
            sqlx::query_scalar::<_, bool>("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
                .fetch_one(&mut *connection)
                .await?;

        if !migrations_table_exists {
            return Err(DatabaseError::MigrationState);
        }

        // Source: https://docs.rs/sqlx/0.9.0/sqlx/migrate/trait.Migrate.html
        if connection
            .dirty_version("_sqlx_migrations")
            .await?
            .is_some()
        {
            return Err(DatabaseError::MigrationState);
        }

        let applied = connection
            .list_applied_migrations("_sqlx_migrations")
            .await?;
        let expected = MIGRATOR
            .iter()
            .filter(|migration| migration.migration_type.is_up_migration())
            .collect::<Vec<_>>();
        let is_current = applied.len() == expected.len()
            && applied.iter().zip(expected).all(|(applied, expected)| {
                applied.version == expected.version && applied.checksum == expected.checksum
            });

        if !is_current {
            return Err(DatabaseError::MigrationState);
        }

        Ok(())
    }
}

#[derive(Debug)]
pub enum DatabaseError {
    Sqlx(sqlx::Error),
    Migration(MigrateError),
    MigrationState,
}

impl fmt::Display for DatabaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlx(_) => formatter.write_str("database operation failed"),
            Self::Migration(_) => formatter.write_str("database migration failed"),
            Self::MigrationState => formatter.write_str("database migration state is not current"),
        }
    }
}

impl Error for DatabaseError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Sqlx(error) => Some(error),
            Self::Migration(error) => Some(error),
            Self::MigrationState => None,
        }
    }
}

impl From<sqlx::Error> for DatabaseError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
}

impl From<MigrateError> for DatabaseError {
    fn from(error: MigrateError) -> Self {
        Self::Migration(error)
    }
}
