use sqlx::{FromRow, types::Uuid};

use crate::{Database, DatabaseError};

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct BoardRecord {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: String,
    pub topic_count: i64,
}

impl Database {
    pub async fn list_public_boards(
        &self,
        viewer_user_id: Option<Uuid>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<BoardRecord>, DatabaseError> {
        let boards = sqlx::query_as::<_, BoardRecord>(
            "SELECT id, slug, name, description, icon, tone, topic_count \
             FROM boards \
             WHERE visibility = 'public' \
               AND deleted_at IS NULL \
               AND daoyun_can_access_content('board', id, $3, CURRENT_TIMESTAMP) \
               AND ( \
                   $1::uuid IS NULL \
                   OR (position, id) > ( \
                       SELECT position, id \
                       FROM boards \
                       WHERE id = $1 AND visibility = 'public' AND deleted_at IS NULL \
                         AND daoyun_can_access_content('board', id, $3, CURRENT_TIMESTAMP) \
                   ) \
               ) \
             ORDER BY position, id \
             LIMIT $2",
        )
        .bind(cursor)
        .bind(limit)
        .bind(viewer_user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(boards)
    }
}
