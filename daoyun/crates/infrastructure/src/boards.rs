use sqlx::{FromRow, types::Uuid};

use crate::{Database, DatabaseError};

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct BoardRecord {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: String,
    pub position: i32,
    pub depth: i64,
    pub child_count: i64,
    pub topic_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct BoardDetailLookupRecord {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub tone: String,
    pub topic_count: i64,
    pub can_read: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct BoardBreadcrumbRecord {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

impl Database {
    pub async fn list_public_boards(
        &self,
        viewer_user_id: Option<Uuid>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<BoardRecord>, DatabaseError> {
        let boards = sqlx::query_as::<_, BoardRecord>(
            "SELECT board.id, board.parent_id, board.slug, board.name, board.description, \
                    board.icon, board.tone, board.position, board.topic_count, \
                    (WITH RECURSIVE ancestors AS ( \
                         SELECT parent_id, 0::bigint AS depth FROM boards WHERE id = board.id \
                         UNION ALL \
                         SELECT parent.parent_id, ancestors.depth + 1 \
                         FROM ancestors JOIN boards AS parent ON parent.id = ancestors.parent_id \
                         WHERE parent.deleted_at IS NULL \
                    ) SELECT COALESCE(MAX(depth), 0) FROM ancestors) AS depth, \
                    (SELECT COUNT(*) FROM boards AS child \
                     WHERE child.parent_id = board.id AND child.visibility = 'public' \
                       AND child.deleted_at IS NULL \
                       AND daoyun_can_access_content('board', child.id, $3, CURRENT_TIMESTAMP) \
                    ) AS child_count \
             FROM boards AS board \
             WHERE board.visibility = 'public' \
               AND board.deleted_at IS NULL \
               AND daoyun_can_access_content('board', board.id, $3, CURRENT_TIMESTAMP) \
               AND ( \
                   $1::uuid IS NULL \
                   OR (board.position, board.id) > ( \
                       SELECT position, id \
                       FROM boards \
                       WHERE id = $1 AND visibility = 'public' AND deleted_at IS NULL \
                         AND daoyun_can_access_content('board', id, $3, CURRENT_TIMESTAMP) \
                   ) \
               ) \
             ORDER BY board.position, board.id \
             LIMIT $2",
        )
        .bind(cursor)
        .bind(limit)
        .bind(viewer_user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(boards)
    }

    pub async fn get_board_detail_lookup(
        &self,
        viewer_user_id: Option<Uuid>,
        slug: &str,
    ) -> Result<Option<BoardDetailLookupRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, BoardDetailLookupRecord>(
            "SELECT id, parent_id, slug, name, description, icon, tone, topic_count, \
                    visibility = 'public' \
                    AND daoyun_can_access_content('board', id, $2, CURRENT_TIMESTAMP) AS can_read \
             FROM boards WHERE slug = $1 AND deleted_at IS NULL",
        )
        .bind(slug)
        .bind(viewer_user_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    pub async fn list_public_board_children(
        &self,
        viewer_user_id: Option<Uuid>,
        parent_id: Uuid,
    ) -> Result<Vec<BoardRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, BoardRecord>(
            "SELECT board.id, board.parent_id, board.slug, board.name, board.description, \
                    board.icon, board.tone, board.position, board.topic_count, \
                    (WITH RECURSIVE ancestors AS ( \
                         SELECT parent_id, 0::bigint AS depth FROM boards WHERE id = board.id \
                         UNION ALL \
                         SELECT parent.parent_id, ancestors.depth + 1 \
                         FROM ancestors JOIN boards AS parent ON parent.id = ancestors.parent_id \
                         WHERE parent.deleted_at IS NULL \
                    ) SELECT COALESCE(MAX(depth), 0) FROM ancestors) AS depth, \
                    (SELECT COUNT(*) FROM boards AS child \
                     WHERE child.parent_id = board.id AND child.visibility = 'public' \
                       AND child.deleted_at IS NULL \
                       AND daoyun_can_access_content('board', child.id, $2, CURRENT_TIMESTAMP) \
                    ) AS child_count \
             FROM boards AS board \
             WHERE board.parent_id = $1 AND board.visibility = 'public' \
               AND board.deleted_at IS NULL \
               AND daoyun_can_access_content('board', board.id, $2, CURRENT_TIMESTAMP) \
             ORDER BY board.position, board.id",
        )
        .bind(parent_id)
        .bind(viewer_user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_public_board_breadcrumb(
        &self,
        viewer_user_id: Option<Uuid>,
        board_id: Uuid,
    ) -> Result<Vec<BoardBreadcrumbRecord>, DatabaseError> {
        Ok(sqlx::query_as::<_, BoardBreadcrumbRecord>(
            "WITH RECURSIVE ancestors AS ( \
                 SELECT id, parent_id, slug, name, 0 AS distance \
                 FROM boards \
                 WHERE id = $1 AND visibility = 'public' AND deleted_at IS NULL \
                   AND daoyun_can_access_content('board', id, $2, CURRENT_TIMESTAMP) \
                 UNION ALL \
                 SELECT parent.id, parent.parent_id, parent.slug, parent.name, \
                        ancestors.distance + 1 \
                 FROM ancestors \
                 JOIN boards AS parent ON parent.id = ancestors.parent_id \
                 WHERE parent.visibility = 'public' AND parent.deleted_at IS NULL \
                   AND daoyun_can_access_content('board', parent.id, $2, CURRENT_TIMESTAMP) \
             ) \
             SELECT id, slug, name FROM ancestors ORDER BY distance DESC",
        )
        .bind(board_id)
        .bind(viewer_user_id)
        .fetch_all(&self.pool)
        .await?)
    }
}
