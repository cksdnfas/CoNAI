import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PostCategory, PostCommentMode, PostDetail, PostStatus } from '@conai/shared'
import { POST_LIMITS } from '@conai/shared'
import { AudioLines, FolderTree, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { FieldTabs } from '@/components/common/field-tabs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, createPost, updatePost } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { AudioEmbedPicker, GroupEmbedPicker } from './post-embed-pickers'
import { mediaHashesOf, PostMarkdown } from './post-markdown'
import { PostMediaContext } from './post-media'
import { usePostPermissions } from './use-post-permissions'

type Picker = 'media' | 'audio' | 'group' | 'file' | null

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
        <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 pl-2 pr-0.5 text-xs leading-6 text-primary">
          #{tag}
          <IconButton size="icon-xs" variant="ghost" className="size-5 rounded-full text-primary hover:bg-primary/20 hover:text-primary" label={t({ ko: '{tag} 빼기', en: 'Remove {tag}' }, { tag })} onClick={() => onChange(tags.filter((item) => item !== tag))}><X /></IconButton>
        </span>
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
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [categoryId, setCategoryId] = useState<number | null>(post ? post.categoryId : defaultCategoryId)
  const [tags, setTags] = useState<string[]>(post?.tags ?? [])
  const [status, setStatus] = useState<PostStatus>(post?.status ?? 'published')
  const [commentMode, setCommentMode] = useState<PostCommentMode>(post?.commentMode ?? 'open')
  const [pinned, setPinned] = useState(post?.pinned ?? false)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [picker, setPicker] = useState<Picker>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const flat = useMemo(() => flattenCategories(categories), [categories])
  const previewContext = useMemo(() => ({ postId: post?.id ?? null, mediaHashes: mediaHashesOf(body) }), [post?.id, body])

  const save = useMutation({
    mutationFn: () => {
      const input = { title, body, categoryId, tags, status, commentMode, ...(isAdmin ? { pinned } : {}) }
      return post ? updatePost(post.id, { ...input, expectedRevision: post.revision }) : createPost(input)
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
      onSaved(saved)
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '글을 저장하지 못했어.', en: 'Could not save the post.' })) }),
  })

  /** Put embed lines at the caret, each on its own line. */
  const insert = (lines: string[]) => {
    if (!lines.length) return
    const input = bodyRef.current
    const start = input?.selectionStart ?? body.length
    const end = input?.selectionEnd ?? body.length
    const before = body.slice(0, start)
    const after = body.slice(end)
    const block = `${before && !before.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n${after.startsWith('\n') || !after ? '' : '\n'}`
    const next = `${before}${block}${after}`
    setBody(next)
    setTab('write')
    const caret = before.length + block.length
    window.requestAnimationFrame(() => {
      bodyRef.current?.focus()
      bodyRef.current?.setSelectionRange(caret, caret)
    })
  }

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

      <div className="theme-input-surface relative overflow-hidden rounded-sm border">
        <FieldTabs
          value={tab}
          onChange={setTab}
          ariaLabel={t({ ko: '본문', en: 'Body' })}
          items={[{ value: 'write', label: t({ ko: '작성', en: 'Write' }) }, { value: 'preview', label: t({ ko: '미리보기', en: 'Preview' }) }]}
        />
        <div className="absolute right-1 top-0.5 flex items-center gap-0.5">
          {canViewImages ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이미지·영상 넣기', en: 'Insert images or videos' })} onClick={() => setPicker('media')}><ImageIcon /></IconButton> : null}
          {canViewAudio ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '오디오 넣기', en: 'Insert audio' })} onClick={() => setPicker('audio')}><AudioLines /></IconButton> : null}
          {canViewImages ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '그룹 넣기', en: 'Insert group' })} onClick={() => setPicker('group')}><FolderTree /></IconButton> : null}
          {canUseFiles ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '보관함 파일 넣기', en: 'Insert file' })} onClick={() => setPicker('file')}><Paperclip /></IconButton> : null}
        </div>
        {tab === 'write' ? (
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label={t({ ko: '본문', en: 'Body' })}
            className="block min-h-[22rem] w-full resize-y bg-transparent p-3 font-mono text-sm leading-relaxed outline-none"
          />
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

      {picker === 'media' ? (
        <ChatMediaPicker
          initial={[]}
          maxCount={20}
          title={t({ ko: '이미지·영상 넣기', en: 'Insert images or videos' })}
          applyLabel={t({ ko: '넣기', en: 'Insert' })}
          note={null}
          onClose={() => setPicker(null)}
          onPick={(items) => { setPicker(null); insert(items.map((item) => `![](media:${item.compositeHash})`)) }}
        />
      ) : null}
      {picker === 'audio' ? <AudioEmbedPicker onClose={() => setPicker(null)} onPick={(takes) => { setPicker(null); insert(takes.map((take) => `![${take.name.replace(/[[\]]/g, '')}](audio:${take.id})`)) }} /> : null}
      {picker === 'group' ? <GroupEmbedPicker onClose={() => setPicker(null)} onPick={(group) => { setPicker(null); insert([`![${group.name.replace(/[[\]]/g, '')}](group:${group.id})`]) }} /> : null}
      {picker === 'file' ? (
        <FilePicker
          title={t({ ko: '보관함 파일 넣기', en: 'Insert file' })}
          pickLabel={(count) => t({ ko: '{count}개 넣기', en: 'Insert {count}' }, { count })}
          onClose={() => setPicker(null)}
          onPick={(entries) => { setPicker(null); insert(entries.map((entry) => `![${entry.name.replace(/[[\]]/g, '')}](file:${entry.id})`)) }}
        />
      ) : null}
    </div>
  )
}
