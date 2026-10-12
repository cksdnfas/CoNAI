import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { PostCategory, PostMediaRef, PostSummary } from '@conai/shared'
import { BookOpen, FileText, Newspaper, Search } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Spinner } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-url'
import { POSTS_QUERY_KEY, listPostCategories, listPosts } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { useRelativeTime } from './post-author'
import { usePostPermissions } from './use-post-permissions'
import { AttachPanes, AttachToolbar, Highlight, LoadMoreSentinel, attachKey, type AttachCover, type AttachItem, type PostInsertStyle } from './post-attach-shared'

const PAGE = 30

/** Ancestors first: 창작 › 일러스트. */
function categoryPath(categories: PostCategory[], id: number | null) {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const names: string[] = []
  for (let current = id === null ? undefined : byId.get(id); current && names.length < 8; current = current.parentId === null ? undefined : byId.get(current.parentId)) names.unshift(current.name)
  return names.join(' › ')
}
type Scope = { kind: 'all' } | { kind: 'knowledge' } | { kind: 'category'; id: number }

export const coverSrc = (cover: AttachCover) => buildApiUrl(cover.kind === 'media' ? `/api/images/${cover.ref}/thumbnail` : `/api/groups/${cover.ref}/thumbnail`)
/** Images a post shows first (library items and groups), for its cover. */
export const coversOf = (media: PostMediaRef[]): AttachCover[] => media.flatMap((item) => item.kind === 'media' || item.kind === 'group' ? [{ kind: item.kind, ref: item.ref }] : [])

