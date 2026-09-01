import {
  createReply,
  createTopic,
  deleteTopic,
  getTopic,
  listReplies,
  listTopics,
  updateTopic,
  type CreateReplyOptions,
  type CreateTopicInput,
  type CreateTopicOptions,
  type ListRepliesOptions,
  type ListTopicsOptions,
  type ReplyPage,
  type TopicDetail,
  type TopicPage,
  type TopicReply,
  type UpdateTopicInput,
  type UpdateTopicOptions,
} from "./topics"
import type { Topic } from "../types/community"
import type { RichTextDocument } from "../editor/richContent"

/**
 * Product-facing Post facade.
 *
 * The persisted domain still uses the mature Topic/Reply implementation. Keeping
 * this adapter intentionally thin lets product code move to Post/Comment naming
 * without duplicating DTO validation, CSRF, idempotency or rich-content logic.
 */
export type Post = Topic
export type PostDetail = TopicDetail
export type Comment = TopicReply
export type PostPage = TopicPage
export type CommentPage = ReplyPage
export type ListPostsOptions = ListTopicsOptions
export type ListCommentsOptions = ListRepliesOptions
export type CreatePostInput = CreateTopicInput
export type CreatePostOptions = CreateTopicOptions
export type UpdatePostInput = UpdateTopicInput
export type UpdatePostOptions = UpdateTopicOptions
export type CreateCommentOptions = CreateReplyOptions

export function listPosts(options: ListPostsOptions = {}): Promise<PostPage> {
  return listTopics(options)
}

export function createPost(input: CreatePostInput, options: CreatePostOptions): Promise<Post> {
  return createTopic(input, options)
}

export function getPost(postId: string, signal?: AbortSignal): Promise<PostDetail> {
  return getTopic(postId, signal)
}

export function updatePost(
  postId: string,
  input: UpdatePostInput,
  options: UpdatePostOptions,
): Promise<PostDetail> {
  return updateTopic(postId, input, options)
}

export function deletePost(postId: string, options: UpdatePostOptions): Promise<boolean> {
  return deleteTopic(postId, options)
}

export function listComments(
  postId: string,
  options: ListCommentsOptions = {},
): Promise<CommentPage> {
  return listReplies(postId, options)
}

export function createComment(
  postId: string,
  content: string,
  options: CreateCommentOptions,
  richContent?: RichTextDocument,
): Promise<Comment> {
  return createReply(postId, content, options, richContent)
}
