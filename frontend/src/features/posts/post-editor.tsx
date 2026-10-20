import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostCategory, PostCommentMode, PostDetail, PostStatus } from '@conai/shared'
import { CHAT_PAGE_LIMITS, POST_LIMITS } from '@conai/shared'
import { AudioLines, FolderTree, Image as ImageIcon, Link as LinkIcon, Paperclip } from 'lucide-react'
import { FieldTabs } from '@/components/common/field-tabs'
import type { PlainTextEditorHandle } from '@/components/common/plain-text-editor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { invalidatePostScope, createPost, updatePost, getPostsSettings } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { PostAttachPicker, type AttachTab } from './post-attach-picker'
import { mediaHashesOf, PostMarkdown } from './post-markdown'
import { PostMediaContext } from './post-media'
import { usePostPermissions } from './use-post-permissions'
import type { PostRichEditorHandle } from './post-rich-editor'

const PlainTextEditor = lazy(() => import('@/components/common/plain-text-editor').then((module) => ({ default: module.PlainTextEditor })))
const PostRichEditor = lazy(() => import('./post-rich-editor').then((module) => ({ default: module.PostRichEditor })))

type Picker = AttachTab | null

const HEADER_TOP = 'var(--theme-shell-header-height)'

/** Where a bar sticks so it stays under the app header and the page's own sticky toolbar (whose height can wrap). */
function useStickyTopBelowPageToolbar() {
  const [top, setTop] = useState(HEADER_TOP)
  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>('[data-slot="page-toolbar"]')
    if (!toolbar || getComputedStyle(toolbar).position !== 'sticky') return
    const update = () => setTop(`calc(${HEADER_TOP} + ${toolbar.offsetHeight}px)`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])
  return top
}
/**
 * The body the connected chat sees with every request: a body up to this long is a field, a longer one a chunk of
 * this size (posts.body_at moves it) changed with posts.body_edit.
 */
const BODY_CHUNK = 2000

/** Exact-text replacements on a body, in order; each `find` must appear once unless `all` is set. */
function replaceInBody(body: string, edits: Array<{ find: string; replace: string; all?: boolean }>) {
  let next = body
  for (const edit of edits) {
    const count = edit.find ? next.split(edit.find).length - 1 : 0
    if (count === 0) throw new Error(`본문에 없는 글이야: ${edit.find.slice(0, 40)}`)
    if (count > 1 && !edit.all) throw new Error(`본문에 ${count}번 나와. 앞뒤 글을 더 넣거나 all을 켜줘: ${edit.find.slice(0, 40)}`)
    next = edit.all ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, () => edit.replace)
  }
  return next
}

