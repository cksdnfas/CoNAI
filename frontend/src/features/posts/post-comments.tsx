import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostBotRun, PostComment, PostDetail, PostMentionableProfile } from '@conai/shared'
import { Check, CornerDownRight, Eye, EyeOff, MessageSquareReply, Pencil, Send, Trash2, X } from 'lucide-react'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { mentionQueryAt } from '@/features/codex-chat/chat-mentions'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, cancelPostBotRun, createPostComment, deletePostComment, listMentionableProfiles, listPostComments, setPostCommentHidden, updatePostComment } from '@/lib/api-posts'
import { buildApiUrl } from '@/lib/api-url'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { PostAuthorAvatar, useRelativeTime } from './post-author'
import { PostAuthorChip, usePostReferenceEntry } from './post-chat-links'
import { PostMarkdown } from './post-markdown'
import { usePostPermissions } from './use-post-permissions'

/** Profiles the comment still names: a picked profile counts only while its `@name` is in the text. */
function mentionedIds(text: string, picked: Map<number, string>) {
  return [...picked].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id)
}

/**
 * What the comment boxes of the open post hold. It lives above the boxes so the connected chat (page assistant) can
 * read and draft it: the box under the post, and the reply box open under one comment.
 */
/** The open post's comment boxes: the box under the post, the reply box and the edit box of one comment. */
export type PostCommentDraft = { top: string; reply: { to: number; text: string } | null; edit: { id: number; text: string } | null }
export const EMPTY_COMMENT_DRAFT: PostCommentDraft = { top: '', reply: null, edit: null }

/** A one-line box that grows with its text, with its buttons inside (comment, reply and edit boxes). */
const BOX = 'theme-input-surface flex items-end gap-0.5 rounded-sm border py-1 pr-1 pl-3 transition-[border-color,box-shadow] focus-within:border-primary/55 focus-within:ring-2 focus-within:ring-primary/15'
const BOX_INPUT = 'max-h-60 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground'

/** A comment box; `@` opens the list of bots the viewer may call. Its text is held by the caller. */
function CommentComposer({ postId, parentId, mentionable, autoFocus, onDone, placeholder, text, setText }: {
  postId: number
  parentId: number | null
  mentionable: PostMentionableProfile[]
  autoFocus?: boolean
  onDone?: () => void
  placeholder?: string
  text: string
  setText: (text: string) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState(() => new Map<number, string>())
  const [caret, setCaret] = useState(0)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const query = mentionable.length ? mentionQueryAt(text, caret) : null
  const options = query && dismissed !== query.start
    ? mentionable.filter((profile) => profile.name.toLowerCase().includes(query.query.toLowerCase())).slice(0, 6)
    : []
  const mutation = useMutation({
    mutationFn: () => createPostComment(postId, { body: text, parentId, mentions: mentionedIds(text, picked) }),
    onSuccess: async () => {
      setText('')
      setPicked(new Map())
      onDone?.()
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '댓글을 올리지 못했어.', en: 'Could not post the comment.' })) }),
  })

  const choose = (profile: PostMentionableProfile) => {
    if (!query) return
    const next = `${text.slice(0, query.start)}@${profile.name} ${text.slice(caret)}`
    const position = query.start + profile.name.length + 2
    setText(next)
    setPicked((current) => new Map(current).set(profile.id, profile.name))
    setHighlight(0)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(position, position)
      setCaret(position)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An Enter that commits an IME (Korean) composition is part of typing, not a command.
    if (event.nativeEvent.isComposing) return
    if (options.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((current) => (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        choose(options[Math.min(highlight, options.length - 1)])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(query?.start ?? null)
        return
      }
    }
    // Enter posts, Shift+Enter breaks the line (as in the chat composer); Esc closes an open reply box.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (text.trim() && !mutation.isPending) mutation.mutate()
      return
    }
    if (event.key === 'Escape' && onDone && parentId) {
      event.preventDefault()
      event.stopPropagation()
      onDone()
    }
  }

  return (
    <div className="relative">
      {options.length ? (
        <div role="listbox" className="absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full rounded-md border border-line bg-surface-high p-1 shadow-lg">
          {options.map((profile, index) => (
            <Button
              key={profile.id}
              variant="ghost"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => { event.preventDefault(); choose(profile) }}
              onMouseEnter={() => setHighlight(index)}
              className={cn('h-auto w-full justify-start gap-2 px-2 py-1.5 text-left font-normal', index === highlight && 'bg-fill')}
            >
              <ChatProfileAvatar name={profile.name} imageUrl={profile.avatarUrl ? buildApiUrl(profile.avatarUrl) : null} avatarCrop={profile.avatarCrop} engine="llm" size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{profile.name}</span>
                {profile.tagline ? <span className="truncate text-xs text-muted-foreground">{profile.tagline}</span> : null}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      <div className={BOX}>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={t({ ko: '댓글', en: 'Comment' })}
          onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setDismissed(null) }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          className={BOX_INPUT}
        />
        {onDone && parentId ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '답글 닫기', en: 'Close reply' })} onClick={onDone}><X /></IconButton> : null}
        <IconButton size="icon-sm" variant="ghost" className="text-primary hover:text-primary" label={t({ ko: '등록', en: 'Post' })} disabled={!text.trim() || mutation.isPending} onClick={() => mutation.mutate()}><Send /></IconButton>
      </div>
    </div>
  )
}

