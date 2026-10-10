import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { PostCategory, PostListLayout, PostSummary } from '@conai/shared'
import { ArrowLeft, EyeOff, FileClock, FolderPlus, History, LayoutGrid, Newspaper, Pencil, PenSquare, Rows3, Search, Smartphone, Trash2, X } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, createPostComment, deletePost, getPost, getPostsSettings, listPostCategories, listPostComments, listPosts, listPostTags } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { PostCategoryDialog } from './post-category-dialog'
import { flattenCategories, PostEditor } from './post-editor'
import { EMPTY_COMMENT_DRAFT, type PostCommentDraft } from './post-comments'
import { PostCards, PostFeed, PostSns } from './post-list'
import { PostRevisionsDialog } from './post-revisions-dialog'
import { categoryPath, PostView } from './post-view'
import { usePostPermissions } from './use-post-permissions'
import { usePostsLayout } from './use-posts-layout'

const PAGE_SIZE = 20
type StatusFilter = 'draft' | 'hidden' | null
type CategoryDialog = { category: PostCategory | null; parentId: number | null } | null

/**
 * /posts — the posts board. Search params: `category`, `tag`, `status` (draft / hidden) filter the list,
 * `post` opens one post, `edit` (`new` or a post id) opens the editor.
 */
export function PostsPage() {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const permissions = usePostPermissions()
  const categoryId = Number(params.get('category')) || null
  const tag = params.get('tag') || null
  const statusParam = params.get('status')
  const status: StatusFilter = statusParam === 'draft' || statusParam === 'hidden' ? statusParam : null
  const postId = Number(params.get('post')) || null
  const edit = params.get('edit')
  const editId = edit && edit !== 'new' ? Number(edit) || null : null
  const view: 'list' | 'post' | 'edit' = edit ? 'edit' : postId ? 'post' : 'list'

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog>(null)
  const [revisionsOpen, setRevisionsOpen] = useState(false)

  const settingsQuery = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const [layout, setLayout] = usePostsLayout(settingsQuery.data?.layout ?? 'feed')
  const categoriesQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'categories'], queryFn: listPostCategories })
  const tagsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'tags'], queryFn: listPostTags })
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const listFilter = { categoryId, tag, q: searchOpen ? searchQuery : '', status: status ?? 'published' as const }
  const listQuery = useInfiniteQuery({
    queryKey: [POSTS_QUERY_KEY, 'list', listFilter],
    queryFn: ({ pageParam }) => listPosts({ ...listFilter, offset: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled: view === 'list',
  })
  const posts = useMemo(() => listQuery.data?.pages.flatMap((page) => page.items) ?? [], [listQuery.data])
  const postQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'post', postId ?? editId], queryFn: () => getPost((postId ?? editId) as number), enabled: (view === 'post' && postId !== null) || editId !== null, retry: false })

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    setParams(next)
  }
  const openList = (patch: Record<string, string | null> = {}) => update({ post: null, edit: null, comment: null, ...patch })
  // A search hit found through a comment opens at that comment.
  const openPost = (post: Pick<PostSummary, 'id' | 'matchedComment'>) => update({ post: String(post.id), edit: null, comment: post.matchedComment ? String(post.matchedComment.id) : null })
  const filterTag = (value: string) => openList({ tag: value })
  const filterCategory = (id: number | null) => openList({ category: id === null ? null : String(id), tag: null, status: null })

  const removePost = useMutation({
    mutationFn: (id: number) => deletePost(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
      openList()
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '글을 지우지 못했어.', en: 'Could not delete the post.' })) }),
  })

  // The open post's comment boxes (see PostCommentDraft): held here so the connected chat can read and draft them.
  const [commentDraft, setCommentDraft] = useState<PostCommentDraft>(EMPTY_COMMENT_DRAFT)
  useEffect(() => { setCommentDraft(EMPTY_COMMENT_DRAFT) }, [postId])
  const openPostData = view === 'post' ? postQuery.data ?? null : null
  const commentsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'comments', postId], queryFn: () => listPostComments(postId as number), enabled: openPostData !== null })
  const visibleComments = (commentsQuery.data?.comments ?? []).filter((comment) => comment.status === 'visible')
  const canCommentHere = openPostData !== null && permissions.canComment && (openPostData.commentMode === 'open' || permissions.isAdmin)
  const submitComment = useMutation({
    mutationFn: async (target: 'comment' | 'reply') => {
      const reply = target === 'reply' ? commentDraft.reply : null
      const body = (reply ? reply.text : commentDraft.top).trim()
      if (!openPostData || !body) throw new Error(t({ ko: '올릴 댓글 내용이 없어.', en: 'There is no comment to post.' }))
      return createPostComment(openPostData.id, { body, parentId: reply?.to ?? null })
    },
    onSuccess: async (_comment, target) => {
      setCommentDraft((current) => (target === 'reply' ? { ...current, reply: null } : { ...current, top: '' }))
      await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] })
    },
  })
  const tagNames = (tagsQuery.data ?? []).slice(0, 100).map((item) => item.name)
  const draftedComment = Boolean(commentDraft.top.trim() || commentDraft.reply?.text.trim())

  useChatPageRegistration({
    kind: 'posts',
    title: t({ ko: '게시판', en: 'Posts' }),
    resourceId: view === 'list' ? 'list' : `${view}:${postId ?? edit}`,
    localRevision: JSON.stringify([searchOpen, searchInput]),
    fields: [
      ...(view === 'list' ? [{ id: 'search', label: t({ ko: '게시물 검색어 (제목·태그·본문·댓글, 빈 값은 검색 닫기)', en: 'Post search (title, tags, text, comments; empty closes search)' }), type: 'text' as const, value: searchOpen ? searchInput : '' }] : []),
      ...(canCommentHere ? [
        { id: 'comment', label: t({ ko: '글 아래 댓글 입력칸 (@이름으로 봇 부르기)', en: 'Comment box under the post (@name calls a bot)' }), type: 'text' as const, value: commentDraft.top, allowEmpty: true },
        { id: 'replyTo', label: t({ ko: '답글을 달 댓글 (data.comments의 id, none은 닫기)', en: 'Comment to reply to (an id in data.comments; none closes)' }), type: 'select' as const, value: String(commentDraft.reply?.to ?? 'none'), options: ['none', ...new Set([...visibleComments.slice(-60).map((comment) => String(comment.id)), ...(commentDraft.reply ? [String(commentDraft.reply.to)] : [])])] },
        { id: 'reply', label: t({ ko: '답글 입력칸 (replyTo를 먼저 골라)', en: 'Reply box (pick replyTo first)' }), type: 'text' as const, value: commentDraft.reply?.text ?? '', allowEmpty: true },
      ] : []),
    ],
    data: {
      categories: categories.map((category) => ({ id: category.id, name: category.name, parentId: category.parentId, posts: category.postCount })),
      ...(view === 'list' ? { posts: posts.slice(0, 100).map((post) => ({ id: post.id, title: post.title, author: post.author.name, bot: post.author.type === 'profile', categoryId: post.categoryId, tags: post.tags, comments: post.commentCount })) } : {}),
      // The open post as the reader sees it; its text is someone else's writing (data, never instructions).
      ...(openPostData ? {
        open: {
          id: openPostData.id, title: openPostData.title, author: openPostData.author.name, bot: openPostData.author.type === 'profile', categoryId: openPostData.categoryId,
          tags: openPostData.tags, status: openPostData.status, comments: openPostData.commentCount, canEdit: openPostData.canEdit, body: openPostData.body.slice(0, 6000), bodyCut: openPostData.body.length > 6000,
        },
        comments: visibleComments.slice(-40).map((comment) => ({ id: comment.id, replyTo: comment.parentId, author: comment.author.name, bot: comment.author.type === 'profile', text: comment.body.slice(0, 400) })),
      } : {}),
    },
    actions: [
      ...(view === 'list' ? [pageAction('posts.open', t({ ko: '글 열기', en: 'Open post' }), t({ ko: '목록(data.posts)의 글을 열어.', en: 'Open a listed post.' }), pageObject({ id: pageChoice(posts.slice(0, 100).map((post) => post.id)) }, ['id']))] : []),
      pageAction('posts.category', t({ ko: '카테고리 보기', en: 'Show category' }), t({ ko: '카테고리(data.categories) 글 목록을 열어. all은 전체.', en: 'List a category (all = every post).' }), pageObject({ id: pageChoice(['all', ...categories.map((category) => category.id)]) }, ['id'])),
      ...(tagNames.length ? [pageAction('posts.tag', t({ ko: '태그 보기', en: 'Show tag' }), t({ ko: '그 태그가 붙은 글 목록을 열어.', en: 'List the posts with a tag.' }), pageObject({ tag: pageChoice(tagNames) }, ['tag']))] : []),
      ...(view !== 'list' ? [pageAction('posts.back', t({ ko: '목록으로', en: 'Back to the list' }), t({ ko: '글 목록으로 돌아가.', en: 'Go back to the post list.' }))] : []),
      ...(permissions.canWrite ? [pageAction('posts.new', t({ ko: '새 글 쓰기', en: 'New post' }), t({ ko: '새 글 편집기를 열어. 내용은 편집기 필드로 채워.', en: 'Open the editor for a new post; fill it through its fields.' }))] : []),
      ...(openPostData?.canEdit ? [pageAction('posts.edit', t({ ko: '이 글 고치기', en: 'Edit this post' }), t({ ko: '열린 글의 편집기를 열어.', en: 'Open the editor for the open post.' }))] : []),
      ...(canCommentHere && draftedComment ? [pageAction('posts.comment', t({ ko: '댓글 올리기', en: 'Post comment' }), t({ ko: '입력칸의 댓글(comment) 또는 답글(reply)을 올려.', en: 'Post the drafted comment or reply.' }), pageObject({ target: pageChoice(['comment', 'reply']) }, ['target']), 'save')] : []),
    ],
    apply: (patch) => {
      if (patch.search !== undefined) {
        const value = String(patch.search)
        setSearchInput(value)
        setSearchOpen(value.trim() !== '')
        if (value.trim()) openList()
      }
      if (patch.comment !== undefined) setCommentDraft((current) => ({ ...current, top: String(patch.comment) }))
      if (patch.replyTo !== undefined) {
        const to = patch.replyTo === 'none' ? null : Number(patch.replyTo)
        setCommentDraft((current) => ({ ...current, reply: to === null ? null : { to, text: current.reply?.to === to ? current.reply.text : '' } }))
      }
      if (patch.reply !== undefined) setCommentDraft((current) => (current.reply ? { ...current, reply: { ...current.reply, text: String(patch.reply) } } : current))
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'posts.open') openPost({ id: Number(args.id) })
      else if (id === 'posts.category') filterCategory(args.id === 'all' ? null : Number(args.id))
      else if (id === 'posts.tag') filterTag(String(args.tag))
      else if (id === 'posts.back') openList()
      else if (id === 'posts.new') update({ edit: 'new', post: null, comment: null })
      else if (id === 'posts.edit' && postId) update({ edit: String(postId) })
      else if (id === 'posts.comment') await submitComment.mutateAsync(args.target === 'reply' ? 'reply' : 'comment')
      else throw new Error('게시판에 없는 작업이야.')
    },
  }, { preserveOnSearchChange: true })

  const flat = useMemo(() => flattenCategories(categories), [categories])
  const sidebar = (
    <SidebarNav aria-label={t({ ko: '게시판', en: 'Posts' })}>
      <SidebarItem icon={Newspaper} label={t({ ko: '전체', en: 'All posts' })} active={view === 'list' && !categoryId && !tag && !status} onClick={() => filterCategory(null)} />
      {permissions.canWrite ? <SidebarItem icon={FileClock} label={t({ ko: '내 초안', en: 'My drafts' })} active={status === 'draft'} onClick={() => openList({ status: 'draft', category: null, tag: null })} /> : null}
      {permissions.isAdmin ? <SidebarItem icon={EyeOff} label={t({ ko: '숨긴 글', en: 'Hidden posts' })} active={status === 'hidden'} onClick={() => openList({ status: 'hidden', category: null, tag: null })} /> : null}
      <SidebarGroupLabel actions={permissions.isAdmin ? (
        <IconButton size="icon-xs" variant="ghost" label={t({ ko: '새 카테고리', en: 'New category' })} onClick={() => setCategoryDialog({ category: null, parentId: categoryId })}><FolderPlus /></IconButton>
      ) : undefined}>{t({ ko: '카테고리', en: 'Categories' })}</SidebarGroupLabel>
      {flat.map(({ category, depth }) => (
        <SidebarItem
          key={category.id}
          asChild
          depth={depth}
          label={category.name}
          count={category.postCount || undefined}
          active={categoryId === category.id && view === 'list'}
          className="group"
          onClick={() => filterCategory(category.id)}
          trailing={permissions.isAdmin ? (
            <IconButton size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" label={t({ ko: '카테고리 고치기', en: 'Edit category' })} onClick={(event) => { event.stopPropagation(); setCategoryDialog({ category, parentId: category.parentId }) }}><Pencil /></IconButton>
          ) : undefined}
        >
          <div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') filterCategory(category.id) }} />
        </SidebarItem>
      ))}
      {tagsQuery.data?.length ? (
        <>
          <SidebarGroupLabel>{t({ ko: '태그', en: 'Tags' })}</SidebarGroupLabel>
          <div className="flex flex-wrap gap-1 px-2.5 pb-2">
            {tagsQuery.data.slice(0, 40).map((item) => (
              <ToggleChip key={item.name} size="sm" pressed={tag?.toLowerCase() === item.name.toLowerCase()} onClick={() => filterTag(item.name)}>#{item.name}</ToggleChip>
            ))}
          </div>
        </>
      ) : null}
    </SidebarNav>
  )

  const closeSearch = () => { setSearchOpen(false); setSearchInput('') }
  const crumbs = categoryPath(categories, categoryId)
  let toolbarStart
  let toolbarActions
  if (view === 'list') {
    toolbarStart = searchOpen ? (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input autoFocus variant="settings" className="min-w-0 flex-1" aria-label={t({ ko: '글 검색', en: 'Search posts' })} value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') closeSearch() }} />
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '검색 닫기', en: 'Close search' })} onClick={closeSearch}><X /></IconButton>
      </div>
    ) : (
      <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label={t({ ko: '현재 위치', en: 'Current location' })}>
        <Button variant="ghost" size="sm" className={cn('px-2', !(crumbs.length || status) && 'font-semibold')} onClick={() => filterCategory(null)}>{t({ ko: '게시판', en: 'Posts' })}</Button>
        {status ? <><span className="text-muted-foreground">›</span><span className="px-1 font-semibold">{status === 'draft' ? t({ ko: '내 초안', en: 'My drafts' }) : t({ ko: '숨긴 글', en: 'Hidden posts' })}</span></> : null}
        {crumbs.map((category, index) => (
          <span key={category.id} className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">›</span>
            <Button variant="ghost" size="sm" className={cn('max-w-48 px-2', index === crumbs.length - 1 && 'font-semibold')} onClick={() => filterCategory(category.id)}><span className="truncate">{category.name}</span></Button>
          </span>
        ))}
        {tag ? (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-primary/15 pl-2 pr-0.5 text-xs leading-6 text-primary">
            #{tag}
            <IconButton size="icon-xs" variant="ghost" className="size-5 rounded-full text-primary hover:bg-primary/20 hover:text-primary" label={t({ ko: '태그 필터 빼기', en: 'Clear tag filter' })} onClick={() => openList({ tag: null })}><X /></IconButton>
          </span>
        ) : null}
      </nav>
    )
    toolbarActions = (
      <>
        <SegmentedControl
          size="xs"
          value={layout}
          onChange={(value) => setLayout(value as PostListLayout)}
          ariaLabel={t({ ko: '목록 모양', en: 'Layout' })}
          items={[
            { value: 'feed', label: <Rows3 className="size-3.5" />, ariaLabel: t({ ko: '피드', en: 'Feed' }) },
            { value: 'cards', label: <LayoutGrid className="size-3.5" />, ariaLabel: t({ ko: '카드', en: 'Cards' }) },
            { value: 'sns', label: <Smartphone className="size-3.5" />, ariaLabel: t({ ko: 'SNS', en: 'SNS' }) },
          ]}
        />
        {!searchOpen ? <IconButton variant="ghost" label={t({ ko: '검색', en: 'Search' })} onClick={() => setSearchOpen(true)}><Search /></IconButton> : null}
        {permissions.canWrite ? <IconButton variant="default" label={t({ ko: '새 글', en: 'New post' })} onClick={() => update({ edit: 'new', post: null })}><PenSquare /></IconButton> : null}
      </>
    )
  } else {
    const back = () => (view === 'edit' && editId ? update({ edit: null, post: String(editId) }) : openList())
    toolbarStart = (
      <div className="flex min-w-0 items-center gap-1">
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '뒤로', en: 'Back' })} onClick={back}><ArrowLeft /></IconButton>
        <span className="truncate text-sm font-semibold">
          {view === 'edit' ? (editId ? t({ ko: '글 고치기', en: 'Edit post' }) : t({ ko: '새 글', en: 'New post' })) : postQuery.data?.title ?? ''}
        </span>
      </div>
    )
    toolbarActions = view === 'post' && postQuery.data?.canEdit ? (
      <>
        {postQuery.data.revision > 1 ? <IconButton variant="ghost" label={t({ ko: '이전 판', en: 'Earlier versions' })} onClick={() => setRevisionsOpen(true)}><History /></IconButton> : null}
        <IconButton variant="ghost" label={t({ ko: '고치기', en: 'Edit' })} onClick={() => update({ edit: String(postQuery.data.id) })}><Pencil /></IconButton>
        <IconButton variant="ghost" label={t({ ko: '지우기', en: 'Delete' })} disabled={removePost.isPending} onClick={async () => {
          if (await confirm({ title: t({ ko: '이 글을 지울까?', en: 'Delete this post?' }), description: t({ ko: '댓글도 함께 지워져.', en: 'Its comments go too.' }), tone: 'destructive' })) removePost.mutate(postQuery.data.id)
        }}><Trash2 /></IconButton>
      </>
    ) : null
  }

  let content
  if (view === 'edit') {
    if (editId && postQuery.isPending) content = <LoadingState />
    else if (editId && postQuery.isError) content = <ErrorState title={t({ ko: '글을 불러오지 못했어.', en: 'Could not load the post.' })} error={postQuery.error} />
    else content = (
      <PostEditor key={editId ?? 'new'} post={editId ? postQuery.data ?? null : null} categories={categories} defaultCategoryId={categoryId}
        onCancel={() => (editId ? update({ edit: null, post: String(editId) }) : openList())}
        onSaved={(saved) => update({ edit: null, post: String(saved.id) })} />
    )
  } else if (view === 'post') {
    if (postQuery.isPending) content = <LoadingState />
    else if (postQuery.isError) content = <EmptyState icon={Newspaper} title={t({ ko: '글을 찾을 수 없어', en: 'Post not found' })} />
    else content = <PostView post={postQuery.data} categories={categories} onTag={filterTag} onCategory={filterCategory} commentDraft={commentDraft} setCommentDraft={setCommentDraft} />
  } else if (listQuery.isPending) {
    content = <LoadingState />
  } else if (listQuery.isError) {
    content = <ErrorState title={t({ ko: '글 목록을 불러오지 못했어.', en: 'Could not load posts.' })} error={listQuery.error} onRetry={() => void listQuery.refetch()} />
  } else if (posts.length === 0) {
    content = <EmptyState icon={searchOpen && searchQuery ? Search : Newspaper} title={searchOpen && searchQuery ? t({ ko: '찾은 글이 없어', en: 'No matching posts' }) : t({ ko: '아직 글이 없어', en: 'No posts yet' })} />
  } else {
    const listProps = { posts, categories, onOpen: openPost, onTag: filterTag }
    content = (
      <>
        {layout === 'sns' ? <PostSns {...listProps} onReachEnd={() => { if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) void listQuery.fetchNextPage() }} />
          : layout === 'cards' ? <PostCards {...listProps} /> : <PostFeed {...listProps} />}
        {layout !== 'sns' && listQuery.hasNextPage ? (
          <div className="flex justify-center pt-4">
            <Button variant="ghost" size="sm" disabled={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <>
      <PageWithSidebar
        storageKey="posts"
        sidebarLabel={t({ ko: '게시판', en: 'Posts' })}
        sidebar={sidebar}
        toolbar={<PageToolbar sticky start={toolbarStart} actions={toolbarActions} />}
      >
        {content}
      </PageWithSidebar>
      {revisionsOpen && view === 'post' && postQuery.data ? <PostRevisionsDialog post={postQuery.data} onClose={() => setRevisionsOpen(false)} /> : null}
      {categoryDialog ? (
        <PostCategoryDialog
          category={categoryDialog.category}
          parentId={categoryDialog.parentId}
          categories={categories}
          onClose={() => setCategoryDialog(null)}
          onDeleted={(deleted) => { if (categoryId === deleted.id) filterCategory(deleted.parentId) }}
        />
      ) : null}
    </>
  )
}