/** A thumbnail that falls back to the document icon (a video without a poster yet, a removed item). */
function CoverImage({ cover, className }: { cover: AttachCover; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className={cn('flex items-center justify-center bg-surface-high text-muted-foreground', className)}><FileText className="size-5" /></span>
  return <img src={coverSrc(cover)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className={cn('object-cover', className)} />
}

function PostCover({ post, show }: { post: PostSummary; show: boolean }) {
  const covers = show ? coversOf(post.media) : []
  const extra = post.mediaCount - Math.min(covers.length, 2)
  return (
    <span className="relative grid h-[66px] w-[88px] shrink-0 grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-0.5 overflow-hidden rounded-sm bg-surface-high">
      {covers.length === 0 ? <span className="flex items-center justify-center text-muted-foreground"><FileText className="size-5" /></span>
        : covers.slice(0, 2).map((cover) => <CoverImage key={`${cover.kind}:${cover.ref}`} cover={cover} className="size-full" />)}
      {covers.length > 0 && extra > 0 ? <span className="absolute bottom-1 right-1 rounded-sm bg-backdrop px-1 text-2xs leading-4 text-white tabular-nums">+{extra}</span> : null}
    </span>
  )
}

function KnowledgeBadge({ post }: { post: PostSummary }) {
  const { t } = useI18n()
  const knowledge = post.knowledge
  if (post.status === 'draft') return <Badge variant="warning">{t({ ko: '초안', en: 'Draft' })}</Badge>
  if (!knowledge?.enabled || knowledge.deletedAt) return null
  const verified = knowledge.reviewStatus === 'verified' && knowledge.verifiedContentVersion === knowledge.contentVersion
  return verified ? <Badge variant="success">{t({ ko: '검증됨', en: 'Verified' })}</Badge> : <Badge variant="secondary">{t({ ko: '지식', en: 'Knowledge' })}</Badge>
}

/** Board posts: categories on the left, rows with a cover on the right; card or link decides how they go in. */
export function AttachPostsTab({ selected, setSelected, postStyle, onPostStyleChange }: {
  selected: AttachItem[]; setSelected: Dispatch<SetStateAction<AttachItem[]>>
  postStyle: PostInsertStyle; onPostStyleChange: (style: PostInsertStyle) => void
}) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const { canViewImages } = usePostPermissions()
  const categoriesQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'categories'], queryFn: listPostCategories })
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const [scope, setScope] = useState<Scope>({ kind: 'all' })
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [input])
  const query = useInfiniteQuery({
    queryKey: [POSTS_QUERY_KEY, 'attach-picker', scope, search],
    initialPageParam: { offset: 0, snapshot: undefined as string | undefined },
    queryFn: ({ pageParam }) => listPosts({
      q: search || null, limit: PAGE, offset: pageParam.offset, snapshot: pageParam.snapshot,
      categoryId: scope.kind === 'category' ? scope.id : null, kind: scope.kind === 'knowledge' ? 'knowledge' : undefined,
    }),
    getNextPageParam: (last) => last.offset + last.items.length < last.total && last.items.length > 0 ? { offset: last.offset + last.items.length, snapshot: last.snapshot } : undefined,
  })
  const posts = useMemo(() => [...new Map((query.data?.pages.flatMap((page) => page.items) ?? []).map((post) => [post.id, post])).values()], [query.data])
  const orderByKey = new Map(selected.map((item, index) => [item.key, index + 1]))
  const toggle = (post: PostSummary) => setSelected((current) => current.some((item) => item.key === attachKey.post(post.id))
    ? current.filter((item) => item.key !== attachKey.post(post.id))
    : [...current, { kind: 'post', key: attachKey.post(post.id), id: post.id, title: post.title, cover: canViewImages ? coversOf(post.media)[0] ?? null : null }])

  const navButton = (active: boolean, onClick: () => void, icon: ReactNode, label: string) => (
    <Button variant="nav" size="sm" className="w-full px-2" data-active={active ? 'true' : undefined} aria-current={active ? 'true' : undefined} onClick={onClick}>
      {icon}<span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </Button>
  )
  const side = (
    <div className="space-y-1">
      {navButton(scope.kind === 'all', () => setScope({ kind: 'all' }), <Newspaper className="text-muted-foreground" />, t({ ko: '전체 글', en: 'All posts' }))}
      {navButton(scope.kind === 'knowledge', () => setScope({ kind: 'knowledge' }), <BookOpen className="text-muted-foreground" />, t({ ko: '지식 문서', en: 'Knowledge' }))}
      {categories.length ? <div className="border-t border-line pt-1">
        <HierarchyNav<PostCategory>
          items={categories} expandable selectedId={scope.kind === 'category' ? scope.id : null}
          onSelect={(category) => setScope({ kind: 'category', id: category.id })}
          getId={(category) => category.id} getParentId={(category) => category.parentId}
          sortItems={(left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)}
          getLabel={(category) => <span className="flex min-w-0 items-center justify-between gap-2"><span className="truncate">{category.name}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{category.postCount}</span></span>}
        />
      </div> : null}
    </div>
  )

  return (
    <AttachPanes side={side}>
      <AttachToolbar>
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={input} onChange={(event) => setInput(event.target.value)} aria-label={t({ ko: '게시물 찾기', en: 'Find posts' })} placeholder={t({ ko: '제목·본문', en: 'Title or text' })} />
        </div>
        <SegmentedControl ariaLabel={t({ ko: '넣는 모양', en: 'Insert as' })} value={postStyle} onChange={(value) => onPostStyleChange(value as PostInsertStyle)} items={[
          { value: 'card', label: t({ ko: '카드', en: 'Card' }) },
          { value: 'link', label: t({ ko: '링크', en: 'Link' }) },
        ]} />
      </AttachToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {query.isPending ? <div className="flex justify-center py-8"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div>
          : query.isError && !posts.length ? <div role="alert" className="flex flex-col items-center gap-2 py-8 text-sm text-destructive">
            {getErrorMessage(query.error, t({ ko: '게시물을 불러오지 못했어.', en: 'Could not load posts.' }))}
            <Button variant="ghost" onClick={() => void query.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button>
          </div>
          : !posts.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t({ ko: '찾은 글이 없어', en: 'No matching posts' })}</p>
          : posts.map((post) => {
            const position = orderByKey.get(attachKey.post(post.id))
            const path = categoryPath(categories, post.categoryId)
            return (
              <ListRow key={post.id} asChild interactive size="lg" selected={Boolean(position)} className="gap-3.5"
                leading={<PostCover post={post} show={canViewImages} />}
                trailing={<span className={cn('flex size-5 items-center justify-center rounded-full text-2xs font-bold tabular-nums', position ? 'bg-primary text-primary-foreground' : 'border-2 border-outline-input')}>{position ?? null}</span>}>
                <button type="button" aria-pressed={Boolean(position)} onClick={() => toggle(post)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold"><Highlight text={post.title} term={search} /></span>
                  {post.excerpt ? <span className="mt-0.5 block truncate text-xs text-muted-foreground"><Highlight text={post.excerpt} term={search} /></span> : null}
                  <span className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                    <span className="min-w-0 truncate">{[path, post.author.name, relative(post.publishedAt ?? post.updatedAt), post.commentCount ? t({ ko: '댓글 {count}', en: '{count} comments' }, { count: post.commentCount }) : ''].filter(Boolean).join(' · ')}</span>
                    <KnowledgeBadge post={post} />
                  </span>
                </span>
                </button>
              </ListRow>
            )
          })}
        <LoadMoreSentinel enabled={Boolean(query.hasNextPage) && !query.isFetchingNextPage} onVisible={() => void query.fetchNextPage()} />
        {query.isFetchingNextPage ? <div className="flex justify-center py-3"><Spinner /></div> : null}
      </div>
    </AttachPanes>
  )
}
