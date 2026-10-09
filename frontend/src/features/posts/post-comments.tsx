import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostBotRun, PostComment, PostDetail, PostMentionableProfile } from '@conai/shared'
import { CornerDownRight, Eye, EyeOff, Pencil, Reply, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { mentionQueryAt } from '@/features/codex-chat/chat-mentions'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, cancelPostBotRun, createPostComment, deletePostComment, listMentionableProfiles, listPostComments, setPostCommentHidden, updatePostComment } from '@/lib/api-posts'
import { buildApiUrl } from '@/lib/api-url'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { PostAuthorAvatar, PostAuthorName, useRelativeTime } from './post-author'
import { PostMarkdown } from './post-markdown'
import { usePostPermissions } from './use-post-permissions'

/** Profiles the comment still names: a picked profile counts only while its `@name` is in the text. */
function mentionedIds(text: string, picked: Map<number, string>) {
  return [...picked].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id)
}

/** A comment box; `@` opens the list of bots the viewer may call. */
function CommentComposer({ postId, parentId, mentionable, autoFocus, onDone, placeholder }: {
  postId: number
  parentId: number | null
  mentionable: PostMentionableProfile[]
  autoFocus?: boolean
  onDone?: () => void
  placeholder?: string
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
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
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && text.trim() && !mutation.isPending) {
      event.preventDefault()
      mutation.mutate()
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
      <Textarea
        ref={inputRef}
        rows={parentId ? 2 : 3}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={t({ ko: '댓글', en: 'Comment' })}
        onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setDismissed(null) }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="resize-y"
      />
      <div className="flex justify-end gap-1 pt-1.5">
        {onDone && parentId ? <Button variant="ghost" size="sm" onClick={onDone}>{t({ ko: '취소', en: 'Cancel' })}</Button> : null}
        <Button size="sm" disabled={!text.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          <Send />{t({ ko: '등록', en: 'Post' })}
        </Button>
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

function CommentRow({ comment, quoted, mentionNames, canReply, onReply, reply }: {
  comment: PostComment
  quoted: PostComment | null
  mentionNames: string[]
  canReply: boolean
  onReply: () => void
  reply: boolean
}) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const { isAdmin } = usePostPermissions()
  const [editing, setEditing] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
  const onError = (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '댓글 작업에 실패했어.', en: 'Comment action failed.' })) })
  const save = useMutation({ mutationFn: (body: string) => updatePostComment(comment.id, { body, expectedRevision: comment.revision }), onSuccess: async () => { setEditing(null); await refresh() }, onError })
  const remove = useMutation({ mutationFn: () => deletePostComment(comment.id), onSuccess: refresh, onError })
  const hide = useMutation({ mutationFn: (hidden: boolean) => setPostCommentHidden(comment.id, hidden), onSuccess: refresh, onError })

  if (comment.status === 'deleted') {
    return <div className={cn('py-2.5 text-sm text-muted-foreground', reply && 'pl-10')}>{t({ ko: '지운 댓글이야', en: 'Deleted comment' })}</div>
  }
  return (
    <div className={cn('group/comment grid grid-cols-[2rem_1fr] gap-2.5 py-2.5', reply && 'pl-10', comment.status === 'hidden' && 'opacity-60')}>
      <PostAuthorAvatar author={comment.author} size="md" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <PostAuthorName author={comment.author} />
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
          <div className="space-y-1.5">
            <Textarea rows={3} value={editing} onChange={(event) => setEditing(event.target.value)} aria-label={t({ ko: '댓글 고치기', en: 'Edit comment' })} autoFocus />
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
              <Button size="sm" disabled={!editing.trim() || save.isPending} onClick={() => save.mutate(editing)}>{t({ ko: '저장', en: 'Save' })}</Button>
            </div>
          </div>
        ) : (
          <PostMarkdown text={comment.body} mentions={mentionNames} className="text-sm [&_.post-media]:max-w-xs" />
        )}
        {/* Row actions stay out of the way until the row is hovered or focused (always shown on touch screens). */}
        <div className="flex items-center gap-0.5 text-muted-foreground transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/comment:opacity-100">
          {canReply ? <IconButton size="icon-xs" variant="ghost" label={t({ ko: '답글', en: 'Reply' })} onClick={onReply}><Reply /></IconButton> : null}
          {comment.canEdit && editing === null ? <IconButton size="icon-xs" variant="ghost" label={t({ ko: '고치기', en: 'Edit' })} onClick={() => setEditing(comment.body)}><Pencil /></IconButton> : null}
          {comment.canEdit ? (
            <IconButton size="icon-xs" variant="ghost" label={t({ ko: '지우기', en: 'Delete' })} disabled={remove.isPending} onClick={async () => {
              if (await confirm({ title: t({ ko: '댓글을 지울까?', en: 'Delete this comment?' }), tone: 'destructive' })) remove.mutate()
            }}><Trash2 /></IconButton>
          ) : null}
          {isAdmin ? (
            <IconButton size="icon-xs" variant="ghost" label={comment.status === 'hidden' ? t({ ko: '다시 보이기', en: 'Show' }) : t({ ko: '숨기기', en: 'Hide' })} disabled={hide.isPending} onClick={() => hide.mutate(comment.status !== 'hidden')}>
              {comment.status === 'hidden' ? <Eye /> : <EyeOff />}
            </IconButton>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Comments two levels deep (deeper answers quote), bot calls still in progress, and the comment box. */
export function PostComments({ post }: { post: PostDetail }) {
  const { t } = useI18n()
  const { canComment, canSummon, isAdmin } = usePostPermissions()
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const commentsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'comments', post.id], queryFn: () => listPostComments(post.id) })
  const mentionableQuery = useQuery({ queryKey: ['post-mentionable'], queryFn: listMentionableProfiles, enabled: canSummon && canComment, staleTime: 60_000 })
  const mentionable = useMemo(() => mentionableQuery.data ?? [], [mentionableQuery.data])
  const comments = useMemo(() => commentsQuery.data?.comments ?? [], [commentsQuery.data])
  const runs = commentsQuery.data?.runs ?? []
  const byId = useMemo(() => new Map(comments.map((comment) => [comment.id, comment])), [comments])
  const mentionNames = useMemo(() => [...new Set([...mentionable.map((profile) => profile.name), ...comments.filter((comment) => comment.author.type === 'profile').map((comment) => comment.author.name)])], [mentionable, comments])
  const open = post.commentMode === 'open' || isAdmin
  const canReply = canComment && open
  const tops = comments.filter((comment) => comment.parentId === null)
  // A bot call answers in the thread of the comment that called it; finished calls show as their reply instead.
  const pendingRuns = runs.filter((run) => run.status !== 'done')
  const runsFor = (threadId: number) => pendingRuns.filter((run) => {
    const trigger = run.triggerCommentId !== null ? byId.get(run.triggerCommentId) : undefined
    return trigger && (trigger.parentId ?? trigger.id) === threadId
  })

  return (
    <section className="space-y-2" aria-label={t({ ko: '댓글', en: 'Comments' })}>
      <h2 className="text-sm font-semibold">{t({ ko: '댓글 {count}', en: 'Comments {count}' }, { count: post.commentCount })}</h2>
      {commentsQuery.isPending ? <div className="h-16 animate-pulse rounded-sm bg-surface-low" /> : null}
      <div className="divide-y divide-line border-y border-line">
        {tops.map((top) => (
          <div key={top.id}>
            <CommentRow comment={top} quoted={null} mentionNames={mentionNames} canReply={canReply} reply={false} onReply={() => setReplyTo(top.id)} />
            {comments.filter((comment) => comment.parentId === top.id).map((child) => (
              <CommentRow key={child.id} comment={child} quoted={child.quoteCommentId ? byId.get(child.quoteCommentId) ?? null : null} mentionNames={mentionNames} canReply={canReply} reply onReply={() => setReplyTo(child.id)} />
            ))}
            {runsFor(top.id).map((run) => <div key={`run-${run.id}`} className="pl-10"><BotRunRow run={run} /></div>)}
            {replyTo !== null && (byId.get(replyTo)?.parentId ?? replyTo) === top.id ? (
              <div className="pb-3 pl-10">
                <CommentComposer postId={post.id} parentId={replyTo} mentionable={mentionable} autoFocus onDone={() => setReplyTo(null)} placeholder={t({ ko: '@{name}에게 답글', en: 'Reply to @{name}' }, { name: byId.get(replyTo)?.author.name ?? '' })} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {canReply ? (
        <div className="pt-2">
          <CommentComposer postId={post.id} parentId={null} mentionable={mentionable} placeholder={mentionable.length ? t({ ko: '댓글 쓰기 · @로 봇 부르기', en: 'Write a comment · @ to call a bot' }) : t({ ko: '댓글 쓰기', en: 'Write a comment' })} />
        </div>
      ) : !open ? <p className="pt-2 text-sm text-muted-foreground">{t({ ko: '댓글이 닫힌 글이야', en: 'Comments are closed' })}</p> : null}
    </section>
  )
}