/** Categories in tree order with their depth, for a select. */
export function flattenCategories(categories: PostCategory[]) {
  const children = new Map<number | null, PostCategory[]>()
  for (const category of categories) children.set(category.parentId, [...(children.get(category.parentId) ?? []), category])
  const out: Array<{ category: PostCategory; depth: number }> = []
  const walk = (parentId: number | null, depth: number) => {
    if (depth > 8) return
    for (const category of children.get(parentId) ?? []) {
      out.push({ category, depth })
      walk(category.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Chips for tags; Enter or a comma adds what is typed, Backspace on an empty field drops the last one. */
function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const add = (value: string) => {
    const tag = value.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, POST_LIMITS.tag)
    if (tag && !tags.some((item) => item.toLowerCase() === tag.toLowerCase()) && tags.length < POST_LIMITS.tags) onChange([...tags, tag])
    setDraft('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Enter' || event.key === ',') && draft.trim()) {
      event.preventDefault()
      add(draft)
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1))
    }
  }
  return (
    <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-sm bg-fill px-2 py-1">
      {tags.map((tag) => (
        <Chip key={tag} tone="primary" removeLabel={t({ ko: '{tag} 빼기', en: 'Remove {tag}' }, { tag })} onRemove={() => onChange(tags.filter((item) => item !== tag))}>#{tag}</Chip>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { if (draft.trim()) add(draft) }}
        placeholder={tags.length ? '' : t({ ko: '태그', en: 'Tags' })}
        aria-label={t({ ko: '태그 추가', en: 'Add tag' })}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

/** Write or edit a post. `post` null: a new post (in `defaultCategoryId`). */
export function PostEditor({ post, categories, defaultCategoryId, onSaved, onCancel }: {
  post: PostDetail | null
  categories: PostCategory[]
  defaultCategoryId: number | null
  onSaved: (post: PostDetail) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const { isAdmin, canUseFiles, canViewImages, canViewAudio } = usePostPermissions()
  const settings = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [categoryId, setCategoryId] = useState<number | null>(post ? post.categoryId : defaultCategoryId)
  const [tags, setTags] = useState<string[]>(post?.tags ?? [])
  const [status, setStatus] = useState<PostStatus>(post?.status ?? 'published')
  const [commentMode, setCommentMode] = useState<PostCommentMode>(post?.commentMode ?? 'open')
  const [pinned, setPinned] = useState(post?.pinned ?? false)
  const [tab, setTab] = useState<'write' | 'source' | 'preview'>('write')
  const [bodyOffset, setBodyOffset] = useState(0)
  const commitBody = useChatDraftTransaction(body, setBody)
  const [picker, setPicker] = useState<Picker>(null)
  const sourceRef = useRef<PlainTextEditorHandle | null>(null)
  const richEditorRef = useRef<PostRichEditorHandle | null>(null)
  const stickyTop = useStickyTopBelowPageToolbar()
  const flat = useMemo(() => flattenCategories(categories), [categories])
  const previewContext = useMemo(() => ({ postId: post?.id ?? null, mediaHashes: mediaHashesOf(body) }), [post?.id, body])

  const save = useMutation({
    mutationFn: () => {
      const input = { title, body, categoryId, tags, status, commentMode, ...(isAdmin ? { pinned } : {}) }
      return post ? updatePost(post.id, { ...input, expectedRevision: post.revision }) : createPost(input)
    },
    onSuccess: async (saved) => {
      await invalidatePostScope(queryClient, saved.id, 'post')
      onSaved(saved)
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '글을 저장하지 못했어.', en: 'Could not save the post.' })) }),
  })

  /** Put embed lines at the caret, each on its own line. */
  const insert = (lines: string[]) => {
    if (!lines.length) return
    if (tab === 'write' && richEditorRef.current?.insertMarkdown(`${lines.join('\n\n')}\n`)) return
    if (tab === 'source' && sourceRef.current?.insertLines(lines)) return
    // Preview (or an editor still loading): add them at the end and show the source.
    setBody(`${body}${body && !body.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`)
    setTab(tab === 'write' ? 'write' : 'source')
  }

  // The connected chat (page assistant) drafts into these fields; saving stays a card the person applies.
  const categoryLabels = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category]))
    const pathOf = (category: PostCategory) => {
      const names: string[] = []
      for (let current: PostCategory | undefined = category; current && names.length < 8; current = current.parentId === null ? undefined : byId.get(current.parentId)) names.unshift(current.name)
      return names.join(' › ')
    }
    return flat.map(({ category }) => ({ id: category.id, label: pathOf(category) }))
  }, [categories, flat])
  const NO_CATEGORY = t({ ko: '없음', en: 'None' })
  const categoryLabel = categoryLabels.find((item) => item.id === categoryId)?.label ?? NO_CATEGORY
  const assistantStatuses: PostStatus[] = isAdmin || post?.status === 'hidden' ? ['published', 'draft', 'hidden'] : ['published', 'draft']
  const bodyFits = body.length <= BODY_CHUNK
  const dirty = post
    ? title !== post.title || body !== post.body || categoryId !== post.categoryId || tags.join('\u0000') !== post.tags.join('\u0000') || status !== post.status || commentMode !== post.commentMode || (isAdmin && pinned !== post.pinned)
    : Boolean(title.trim() || body.trim())
  useChatPageRegistration(save.isPending || post?.knowledge ? null : {
    kind: 'posts',
    title: post ? t({ ko: '글 고치기', en: 'Edit post' }) : t({ ko: '새 글', en: 'New post' }),
    resourceId: `edit:${post?.id ?? 'new'}`,
    priority: 1,
    dirty,
    fields: [
      { id: 'title', label: t({ ko: '제목', en: 'Title' }), type: 'text', value: title },
      ...(bodyFits ? [{ id: 'body', label: t({ ko: '본문 (Markdown, 미디어는 ![](media:해시) 같은 줄)', en: 'Body (Markdown; media as ![](media:hash) lines)' }), type: 'text' as const, value: body, allowEmpty: true }] : []),
      { id: 'category', label: t({ ko: '카테고리', en: 'Category' }), type: 'select', value: categoryLabel, options: [NO_CATEGORY, ...categoryLabels.map((item) => item.label)].slice(0, CHAT_PAGE_LIMITS.options) },
      { id: 'tags', label: t({ ko: '태그 (쉼표로 구분)', en: 'Tags (comma separated)' }), type: 'text', value: tags.join(', '), allowEmpty: true },
      { id: 'status', label: t({ ko: '상태', en: 'Status' }), type: 'select', value: status, options: assistantStatuses },
      { id: 'commentMode', label: t({ ko: '댓글', en: 'Comments' }), type: 'select', value: commentMode, options: ['open', 'closed'] },
      ...(isAdmin ? [{ id: 'pinned', label: t({ ko: '목록 맨 위에 고정', en: 'Pin to the top of the list' }), type: 'boolean' as const, value: pinned }] : []),
    ],
    data: bodyFits ? {} : { body: pageFreeText(body.slice(bodyOffset, bodyOffset + BODY_CHUNK)), bodyOffset, bodyLength: body.length },
    actions: [
      ...(bodyFits ? [] : [
        pageAction('posts.body_at', t({ ko: '본문 이어 읽기', en: 'Read the body from' }), t({ ko: 'data.body를 offset부터 보여줘', en: 'data.body from offset' }), pageObject({ offset: pageNumber(0, Math.max(0, body.length - 1), true) }, ['offset'])),
        pageAction('posts.body_edit', t({ ko: '본문 고치기', en: 'Edit the body' }), t({ ko: 'whole은 본문 전체를 바꿔. edits는 find(한 번만 나오는 글)를 replace로 차례로 바꾸고, 하나라도 안 맞으면 그대로야', en: 'whole replaces the body; edits replace each find (appearing once) in order, all or nothing' }), pageObject({ whole: pageText(200000), edits: pageArray(pageObject({ find: pageText(8000), replace: pageText(100000), all: { type: 'boolean' } }, ['find', 'replace']), 50) })),
      ]),
      ...(title.trim() && dirty ? [pageAction('posts.save', post ? t({ ko: '글 저장', en: 'Save post' }) : t({ ko: '글 올리기', en: 'Publish post' }), t({ ko: '편집 중인 글을 저장해.', en: 'Save the post being edited.' }), undefined, 'save')] : []),
    ],
    apply: (patch) => {
      if (typeof patch.title === 'string') setTitle(patch.title.slice(0, POST_LIMITS.title))
      if (typeof patch.body === 'string') setBody(patch.body)
      if (typeof patch.category === 'string') setCategoryId(categoryLabels.find((item) => item.label === patch.category)?.id ?? null)
      if (typeof patch.tags === 'string') setTags([...new Set(patch.tags.split(',').map((tag) => tag.replace(/^#+/, '').trim()).filter(Boolean))].slice(0, POST_LIMITS.tags))
      if (typeof patch.status === 'string' && assistantStatuses.includes(patch.status as PostStatus)) setStatus(patch.status as PostStatus)
      if (patch.commentMode === 'open' || patch.commentMode === 'closed') setCommentMode(patch.commentMode)
      if (typeof patch.pinned === 'boolean' && isAdmin) setPinned(patch.pinned)
      if (typeof patch.body === 'string' && tab === 'preview') setTab('write')
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'posts.body_at') { setBodyOffset(Number(args.offset)); return }
      if (id === 'posts.body_edit') {
        if (typeof args.whole === 'string') return commitBody(args.whole)
        return commitBody(replaceInBody(body, (Array.isArray(args.edits) ? args.edits : []) as Array<{ find: string; replace: string; all?: boolean }>))
      }
      if (id !== 'posts.save') throw new Error('글 편집기에 없는 작업이야.')
      await save.mutateAsync()
    },
  })

  const statusOptions: Array<{ value: PostStatus; label: string }> = [
    { value: 'published', label: t({ ko: '발행', en: 'Published' }) },
    { value: 'draft', label: t({ ko: '초안', en: 'Draft' }) },
    ...(isAdmin || post?.status === 'hidden' ? [{ value: 'hidden' as const, label: t({ ko: '숨김', en: 'Hidden' }) }] : []),
  ]

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-16">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={POST_LIMITS.title}
        placeholder={t({ ko: '제목', en: 'Title' })}
        aria-label={t({ ko: '제목', en: 'Title' })}
        autoFocus={!post}
        className="w-full border-b border-line bg-transparent pb-2 text-2xl font-bold outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select variant="settings" className="w-full sm:w-56" aria-label={t({ ko: '카테고리', en: 'Category' })} value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{t({ ko: '카테고리 없음', en: 'No category' })}</option>
          {flat.map(({ category, depth }) => <option key={category.id} value={category.id}>{`${'　'.repeat(depth)}${category.name}`}</option>)}
        </Select>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      <div className="theme-input-surface min-w-0 rounded-sm border">
        <div className="flex flex-wrap items-center justify-between border-b border-line">
          <FieldTabs
            value={tab}
            onChange={setTab}
            ariaLabel={t({ ko: '본문', en: 'Body' })}
            bare
            items={[{ value: 'write', label: t({ ko: '서식 편집', en: 'Visual' }) }, { value: 'source', label: t({ ko: '원문', en: 'Source' }) }, { value: 'preview', label: t({ ko: '미리보기', en: 'Preview' }) }]}
          />
          <div className="flex items-center gap-0.5 px-1">
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '게시물 넣기', en: 'Insert a post' })} onClick={() => setPicker('post')}><LinkIcon /></IconButton>
            {canViewImages ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이미지·영상 넣기', en: 'Insert images or videos' })} onClick={() => setPicker('media')}><ImageIcon /></IconButton> : null}
            {canViewAudio ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '오디오 넣기', en: 'Insert audio' })} onClick={() => setPicker('audio')}><AudioLines /></IconButton> : null}
            {canViewImages ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '그룹 넣기', en: 'Insert group' })} onClick={() => setPicker('media')}><FolderTree /></IconButton> : null}
            {canUseFiles ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '보관함 파일 넣기', en: 'Insert file' })} onClick={() => setPicker('file')}><Paperclip /></IconButton> : null}
          </div>
        </div>
        {tab === 'write' ? (
          <PostMediaContext.Provider value={previewContext}>
            <Suspense fallback={<div className="min-h-[22rem]"><LoadingState /></div>}>
              <PostRichEditor
                ref={richEditorRef}
                value={body}
                onChange={setBody}
                stickyTop={stickyTop}
                onError={(error) => {
                  setTab('source')
                  showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '서식 편집기를 열지 못했어. 원문에서 계속 편집할 수 있어.', en: 'Could not open the visual editor. You can continue editing the source.' })) })
                }}
                onUnsupportedUpload={() => showSnackbar({ tone: 'info', message: t({ ko: '이미지와 파일은 위의 첨부 버튼으로 넣어줘.', en: 'Use the attachment buttons above to insert images and files.' }) })}
              />
            </Suspense>
          </PostMediaContext.Provider>
        ) : tab === 'source' ? (
          <Suspense fallback={<div className="min-h-[22rem]"><LoadingState /></div>}>
            <PlainTextEditor ref={sourceRef} value={body} onChange={setBody} fileName="post.md" ariaLabel={t({ ko: '본문', en: 'Body' })} bare heightClassName="h-[60vh] min-h-[22rem]" />
          </Suspense>
        ) : (
          <div className="min-h-[22rem] p-4">
            <PostMediaContext.Provider value={previewContext}>
              <PostMarkdown text={body} />
            </PostMediaContext.Provider>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select variant="settings" className="w-32" aria-label={t({ ko: '상태', en: 'Status' })} value={status} onChange={(event) => setStatus(event.target.value as PostStatus)}>
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Select variant="settings" className="w-32" aria-label={t({ ko: '댓글', en: 'Comments' })} value={commentMode} onChange={(event) => setCommentMode(event.target.value as PostCommentMode)}>
          <option value="open">{t({ ko: '댓글 열림', en: 'Comments open' })}</option>
          <option value="closed">{t({ ko: '댓글 닫힘', en: 'Comments closed' })}</option>
        </Select>
        {isAdmin ? (
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox checked={pinned} onCheckedChange={(checked) => setPinned(checked === true)} />
            {t({ ko: '위에 고정', en: 'Pin' })}
          </label>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>{t({ ko: '저장', en: 'Save' })}</Button>
      </div>
      {settings.data?.topicEvaluation.autoEnabled ? <p className="text-xs text-muted-foreground">{t(status === 'draft'
        ? { ko: '초안은 발행할 때 주제 관련도를 평가해.', en: 'Draft topic relevance is evaluated when published.' }
        : post ? { ko: '제목·본문이 바뀌면 주제 관련도가 이전 내용 기준으로 표시돼.', en: 'Editing the title or body marks previous topic scores as outdated.' }
          : { ko: '발행 후 주제 관련도를 자동으로 평가해. 글은 먼저 등록돼.', en: 'Topic relevance is evaluated after publication. The post is saved first.' })}</p> : null}

      {picker ? <PostAttachPicker initialTab={picker} onClose={() => setPicker(null)} onInsert={(lines) => { setPicker(null); insert(lines) }} /> : null}
    </div>
  )
}
