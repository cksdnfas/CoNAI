import { POST_LINK_PATTERN } from '@conai/shared'

/** A post (or one of its comments) a chat points at: `post:12` / `post:12#comment-45`. */
export type PostRef = { postId: number; commentId: number | null }

export function parsePostLink(href: string | null | undefined): PostRef | null {
  const match = href ? POST_LINK_PATTERN.exec(href) : null
  return match ? { postId: Number(match[1]), commentId: match[2] ? Number(match[2]) : null } : null
}

/** The posts page route that opens the post, scrolled to the comment when there is one. */
export function postRoute({ postId, commentId }: PostRef) {
  return `/posts?post=${postId}${commentId ? `&comment=${commentId}` : ''}`
}
