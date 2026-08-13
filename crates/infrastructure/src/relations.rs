use std::{collections::HashMap, error::Error, fmt};

use serde_json::json;
use sqlx::{FromRow, types::Uuid};
use time::OffsetDateTime;

use crate::admin::insert_audit;
use crate::notifications::insert_notification;
use crate::{Database, DatabaseError, PublicTagRecord, PublicTopicRecord};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BookmarkStateRecord {
    pub topic_id: Uuid,
    pub bookmarked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PostLikeStateRecord {
    pub post_id: Uuid,
    pub liked: bool,
    pub like_count: i64,
}

#[derive(Debug)]
pub enum BookmarkMutationError {
    TopicUnavailable,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum ListBookmarksError {
    InvalidCursor,
    Database(DatabaseError),
}

#[derive(Debug)]
pub enum PostLikeMutationError {
    PostUnavailable,
    Database(DatabaseError),
}

impl Database {
    pub async fn set_topic_bookmarked(
        &self,
        user_id: Uuid,
        topic_id: Uuid,
        bookmarked: bool,
    ) -> Result<BookmarkStateRecord, BookmarkMutationError> {
        let mut transaction = self.pool.begin().await?;
        let visible_topic = sqlx::query_scalar::<_, Uuid>(
            "SELECT t.id \
             FROM topics AS t \
             INNER JOIN boards AS b ON b.id = t.board_id \
             INNER JOIN users AS author ON author.id = t.author_id \
             WHERE t.id = $1 \
               AND t.status = 'published' AND t.deleted_at IS NULL \
               AND b.visibility = 'public' AND b.deleted_at IS NULL \
               AND author.status = 'active' \
             FOR UPDATE OF t",
        )
        .bind(topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if visible_topic.is_none() {
            return Err(BookmarkMutationError::TopicUnavailable);
        }

        let edge_changed = if bookmarked {
            sqlx::query(
                "INSERT INTO topic_bookmarks (user_id, topic_id) VALUES ($1, $2) \
                 ON CONFLICT (user_id, topic_id) DO NOTHING",
            )
            .bind(user_id)
            .bind(topic_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
                == 1
        } else {
            sqlx::query("DELETE FROM topic_bookmarks WHERE user_id = $1 AND topic_id = $2")
                .bind(user_id)
                .bind(topic_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                == 1
        };
        if edge_changed {
            insert_audit(
                &mut transaction,
                user_id,
                if bookmarked {
                    "topic.bookmark"
                } else {
                    "topic.unbookmark"
                },
                "topic",
                Some(topic_id),
                json!({}),
            )
            .await?;
        }

        transaction.commit().await?;
        Ok(BookmarkStateRecord {
            topic_id,
            bookmarked,
        })
    }

    pub async fn list_user_bookmarks(
        &self,
        user_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<PublicTopicRecord>, ListBookmarksError> {
        if let Some(cursor) = cursor {
            let cursor_is_valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (\
                     SELECT 1 \
                     FROM topic_bookmarks AS bookmark \
                     INNER JOIN topics AS topic ON topic.id = bookmark.topic_id \
                     INNER JOIN boards AS board ON board.id = topic.board_id \
                     INNER JOIN users AS author ON author.id = topic.author_id \
                     WHERE bookmark.user_id = $1 AND bookmark.topic_id = $2 \
                       AND topic.status = 'published' AND topic.deleted_at IS NULL \
                       AND board.visibility = 'public' AND board.deleted_at IS NULL \
                       AND author.status = 'active'\
                 )",
            )
            .bind(user_id)
            .bind(cursor)
            .fetch_one(&self.pool)
            .await?;
            if !cursor_is_valid {
                return Err(ListBookmarksError::InvalidCursor);
            }
        }

        let rows = sqlx::query_as::<_, BookmarkedTopicRow>(
            "SELECT topic.id, topic.title, topic.excerpt, \
                    author.id AS author_id, author.username AS author_username, \
                    author.display_name AS author_display_name, \
                    author.avatar_url AS author_avatar_url, \
                    board.id AS board_id, board.slug AS board_slug, \
                    board.name AS board_name, board.tone AS board_tone, \
                    topic.published_at, topic.last_activity_at, \
                    topic.reply_count, topic.like_count, topic.view_count, \
                    (topic.featured_at IS NOT NULL) AS is_featured, \
                    (topic.pinned_at IS NOT NULL) AS is_pinned, \
                    EXISTS (\
                        SELECT 1 FROM post_likes AS post_like \
                        WHERE post_like.user_id = $1 AND post_like.post_id = topic.id\
                    ) AS viewer_liked \
             FROM topic_bookmarks AS bookmark \
             INNER JOIN topics AS topic ON topic.id = bookmark.topic_id \
             INNER JOIN boards AS board ON board.id = topic.board_id \
             INNER JOIN users AS author ON author.id = topic.author_id \
             WHERE bookmark.user_id = $1 \
               AND topic.status = 'published' AND topic.deleted_at IS NULL \
               AND board.visibility = 'public' AND board.deleted_at IS NULL \
               AND author.status = 'active' \
               AND (\
                   $2::uuid IS NULL \
                   OR (bookmark.created_at, bookmark.topic_id) < (\
                       SELECT cursor_bookmark.created_at, cursor_bookmark.topic_id \
                       FROM topic_bookmarks AS cursor_bookmark \
                       WHERE cursor_bookmark.user_id = $1 \
                         AND cursor_bookmark.topic_id = $2\
                   )\
               ) \
             ORDER BY bookmark.created_at DESC, bookmark.topic_id DESC \
             LIMIT $3",
        )
        .bind(user_id)
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        let topic_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
        let tag_rows = if topic_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as::<_, BookmarkedTopicTagRow>(
                "SELECT topic_tag.topic_id, tag.slug, tag.name \
                 FROM topic_tags AS topic_tag \
                 INNER JOIN tags AS tag ON tag.id = topic_tag.tag_id \
                 WHERE topic_tag.topic_id = ANY($1::uuid[]) \
                 ORDER BY topic_tag.topic_id, tag.slug",
            )
            .bind(&topic_ids)
            .fetch_all(&self.pool)
            .await?
        };
        let mut tags_by_topic = HashMap::<Uuid, Vec<PublicTagRecord>>::new();
        for row in tag_rows {
            tags_by_topic
                .entry(row.topic_id)
                .or_default()
                .push(PublicTagRecord {
                    slug: row.slug,
                    name: row.name,
                });
        }

        Ok(rows
            .into_iter()
            .map(|row| {
                let id = row.id;
                row.into_record(tags_by_topic.remove(&id).unwrap_or_default())
            })
            .collect())
    }

    pub async fn set_post_liked(
        &self,
        user_id: Uuid,
        post_id: Uuid,
        liked: bool,
    ) -> Result<PostLikeStateRecord, PostLikeMutationError> {
        let mut transaction = self.pool.begin().await?;
        let topic_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT topic.id \
             FROM posts AS post \
             INNER JOIN topics AS topic ON topic.id = post.topic_id \
             INNER JOIN boards AS board ON board.id = topic.board_id \
             INNER JOIN users AS topic_author ON topic_author.id = topic.author_id \
             INNER JOIN users AS post_author ON post_author.id = post.author_id \
             WHERE post.id = $1 \
               AND post.status = 'published' AND post.deleted_at IS NULL \
               AND topic.status = 'published' AND topic.deleted_at IS NULL \
               AND board.visibility = 'public' AND board.deleted_at IS NULL \
               AND topic_author.status = 'active' AND post_author.status = 'active' \
             FOR UPDATE OF topic",
        )
        .bind(post_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(topic_id) = topic_id else {
            return Err(PostLikeMutationError::PostUnavailable);
        };

        let post = sqlx::query_as::<_, LikeablePostRow>(
            "SELECT post.kind, post.like_count, post.author_id \
             FROM posts AS post \
             INNER JOIN users AS author ON author.id = post.author_id \
             WHERE post.id = $1 AND post.topic_id = $2 \
               AND post.status = 'published' AND post.deleted_at IS NULL \
               AND author.status = 'active' \
             FOR UPDATE OF post",
        )
        .bind(post_id)
        .bind(topic_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(post) = post else {
            return Err(PostLikeMutationError::PostUnavailable);
        };

        let edge_changed = if liked {
            sqlx::query(
                "INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) \
                 ON CONFLICT (user_id, post_id) DO NOTHING",
            )
            .bind(user_id)
            .bind(post_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
                == 1
        } else {
            sqlx::query("DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2")
                .bind(user_id)
                .bind(post_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected()
                == 1
        };

        let like_count = if edge_changed {
            let delta = if liked { 1_i64 } else { -1_i64 };
            let like_count = sqlx::query_scalar::<_, i64>(
                "UPDATE posts SET like_count = like_count + $2 WHERE id = $1 RETURNING like_count",
            )
            .bind(post_id)
            .bind(delta)
            .fetch_one(&mut *transaction)
            .await?;
            if post.kind == "topic" {
                sqlx::query("UPDATE topics SET like_count = like_count + $2 WHERE id = $1")
                    .bind(topic_id)
                    .bind(delta)
                    .execute(&mut *transaction)
                    .await?;
            }
            if liked && post.author_id != user_id {
                insert_notification(
                    &mut transaction,
                    Uuid::now_v7(),
                    post.author_id,
                    Some(user_id),
                    "like",
                    "topic",
                    topic_id,
                    &format!("like:{post_id}:{user_id}"),
                )
                .await?;
            }
            like_count
        } else {
            post.like_count
        };
        if edge_changed {
            insert_audit(
                &mut transaction,
                user_id,
                if liked { "post.like" } else { "post.unlike" },
                "post",
                Some(post_id),
                json!({"topic_id": topic_id}),
            )
            .await?;
        }

        transaction.commit().await?;
        Ok(PostLikeStateRecord {
            post_id,
            liked,
            like_count,
        })
    }
}

#[derive(Debug, FromRow)]
struct LikeablePostRow {
    kind: String,
    like_count: i64,
    author_id: Uuid,
}

#[derive(Debug, FromRow)]
struct BookmarkedTopicTagRow {
    topic_id: Uuid,
    slug: String,
    name: String,
}

#[derive(Debug, FromRow)]
struct BookmarkedTopicRow {
    id: Uuid,
    title: String,
    excerpt: String,
    author_id: Uuid,
    author_username: String,
    author_display_name: String,
    author_avatar_url: Option<String>,
    board_id: Uuid,
    board_slug: String,
    board_name: String,
    board_tone: String,
    published_at: OffsetDateTime,
    last_activity_at: OffsetDateTime,
    reply_count: i64,
    like_count: i64,
    view_count: i64,
    is_featured: bool,
    is_pinned: bool,
    viewer_liked: bool,
}

impl BookmarkedTopicRow {
    fn into_record(self, tags: Vec<PublicTagRecord>) -> PublicTopicRecord {
        PublicTopicRecord {
            id: self.id,
            title: self.title,
            excerpt: self.excerpt,
            author_id: self.author_id,
            author_username: self.author_username,
            author_display_name: self.author_display_name,
            author_avatar_url: self.author_avatar_url,
            board_id: self.board_id,
            board_slug: self.board_slug,
            board_name: self.board_name,
            board_tone: self.board_tone,
            published_at: self.published_at,
            last_activity_at: self.last_activity_at,
            reply_count: self.reply_count,
            like_count: self.like_count,
            viewer_bookmarked: Some(true),
            viewer_liked: Some(self.viewer_liked),
            view_count: self.view_count,
            is_featured: self.is_featured,
            is_pinned: self.is_pinned,
            tags,
        }
    }
}

impl fmt::Display for BookmarkMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TopicUnavailable => formatter.write_str("bookmark topic is unavailable"),
            Self::Database(_) => formatter.write_str("bookmark mutation database operation failed"),
        }
    }
}

impl Error for BookmarkMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::TopicUnavailable => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for BookmarkMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for ListBookmarksError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCursor => formatter.write_str("bookmark cursor is not available"),
            Self::Database(_) => formatter.write_str("bookmark list database operation failed"),
        }
    }
}

impl Error for ListBookmarksError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidCursor => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for ListBookmarksError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}

impl fmt::Display for PostLikeMutationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PostUnavailable => formatter.write_str("liked post is unavailable"),
            Self::Database(_) => {
                formatter.write_str("post like mutation database operation failed")
            }
        }
    }
}

impl Error for PostLikeMutationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::PostUnavailable => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for PostLikeMutationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(DatabaseError::from(error))
    }
}