function BotRunRow({ run }: { run: PostBotRun }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => cancelPostBotRun(run.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '취소하지 못했어.', en: 'Could not cancel.' })) }),
  })
  const active = run.status === 'queued' || run.status === 'running'
  const label = run.status === 'queued' ? t({ ko: '차례 기다리는 중', en: 'Waiting' })
    : run.status === 'running' ? t({ ko: '답글 쓰는 중', en: 'Writing a reply' })
      : run.status === 'cancelled' ? t({ ko: '취소됨', en: 'Cancelled' })
        : run.status === 'skipped' ? t({ ko: '부르지 않았어', en: 'Not called' })
          : t({ ko: '답글을 못 썼어', en: 'Reply failed' })
  return (
    <div className="grid grid-cols-[2rem_1fr] gap-2.5 py-2.5">
      <ChatProfileAvatar name={run.profileName} engine="llm" size="md" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">{run.profileName}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {active ? <span className="inline-flex gap-0.5" aria-hidden>{[0, 1, 2].map((dot) => <span key={dot} className="size-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${dot * 180}ms` }} />)}</span> : null}
          <span>{label}{!active && run.error ? ` · ${run.error}` : ''}</span>
          {run.canCancel ? (
            <IconButton size="icon-xs" variant="ghost" label={t({ ko: '호출 취소', en: 'Cancel call' })} disabled={cancel.isPending} onClick={() => cancel.mutate()}><X /></IconButton>
          ) : null}
        </span>
      </div>
    </div>
  )
}

/** A plain click on a comment, not on its links, media or buttons and not ending a text selection. */
function isReplyClick(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.defaultPrevented) return false
  if (event.target instanceof Element && event.target.closest('a, button, input, textarea, select, label, video, audio, img, [role="button"], .post-media')) return false
  return !window.getSelection()?.toString()
}

function CommentRow({ comment, quoted, mentionNames, canReply, onReply, onMention, reply, editing, setEditing, focused = false }: {
  comment: PostComment
  /** This comment's edit box text (null: closed); held by the page so the connected chat can draft it. */
  editing: string | null
  setEditing: (text: string | null) => void
  /** Opened from a link to this comment: it is scrolled to and marked for a moment. */
  focused?: boolean
  quoted: PostComment | null
  mentionNames: string[]
  canReply: boolean
  onReply: () => void
  /** Reply calling this comment's bot (from the bot's name card). */
  onMention?: () => void
  reply: boolean
}) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const { isAdmin } = usePostPermissions()
  // A long press opens the menu; the click that ends it must not also open the reply box.
  const touchMenuAt = useRef(0)
  const pointerType = useRef('mouse')
  const refresh = () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
  const onError = (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '댓글 작업에 실패했어.', en: 'Comment action failed.' })) })
  const save = useMutation({ mutationFn: (body: string) => updatePostComment(comment.id, { body, expectedRevision: comment.revision }), onSuccess: async () => { setEditing(null); await refresh() }, onError })
  const remove = useMutation({ mutationFn: () => deletePostComment(comment.id), onSuccess: refresh, onError })
  const hide = useMutation({ mutationFn: (hidden: boolean) => setPostCommentHidden(comment.id, hidden), onSuccess: refresh, onError })
  const reference = usePostReferenceEntry({ postId: comment.postId, commentId: comment.id, label: `${comment.author.name}: ${comment.body.replace(/\s+/g, ' ').slice(0, 40)}` })

  if (comment.status === 'deleted') {
    return <div className={cn('py-2.5 text-sm text-muted-foreground', reply && 'pl-10')}>{t({ ko: '지운 댓글이야', en: 'Deleted comment' })}</div>
  }
  const entries: ActionMenuEntry[] = [
    canReply ? { key: 'reply', icon: MessageSquareReply, label: t({ ko: '답글', en: 'Reply' }), onSelect: onReply } : null,
    reference,
    comment.canEdit && editing === null ? { key: 'edit', icon: Pencil, label: t({ ko: '고치기', en: 'Edit' }), onSelect: () => setEditing(comment.body) } : null,
    '-',
    isAdmin ? { key: 'hide', icon: comment.status === 'hidden' ? Eye : EyeOff, disabled: hide.isPending, label: comment.status === 'hidden' ? t({ ko: '다시 보이기', en: 'Show' }) : t({ ko: '숨기기', en: 'Hide' }), onSelect: () => hide.mutate(comment.status !== 'hidden') } : null,
    comment.canEdit ? {
      key: 'delete', icon: Trash2, destructive: true, disabled: remove.isPending, label: t({ ko: '지우기', en: 'Delete' }),
      onSelect: async () => { if (await confirm({ title: t({ ko: '댓글을 지울까?', en: 'Delete this comment?' }), tone: 'destructive' })) remove.mutate() },
    } : null,
  ]
  // Clicking the comment itself opens the reply box under it.
  const replyOnClick = canReply && editing === null
  const saveEdit = () => { if (editing?.trim() && !save.isPending) save.mutate(editing) }
  return (
    <ActionContextMenu entries={entries} onOpenChange={(open) => { if (open && pointerType.current !== 'mouse') touchMenuAt.current = Date.now() }}>
      <div
        id={`comment-${comment.id}`}
        onPointerDown={(event) => { pointerType.current = event.pointerType }}
        onClick={replyOnClick ? (event) => { if (isReplyClick(event) && Date.now() - touchMenuAt.current > 800) onReply() } : undefined}
        className={cn('grid scroll-mt-20 grid-cols-[2rem_1fr_auto] gap-x-2.5 rounded-sm py-2.5 transition-[background-color] duration-700 [-webkit-touch-callout:none]', reply && 'pl-10', replyOnClick && 'cursor-pointer', comment.status === 'hidden' && 'opacity-60', focused && 'bg-primary/10')}
      >
        <PostAuthorAvatar author={comment.author} size="md" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-h-5 flex-wrap items-center gap-x-2 text-sm">
            <PostAuthorChip author={comment.author} source={comment.sourceChat} showAvatar={false} onMention={onMention} />
            <span className="text-xs text-muted-foreground">{relative(comment.createdAt)}{comment.revision > 1 ? ` · ${t({ ko: '고침', en: 'edited' })}` : ''}</span>
            {comment.status === 'hidden' ? <span className="inline-flex items-center gap-1 text-xs text-destructive"><EyeOff className="size-3" />{t({ ko: '숨김', en: 'Hidden' })}</span> : null}
          </div>
          {quoted ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0" />
              <span className="shrink-0 font-medium">@{quoted.author.name}</span>
              <span className="truncate">{quoted.status === 'deleted' ? t({ ko: '지운 댓글', en: 'deleted comment' }) : quoted.body}</span>
            </div>
          ) : null}
          {editing !== null ? (
            <div className={BOX}>
              <textarea rows={1} value={editing} autoFocus className={BOX_INPUT} aria-label={t({ ko: '댓글 고치기', en: 'Edit comment' })}
                onChange={(event) => setEditing(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveEdit() }
                  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null) }
                }} />
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '취소', en: 'Cancel' })} onClick={() => setEditing(null)}><X /></IconButton>
              <IconButton size="icon-sm" variant="ghost" className="text-primary hover:text-primary" label={t({ ko: '저장', en: 'Save' })} disabled={!editing.trim() || save.isPending} onClick={saveEdit}><Check /></IconButton>
            </div>
          ) : (
            <PostMarkdown text={comment.body} mentions={mentionNames} className="text-sm [&_.post-media]:max-w-xs" />
          )}
        </div>
        <ActionMenuButton entries={entries} size="icon-xs" className="text-muted-foreground/60" label={t({ ko: '댓글 메뉴', en: 'Comment menu' })} />
      </div>
    </ActionContextMenu>
  )
}

/**
 * Comments two levels deep (deeper answers quote), bot calls still in progress, and the comment box. `hideHeading`:
 * the caller already labels the list (the post's 댓글 tab).
 */
export function PostComments({ post, draft, setDraft, hideHeading = false }: { post: PostDetail; draft: PostCommentDraft; setDraft: (update: (current: PostCommentDraft) => PostCommentDraft) => void; hideHeading?: boolean }) {
  const { t } = useI18n()
  const editProps = (id: number) => ({ editing: draft.edit?.id === id ? draft.edit.text : null, setEditing: (text: string | null) => setDraft((current) => ({ ...current, edit: text === null ? null : { id, text } })) })
  const { canComment, canSummon, isAdmin } = usePostPermissions()
  const replyTo = draft.reply?.to ?? null
  // From a bot's name card: the reply box under its comment, starting with @name (replying to a bot calls it anyway).
  const mentionProps = (comment: PostComment) => (comment.author.type === 'profile' && canSummon && canComment && (post.commentMode === 'open' || isAdmin)
    ? { onMention: () => setDraft((current) => ({ ...current, reply: { to: comment.id, text: `@${comment.author.name} ` } })) } : {})
  const setReplyTo = (id: number | null) => setDraft((current) => ({ ...current, reply: id === null ? null : { to: id, text: current.reply?.to === id ? current.reply.text : '' } }))
  const commentsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'comments', post.id], queryFn: () => listPostComments(post.id) })
  const mentionableQuery = useQuery({ queryKey: ['post-mentionable'], queryFn: listMentionableProfiles, enabled: canSummon && canComment, staleTime: 60_000 })
  const mentionable = useMemo(() => mentionableQuery.data ?? [], [mentionableQuery.data])
  const comments = useMemo(() => commentsQuery.data?.comments ?? [], [commentsQuery.data])
  const runs = commentsQuery.data?.runs ?? []
  // A link to one comment (`?comment=45`, from a chat): scroll to it once it is loaded and mark it for a moment.
  const [params] = useSearchParams()
  const linkedId = Number(params.get('comment')) || null
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const loaded = comments.some((comment) => comment.id === linkedId)
  useEffect(() => {
    if (!linkedId || !loaded) return
    document.getElementById(`comment-${linkedId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFocusedId(linkedId)
    const timer = window.setTimeout(() => setFocusedId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [linkedId, loaded])
  const byId = useMemo(() => new Map(comments.map((comment) => [comment.id, comment])), [comments])
  const mentionNames = useMemo(() => [...new Set([...mentionable.map((profile) => profile.name), ...comments.filter((comment) => comment.author.type === 'profile').map((comment) => comment.author.name)])], [mentionable, comments])
  const open = post.commentMode === 'open' || isAdmin
  const canReply = canComment && open
  const { tops, children } = useMemo(() => {
    const tops: PostComment[] = []
    const children = new Map<number, PostComment[]>()
    for (const comment of comments) {
      if (comment.parentId === null) tops.push(comment)
      else {
        const siblings = children.get(comment.parentId) ?? []
        siblings.push(comment)
        children.set(comment.parentId, siblings)
      }
    }
    return { tops, children }
  }, [comments])
  const [visibleCount, setVisibleCount] = useState(40)
  const [visibleReplies, setVisibleReplies] = useState<Record<number, number>>({})
  // Deep links and assistant-opened reply/edit targets remain reachable outside the visible prefix.
  const requiredThreads = new Set([linkedId, replyTo, draft.edit?.id].flatMap((id) => {
    const comment = id ? byId.get(id) : undefined
    return comment ? [comment.parentId ?? comment.id] : []
  }))
  const visibleTops = tops.filter((top, index) => index >= tops.length - visibleCount || requiredThreads.has(top.id))
  const childrenFor = (id: number) => {
    const replies = children.get(id) ?? []
    const count = visibleReplies[id] ?? 40
    return replies.filter((child, index) => index >= replies.length - count || child.id === linkedId || child.id === replyTo || child.id === draft.edit?.id)
  }
  // A bot call answers in the thread of the comment that called it; finished calls show as their reply instead.
  const pendingRuns = runs.filter((run) => run.status !== 'done')
  const runsFor = (threadId: number) => pendingRuns.filter((run) => {
    const trigger = run.triggerCommentId !== null ? byId.get(run.triggerCommentId) : undefined
    return trigger && (trigger.parentId ?? trigger.id) === threadId
  })

  // The reply box opens right under the comment it answers (the reply itself still lands at the end of the thread).
  const replyTarget = replyTo !== null ? byId.get(replyTo) : undefined
  const replyComposer = replyTarget ? (
    <div className="pb-3 pl-10">
      <CommentComposer key={replyTarget.id} postId={post.id} parentId={replyTarget.id} mentionable={mentionable} autoFocus onDone={() => setReplyTo(null)}
        text={draft.reply?.text ?? ''} setText={(text) => setDraft((current) => (current.reply ? { ...current, reply: { ...current.reply, text } } : current))}
        placeholder={replyTarget.author.type === 'profile' && canSummon
          ? t({ ko: '@{name}에게 답글 · 봇이 답해', en: 'Reply to @{name} · the bot answers' }, { name: replyTarget.author.name })
          : t({ ko: '@{name}에게 답글', en: 'Reply to @{name}' }, { name: replyTarget.author.name })} />
    </div>
  ) : null

  return (
    <section className="space-y-2" aria-label={t({ ko: '댓글', en: 'Comments' })}>
      {hideHeading ? null : <h2 className="text-sm font-semibold">{t({ ko: '댓글 {count}', en: 'Comments {count}' }, { count: post.commentCount })}</h2>}
      {commentsQuery.isPending ? <div className="h-16 animate-pulse rounded-sm bg-surface-low" /> : null}
      {tops.length > visibleCount ? <Button variant="ghost" onClick={() => setVisibleCount((count) => count + 40)}>{t({ ko: '이전 댓글 더 보기', en: 'Load earlier comments' })}</Button> : null}
      <div className={cn('divide-y divide-line', hideHeading ? (tops.length ? 'border-b border-line' : '') : 'border-y border-line')}>
        {visibleTops.map((top) => (
          <div key={top.id}>
            <CommentRow comment={top} quoted={null} mentionNames={mentionNames} canReply={canReply} reply={false} focused={focusedId === top.id} onReply={() => setReplyTo(top.id)} {...mentionProps(top)} {...editProps(top.id)} />
            {replyTo === top.id ? replyComposer : null}
            {(children.get(top.id)?.length ?? 0) > (visibleReplies[top.id] ?? 40) ? <Button variant="ghost" className="ml-10" onClick={() => setVisibleReplies((current) => ({ ...current, [top.id]: (current[top.id] ?? 40) + 40 }))}>{t({ ko: '이전 답글 더 보기', en: 'Load earlier replies' })}</Button> : null}
            {childrenFor(top.id).map((child) => (
              <Fragment key={child.id}>
                <CommentRow comment={child} quoted={child.quoteCommentId ? byId.get(child.quoteCommentId) ?? null : null} mentionNames={mentionNames} canReply={canReply} reply focused={focusedId === child.id} onReply={() => setReplyTo(child.id)} {...mentionProps(child)} {...editProps(child.id)} />
                {replyTo === child.id ? replyComposer : null}
              </Fragment>
            ))}
            {runsFor(top.id).map((run) => <div key={`run-${run.id}`} className="pl-10"><BotRunRow run={run} /></div>)}
          </div>
        ))}
      </div>
      {canReply ? (
        <div className="pt-2">
          <CommentComposer postId={post.id} parentId={null} mentionable={mentionable} text={draft.top} setText={(top) => setDraft((current) => ({ ...current, top }))} placeholder={mentionable.length ? t({ ko: '댓글 쓰기 · @로 봇 부르기', en: 'Write a comment · @ to call a bot' }) : t({ ko: '댓글 쓰기', en: 'Write a comment' })} />
        </div>
      ) : !open ? <p className="pt-2 text-sm text-muted-foreground">{t({ ko: '댓글이 닫힌 글이야', en: 'Comments are closed' })}</p> : null}
    </section>
  )
}
