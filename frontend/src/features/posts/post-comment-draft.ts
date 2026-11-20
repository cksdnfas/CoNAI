import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { PostComment } from '@conai/shared'
import { createPostComment, invalidatePostScope, updatePostComment } from '@/lib/api-posts'
import { ApiRequestError } from '@/lib/api-request'

type Edit = { id: number; revision: number; text: string }
export type PostCommentDraft = { top: string; reply: { to: number; text: string } | null; edit: Edit | null }
export type SetCommentDraft = (update: (draft: PostCommentDraft) => PostCommentDraft) => void
const empty: PostCommentDraft = { top: '', reply: null, edit: null }

/** A response from a closed post cannot clear a new box, even when the user reopened the same post. */
export function usePostCommentDraft(postId: number | null): [PostCommentDraft, SetCommentDraft] {
  const [state, setState] = useState(() => ({ scope: { postId }, draft: empty }))
  if (state.scope.postId !== postId) setState({ scope: { postId }, draft: empty })
  return [state.draft, update => setState(current => {
    if (current.scope !== state.scope) return current
    const draft = update(current.draft)
    return draft === current.draft ? current : { ...current, draft }
  })]
}

export function openCommentEdit(draft: PostCommentDraft, comment: PostComment): PostCommentDraft {
  return draft.edit?.id === comment.id ? draft : { ...draft, edit: { id: comment.id, revision: comment.revision, text: comment.body } }
}

export async function publishCommentDraft(client: QueryClient, postId: number, parentId: number | null, text: string, setDraft: SetCommentDraft, mentions?: number[]) {
  const saved = await createPostComment(postId, { body: text.trim(), parentId, mentions })
  setDraft(draft => {
    if (parentId === null) return draft.top === text ? { ...draft, top: '' } : draft
    return draft.reply?.to === parentId && draft.reply.text === text ? { ...draft, reply: null } : draft
  })
  void invalidatePostScope(client, saved.postId, 'comment')
  return saved
}

export async function saveCommentDraft(client: QueryClient, postId: number, edit: Edit, setDraft: SetCommentDraft) {
  try {
    const saved = await updatePostComment(edit.id, { body: edit.text.trim(), expectedRevision: edit.revision })
    setDraft(draft => {
      if (draft.edit?.id !== edit.id || draft.edit.revision !== edit.revision) return draft
      return { ...draft, edit: draft.edit === edit ? null : { ...draft.edit, revision: saved.revision } }
    })
    void invalidatePostScope(client, postId, 'comment')
    return saved
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) void invalidatePostScope(client, postId, 'comment')
    throw error
  }
}
