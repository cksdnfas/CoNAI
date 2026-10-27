import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { PostCategory, PostKnowledgeReviewStatus, PostListLayout, PostSummary } from '@conai/shared'
import { ArrowLeft, ChevronDown, ChevronRight, FolderPlus, LayoutGrid, Newspaper, Pencil, PenSquare, Rows3, Search, Smartphone, Trash2, Undo2, X } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { LoadingState, Spinner } from '@/components/ui/loading-state'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { TextTabs } from '@/components/common/text-tabs'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageFreeText, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, invalidatePostScope, cancelPostBotRun, createPostCategory, createPostComment, deletePost, deletePostCategory, deletePostComment, getPost, getPostRevision, getPostsSettings, listPostCategories, listPostRevisionSummaries, listPosts, listPostTags, restorePostKnowledge, setPostCommentHidden, updatePost, updatePostCategory, updatePostComment } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { PostCategoryDialog } from './post-category-dialog'
import { flattenCategories, PostEditor } from './post-editor'
import { EMPTY_COMMENT_DRAFT, type PostCommentDraft } from './post-comments'
import { PostActions } from './post-actions'
import { LoadMoreSentinel } from './post-attach-shared'
import { PostCards, PostFeed, PostSns } from './post-list'
import { categoryPath, PostView } from './post-view'
import { usePostPermissions } from './use-post-permissions'
import { usePostsCollapsedCategories, usePostsLayout } from './use-posts-layout'
import { useKnowledgeSearchHint } from './post-knowledge-list'
import { PostKnowledgeProposals } from './post-knowledge-proposals'
import { parseKnowledgeSearchContext, type KnowledgeSearchContext } from './post-knowledge-task-fit'
import { PostKnowledgePermanentDeleteDialog } from './post-knowledge-permanent-delete'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { PostCommentsContext, usePostComments } from './use-post-comments'

const PAGE_SIZE = 20
/** How much of a long post body the connected chat reads at a time (posts.body_at moves through it). */
const BODY_CHUNK = 2000
type StatusFilter = 'draft' | 'hidden' | null
type CategoryDialog = { category: PostCategory | null; parentId: number | null } | null
/** The text tabs over the list; they apply inside the chosen category. */
type ListTab = 'all' | 'knowledge' | 'draft' | 'trash' | 'hidden'
const TAB_PARAMS: Record<ListTab, Record<string, string | null>> = {
  all: { kind: null, section: null, status: null, review: null },
  knowledge: { kind: 'knowledge', section: null, status: null, review: null },
  draft: { kind: null, section: null, status: 'draft', review: null },
  trash: { kind: 'knowledge', section: 'trash', status: null, review: null },
  hidden: { kind: null, section: null, status: 'hidden', review: null },
}

/**
 * /posts — the posts board. Search params: `category` and `tag` narrow the list; the list tab is `kind=knowledge`
 * (with `review` = a review state, or `section=proposals`), `status` (draft / hidden) or `section=trash`. `post` opens
 * one post, `edit` (`new` or a post id) opens the editor.
 */
export function PostsPage() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const permissions = usePostPermissions()
  const knowledgeSearchContext = parseKnowledgeSearchContext((location.state as { knowledgeSearchContext?: unknown } | null)?.knowledgeSearchContext)
  const categoryId = Number(params.get('category')) || null
  const tag = params.get('tag') || null
  const statusParam = params.get('status')
  const status: StatusFilter = statusParam === 'draft' || statusParam === 'hidden' ? statusParam : null
  const knowledgeOnly = params.get('kind') === 'knowledge'
  const knowledgeSection = params.get('section')
  const section = knowledgeSection === 'review' || knowledgeSection === 'proposals' || knowledgeSection === 'trash' ? knowledgeSection : null
  const reviewParam = params.get('review')
  // `section=review` (the old 재검토 목록 link) is the 재검토 필요 chip.
  const reviewStatus: PostKnowledgeReviewStatus | undefined = section === 'review' ? 'needs_review' : reviewParam === 'unreviewed' || reviewParam === 'verified' || reviewParam === 'needs_review' ? reviewParam : undefined
  const tab: ListTab = section === 'trash' ? 'trash' : status === 'draft' ? 'draft' : status === 'hidden' ? 'hidden' : knowledgeOnly ? 'knowledge' : 'all'
  const proposalsView = tab === 'knowledge' && section === 'proposals'
  const postId = Number(params.get('post')) || null
  const edit = params.get('edit')
  const editId = edit && edit !== 'new' ? Number(edit) || null : null
  const view: 'list' | 'post' | 'edit' = edit ? 'edit' : postId ? 'post' : 'list'

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const searchQuery = useDebouncedValue(searchInput.trim())
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog>(null)
  const [permanentDeletePost, setPermanentDeletePost] = useState<PostSummary | null>(null)

  const settingsQuery = useQuery({ queryKey: ['post-settings'], queryFn: getPostsSettings, staleTime: 60_000 })
  const [layout, setLayout] = usePostsLayout(settingsQuery.data?.layout ?? 'feed')
  const [collapsedCategories, toggleCategory] = usePostsCollapsedCategories()
  const categoriesQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'categories'], queryFn: listPostCategories })
  const tagsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'tags'], queryFn: listPostTags })
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const knowledgeEnabled = settingsQuery.data?.knowledge.enabled !== false
  const knowledgeSearchHint = useKnowledgeSearchHint(searchOpen && tab === 'knowledge')
  const knowledgeList = tab === 'knowledge' && !proposalsView
  // Reviewers see drafts and hidden documents waiting for review too (as the review queue does).
  const listStatus = tab === 'trash' || (knowledgeList && reviewStatus === 'needs_review' && permissions.canReview) ? 'all' as const : status ?? 'published' as const
  const listFilter = { categoryId, tag, q: searchOpen ? searchQuery : '', status: listStatus,
    ...(knowledgeList ? { kind: 'knowledge' as const, reviewStatus, sort: 'relevance' as const } : {}), ...(tab === 'trash' ? { kind: 'knowledge' as const, deleted: 'only' as const } : {}) }
  const listQuery = useInfiniteQuery({
    queryKey: [POSTS_QUERY_KEY, 'list', permissions.viewerKey, listFilter],
    queryFn: ({ pageParam }) => listPosts({ ...listFilter, ...pageParam, limit: PAGE_SIZE }),
    initialPageParam: { offset: 0, snapshot: undefined as string | undefined },
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? { offset: last.offset + last.items.length, snapshot: last.snapshot } : undefined),
    enabled: view === 'list' && !proposalsView,
  })
  const posts = useMemo(() => listQuery.data?.pages.flatMap((page) => page.items) ?? [], [listQuery.data])
  const postQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'post', permissions.viewerKey, postId ?? editId], queryFn: () => getPost((postId ?? editId) as number), enabled: (view === 'post' && postId !== null) || editId !== null, retry: false })

  const update = (patch: Record<string, string | null>, searchContext: KnowledgeSearchContext | null = null) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { state: searchContext ? { knowledgeSearchContext: searchContext } : null })
  }
  const openList = (patch: Record<string, string | null> = {}) => update({ post: null, edit: null, comment: null, ...patch })
  // A search hit found through a comment opens at that comment.
  const openPost = (post: Pick<PostSummary, 'id' | 'matchedComment' | 'knowledge' | 'knowledgeSearchReceipt'>) => {
    const searchContext: KnowledgeSearchContext | null = post.knowledge?.enabled && post.knowledgeSearchReceipt ? {
      viewerKey: permissions.viewerKey, postId: post.id, contentVersion: post.knowledge.contentVersion,
      contentHash: post.knowledge.contentHash, receipt: post.knowledgeSearchReceipt,
    } : null
    update({ post: String(post.id), edit: null, comment: post.matchedComment ? String(post.matchedComment.id) : null }, searchContext)
  }
  const filterTag = (value: string) => openList({ tag: value })
  // The list tab stays when the category changes: 초안 in 일러스트, then 초안 in 잡담.
  const filterCategory = (id: number | null) => openList({ category: id === null ? null : String(id), tag: null })
  const openTab = (next: ListTab) => openList(TAB_PARAMS[next])
  const restoreTrash = useMutation({
    mutationFn: (post: Pick<PostSummary, 'id' | 'revision'>) => restorePostKnowledge(post.id, post.revision),
    onSuccess: (_result, post) => invalidatePostScope(queryClient, post.id, 'post'),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '문서를 복원하지 못했어.', en: 'Could not restore the document.' })) }),
  })

  // The open post's comment boxes (see PostCommentDraft): held here so the connected chat can read and draft them.
  const [commentDraft, setCommentDraft] = useState<PostCommentDraft>(EMPTY_COMMENT_DRAFT)
  useEffect(() => { setCommentDraft(EMPTY_COMMENT_DRAFT) }, [postId])
  // Where the connected chat reads the open post's body from, when it is longer than one chunk.
  const [bodyOffset, setBodyOffset] = useState(0)
  useEffect(() => { setBodyOffset(0) }, [postId])
  const [commentOffset, setCommentOffset] = useState<number | null>(null)
  useEffect(() => { setCommentOffset(null) }, [postId])
  const openPostData = view === 'post' ? postQuery.data ?? null : null
  const commentData = usePostComments(postId, [Number(params.get('comment')), commentDraft.reply?.to, commentDraft.edit?.id].filter((id): id is number => typeof id === 'number' && id > 0), openPostData !== null && !openPostData.knowledge?.deletedAt)
  const visibleComments = commentData.comments.filter((comment) => comment.status === 'visible')
  // Hidden comments still show to administrators (and their writers), so the chat can show them again.
  const shownComments = commentData.comments.filter((comment) => comment.status !== 'deleted')
  const editableComments = shownComments.filter((comment) => comment.canEdit)
  const activeRuns = commentData.runs.filter((run) => run.status === 'queued' || run.status === 'running')
  const moreReplyThreadIds = [...commentData.moreReplies].flatMap(([parentId, cursor]) => cursor ? [parentId] : []).slice(0, 100)
  const canRestore = openPostData?.canEdit === true && !openPostData.knowledge && openPostData.revision > 1
  const revisionsQuery = useQuery({ queryKey: [POSTS_QUERY_KEY, 'revisions', postId, openPostData?.revision, 'summary'], queryFn: ({ signal }) => listPostRevisionSummaries(postId as number, signal), enabled: canRestore })
  const revisions = canRestore ? revisionsQuery.data ?? [] : []
  const canCommentHere = openPostData !== null && !openPostData.knowledge?.deletedAt && permissions.canComment && (openPostData.commentMode === 'open' || permissions.isAdmin)
  const submitComment = useMutation({
    mutationFn: async (target: 'comment' | 'reply') => {
      const reply = target === 'reply' ? commentDraft.reply : null
      const body = (reply ? reply.text : commentDraft.top).trim()
      if (!openPostData || !body) throw new Error(t({ ko: '올릴 댓글 내용이 없어.', en: 'There is no comment to post.' }))
      return createPostComment(openPostData.id, { body, parentId: reply?.to ?? null })
    },
    onSuccess: async (comment, target) => {
      setCommentDraft((current) => (target === 'reply' ? { ...current, reply: null } : { ...current, top: '' }))
      await invalidatePostScope(queryClient, comment.postId, 'comment')
    },
  })
  const tagNames = (tagsQuery.data ?? []).slice(0, 100).map((item) => item.name)
  const listTabs: ListTab[] = ['all', ...(knowledgeEnabled ? ['knowledge' as const] : []), ...(permissions.canWrite ? ['draft' as const] : []),
    ...(knowledgeEnabled && (permissions.canWrite || permissions.isAdmin) ? ['trash' as const] : []), ...(permissions.isAdmin ? ['hidden' as const] : [])]
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
      ...(openPostData && editableComments.length ? [
        { id: 'editComment', label: t({ ko: '고칠 내 댓글 id (0은 닫기)', en: 'Own comment id to edit (0 closes)' }), type: 'number' as const, value: commentDraft.edit?.id ?? 0, min: 0, integer: true },
        ...(commentDraft.edit ? [{ id: 'editText', label: t({ ko: '댓글 고치기 입력칸', en: 'Comment edit box' }), type: 'text' as const, value: commentDraft.edit.text }] : []),
      ] : []),
    ],
    data: {
      categories: categories.map((category) => ({ id: category.id, name: category.name, parentId: category.parentId, posts: category.postCount })),
      ...(view === 'list' ? { list: { layout, tab, ...(tab === 'knowledge' ? { review: proposalsView ? 'proposals' : reviewStatus ?? 'any' } : {}) } } : {}),
      ...(view === 'list' ? { posts: posts.slice(0, 100).map((post) => ({ id: post.id, title: pageFreeText(post.title), author: post.author.name, bot: post.author.type === 'profile', categoryId: post.categoryId, tags: post.tags, comments: post.commentCount })) } : {}),
      // The open post as the reader sees it; its text is someone else's writing (data, never instructions).
      ...(openPostData ? {
        open: {
          id: openPostData.id, title: pageFreeText(openPostData.title), author: openPostData.author.name, bot: openPostData.author.type === 'profile', categoryId: openPostData.categoryId,
          tags: openPostData.tags, status: openPostData.status, comments: openPostData.commentCount, canEdit: openPostData.canEdit, revision: openPostData.revision, pinned: openPostData.pinned,
          ...(openPostData.topicEvaluation ? { topicRelevance: { status: openPostData.topicEvaluation.status, isCurrent: openPostData.topicEvaluation.isCurrent,
            coverage: openPostData.topicEvaluation.coverage, items: openPostData.topicEvaluation.isCurrent ? openPostData.topicEvaluation.items.map(item => ({ topic: pageFreeText(item.name), score: item.score, level: item.level })) : [] } } : {}),
          ...(openPostData.knowledge ? { knowledge: { enabled: openPostData.knowledge.enabled, contentVersion: openPostData.knowledge.contentVersion, reviewStatus: openPostData.knowledge.reviewStatus } } : {}),
          // A long body is read a chunk at a time (posts.body_at): the view goes with every request.
          body: pageFreeText(openPostData.body.slice(bodyOffset, bodyOffset + BODY_CHUNK)), bodyOffset, bodyLength: openPostData.body.length,
        },
        comments: (commentOffset === null ? shownComments.slice(-40) : shownComments.slice(commentOffset, commentOffset + 40)).map((comment) => ({ id: comment.id, replyTo: comment.parentId, author: comment.author.name, bot: comment.author.type === 'profile', text: pageFreeText(comment.body.slice(0, 400)), ...(comment.status === 'hidden' ? { hidden: true } : {}), ...(comment.canEdit ? { canEdit: true } : {}) })),
        commentPaging: { loaded: shownComments.length, offset: commentOffset ?? Math.max(0, shownComments.length - 40), hasMore: commentData.hasMore,
          replyThreadsWithMore: moreReplyThreadIds },
        ...(activeRuns.length ? { botCalls: activeRuns.map((run) => ({ id: run.id, bot: run.profileName, status: run.status, triggerCommentId: run.triggerCommentId })) } : {}),
        ...(revisions.length ? { earlierVersions: revisions.slice(0, 10).map((revision) => ({ revision: revision.revision, title: pageFreeText(revision.title), at: revision.createdAt })) } : {}),
      } : {}),
    },
    actions: [
      ...(view === 'list' && posts.length ? [pageAction('posts.open', t({ ko: '글 열기', en: 'Open post' }), t({ ko: '목록(data.posts)의 글을 열어.', en: 'Open a listed post.' }), pageObject({ id: pageChoice(posts.slice(0, 100).map((post) => post.id)) }, ['id']))] : []),
      pageAction('posts.category', t({ ko: '카테고리 보기', en: 'Show category' }), t({ ko: '카테고리(data.categories) 글 목록을 열어. all은 전체.', en: 'List a category (all = every post).' }), pageObject({ id: pageChoice(['all', ...categories.map((category) => String(category.id))]) }, ['id'])),
      ...(tagNames.length ? [pageAction('posts.tag', t({ ko: '태그 보기', en: 'Show tag' }), t({ ko: '그 태그가 붙은 글 목록을 열어.', en: 'List the posts with a tag.' }), pageObject({ tag: pageChoice(tagNames) }, ['tag']))] : []),
      ...(view !== 'list' ? [pageAction('posts.back', t({ ko: '목록으로', en: 'Back to the list' }), t({ ko: '글 목록으로 돌아가.', en: 'Go back to the post list.' }))] : []),
      ...(permissions.canWrite ? [pageAction('posts.new', t({ ko: '새 글 쓰기', en: 'New post' }), t({ ko: '새 글 편집기를 열어. 내용은 편집기 필드로 채워.', en: 'Open the editor for a new post; fill it through its fields.' }))] : []),
      ...(openPostData?.canEdit && !openPostData.knowledge ? [pageAction('posts.edit', t({ ko: '이 글 고치기', en: 'Edit this post' }), t({ ko: '열린 글의 편집기를 열어.', en: 'Open the editor for the open post.' }))] : []),
      ...(canCommentHere && draftedComment ? [pageAction('posts.comment', t({ ko: '댓글 올리기', en: 'Post comment' }), t({ ko: '입력칸의 댓글(comment) 또는 답글(reply)을 올려.', en: 'Post the drafted comment or reply.' }), pageObject({ target: pageChoice(['comment', 'reply']) }, ['target']), 'save')] : []),
      ...(view === 'list' ? [
        pageAction('posts.layout', t({ ko: '목록 모양', en: 'List layout' }), '', pageObject({ layout: pageChoice(['feed', 'cards', 'sns']) }, ['layout'])),
        pageAction('posts.filter', t({ ko: '목록 탭', en: 'List tab' }), t({ ko: '고른 카테고리 안에서 바꿔', en: 'Within the chosen category' }), pageObject({ tab: pageChoice(listTabs) }, ['tab'])),
      ] : []),
      ...(openPostData && openPostData.body.length > BODY_CHUNK ? [pageAction('posts.body_at', t({ ko: '본문 이어 읽기', en: 'Read the body from' }), t({ ko: 'data.open.body를 offset부터 보여줘', en: 'data.open.body from offset' }), pageObject({ offset: pageNumber(0, Math.max(0, openPostData.body.length - 1), true) }, ['offset']))] : []),
      ...(openPostData ? [
        pageAction('posts.comments_at', t({ ko: '댓글 구간 읽기', en: 'Read loaded comments' }), t({ ko: '불러온 댓글의 offset부터 40개를 읽어.', en: 'Read forty loaded comments from offset.' }), pageObject({ offset: pageNumber(0, Math.max(0, shownComments.length - 1), true) }, ['offset'])),
        ...(commentData.hasMore || moreReplyThreadIds.length ? [pageAction('posts.comments_more', t({ ko: '이전 댓글 불러오기', en: 'Load earlier comments' }), t({ ko: 'parentId 생략은 이전 댓글, 지정하면 그 스레드의 이전 답글.', en: 'Omit parentId for older threads, or select a thread for older replies.' }), pageObject(moreReplyThreadIds.length ? { parentId: pageChoice(moreReplyThreadIds) } : {}))] : []),
      ] : []),
      ...(openPostData?.canEdit && !openPostData.knowledge ? [pageAction('posts.delete', t({ ko: '이 글 지우기', en: 'Delete this post' }), '', undefined, 'save')] : []),
      ...(revisions.length && !openPostData?.knowledge ? [pageAction('posts.restore_revision', t({ ko: '이전 판으로 되돌리기', en: 'Restore earlier version' }), t({ ko: 'data.earlierVersions의 판', en: 'a version in data.earlierVersions' }), pageObject({ revision: pageNumber(1, undefined, true) }, ['revision']), 'save')] : []),
      ...(commentDraft.edit && commentDraft.edit.text.trim() ? [pageAction('posts.comment_update', t({ ko: '고친 댓글 저장', en: 'Save edited comment' }), '', undefined, 'save')] : []),
      ...(editableComments.length ? [pageAction('posts.comment_delete', t({ ko: '내 댓글 지우기', en: 'Delete own comment' }), '', pageObject({ id: pageNumber(1, undefined, true) }, ['id']), 'save')] : []),
      ...(permissions.isAdmin && shownComments.length ? [pageAction('posts.comment_hide', t({ ko: '댓글 숨기기·보이기', en: 'Hide or show comment' }), '', pageObject({ id: pageNumber(1, undefined, true), hidden: { type: 'boolean' } }, ['id', 'hidden']), 'save')] : []),
      ...(activeRuns.length ? [pageAction('posts.bot_cancel', t({ ko: '봇 호출 취소', en: 'Cancel bot call' }), t({ ko: 'data.botCalls의 id', en: 'an id in data.botCalls' }), pageObject({ id: pageNumber(1, undefined, true) }, ['id']), 'save')] : []),
      ...(permissions.isAdmin && view === 'list' ? [
        pageAction('posts.category_create', t({ ko: '카테고리 만들기', en: 'Create category' }), t({ ko: 'parentId 0은 최상위', en: 'parentId 0 = top level' }), pageObject({ name: pageText(100), parentId: pageNumber(0, undefined, true), description: pageText(500) }, ['name']), 'save'),
        ...(categories.length ? [
          pageAction('posts.category_update', t({ ko: '카테고리 고치기', en: 'Edit category' }), t({ ko: '빠진 항목은 그대로, parentId 0은 최상위', en: 'Left-out fields stay; parentId 0 = top level' }), pageObject({ id: pageNumber(1, undefined, true), name: pageText(100), parentId: pageNumber(0, undefined, true), description: pageText(500) }, ['id']), 'save'),
          pageAction('posts.category_delete', t({ ko: '빈 카테고리 지우기', en: 'Delete empty category' }), '', pageObject({ id: pageNumber(1, undefined, true) }, ['id']), 'save'),
        ] : []),
      ] : []),
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
      if (patch.editComment !== undefined) {
        const id = Number(patch.editComment) || null
        const target = editableComments.find((comment) => comment.id === id)
        setCommentDraft((current) => ({ ...current, edit: target ? { id: target.id, text: current.edit?.id === target.id ? current.edit.text : target.body } : null }))
      }
      if (patch.editText !== undefined) setCommentDraft((current) => (current.edit ? { ...current, edit: { ...current.edit, text: String(patch.editText) } } : current))
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'posts.open') openPost({ id: Number(args.id) })
      else if (id === 'posts.category') filterCategory(args.id === 'all' ? null : Number(args.id))
      else if (id === 'posts.tag') filterTag(String(args.tag))
      else if (id === 'posts.back') openList()
      else if (id === 'posts.new') update({ edit: 'new', post: null, comment: null })
      else if (id === 'posts.edit' && postId && !openPostData?.knowledge) update({ edit: String(postId) })
      else if (id === 'posts.comment') await submitComment.mutateAsync(args.target === 'reply' ? 'reply' : 'comment')
      else if (id === 'posts.layout') setLayout(args.layout as PostListLayout)
      else if (id === 'posts.filter' && listTabs.includes(args.tab as ListTab)) openTab(args.tab as ListTab)
      else if (id === 'posts.body_at') setBodyOffset(Number(args.offset))
      else if (id === 'posts.comments_at') setCommentOffset(Number(args.offset))
      else if (id === 'posts.comments_more') {
        if (typeof args.parentId === 'number') await commentData.loadMoreReplies(args.parentId)
        else await commentData.loadMore()
        setCommentOffset(0)
      }
      else if (id === 'posts.delete' && openPostData && !openPostData.knowledge) {
        await deletePost(openPostData.id)
        await invalidatePostScope(queryClient, openPostData.id, 'post')
        openList()
      } else if (id === 'posts.restore_revision' && openPostData && !openPostData.knowledge) {
        const selected = revisions.find((item) => item.revision === Number(args.revision))
        if (!selected) throw new Error('그 판을 찾을 수 없어.')
        const revision = await getPostRevision(openPostData.id, selected.revision)
        assertCurrent()
        await updatePost(openPostData.id, { title: revision.title, body: revision.body, expectedRevision: openPostData.revision })
        await invalidatePostScope(queryClient, openPostData.id, 'post')
      } else if (id === 'posts.comment_update' && commentDraft.edit) {
        const comment = editableComments.find((item) => item.id === commentDraft.edit?.id)
        if (!comment) throw new Error('고칠 댓글을 찾을 수 없어.')
        await updatePostComment(comment.id, { body: commentDraft.edit.text.trim(), expectedRevision: comment.revision })
        setCommentDraft((current) => ({ ...current, edit: null }))
        await invalidatePostScope(queryClient, comment.postId, 'comment')
      } else if (id === 'posts.comment_delete') {
        if (!editableComments.some((comment) => comment.id === Number(args.id))) throw new Error('지울 수 있는 댓글이 아니야.')
        await deletePostComment(Number(args.id))
        await invalidatePostScope(queryClient, postId, 'comment')
      } else if (id === 'posts.comment_hide') {
        if (!shownComments.some((comment) => comment.id === Number(args.id))) throw new Error('이 글에 없는 댓글이야.')
        await setPostCommentHidden(Number(args.id), args.hidden === true)
        await invalidatePostScope(queryClient, postId, 'comment')
      } else if (id === 'posts.bot_cancel') {
        if (!activeRuns.some((run) => run.id === Number(args.id))) throw new Error('답하는 중인 봇 호출이 아니야.')
        await cancelPostBotRun(Number(args.id))
        await invalidatePostScope(queryClient, postId, 'bot-run')
      } else if (id === 'posts.category_create') {
        await createPostCategory({ name: String(args.name), parentId: Number(args.parentId) || null, ...(typeof args.description === 'string' ? { description: args.description } : {}) })
        await invalidatePostScope(queryClient, null, 'category')
      } else if (id === 'posts.category_update') {
        await updatePostCategory(Number(args.id), {
          ...(typeof args.name === 'string' ? { name: args.name } : {}),
          ...(args.parentId !== undefined ? { parentId: Number(args.parentId) || null } : {}),
          ...(typeof args.description === 'string' ? { description: args.description } : {}),
        })
        await invalidatePostScope(queryClient, null, 'category')
      } else if (id === 'posts.category_delete') {
        const deleted = categories.find((category) => category.id === Number(args.id))
        await deletePostCategory(Number(args.id))
        await invalidatePostScope(queryClient, null, 'category')
        if (deleted && categoryId === deleted.id) filterCategory(deleted.parentId)
      } else throw new Error('게시판에 없는 작업이야.')
    },
  }, { preserveOnSearchChange: true })

  const flat = useMemo(() => flattenCategories(categories), [categories])
  const parentIds = useMemo(() => new Set(categories.map((category) => category.parentId).filter((id): id is number => id !== null)), [categories])
  const byCategoryId = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  // A category shows unless one of its parents is folded.
  const shownCategories = flat.filter(({ category }) => {
    for (let parent = category.parentId === null ? undefined : byCategoryId.get(category.parentId); parent; parent = parent.parentId === null ? undefined : byCategoryId.get(parent.parentId)) {
      if (collapsedCategories.has(parent.id)) return false
    }
    return true
  })
  const categoryEntries = (category: PostCategory): ActionMenuEntry[] => permissions.isAdmin ? [
    { key: 'edit', icon: Pencil, label: t({ ko: '카테고리 고치기', en: 'Edit category' }), onSelect: () => setCategoryDialog({ category, parentId: category.parentId }) },
    { key: 'child', icon: FolderPlus, label: t({ ko: '하위 카테고리 만들기', en: 'New subcategory' }), onSelect: () => setCategoryDialog({ category: null, parentId: category.id }) },
  ] : []
  const sidebar = (
    <SidebarNav aria-label={t({ ko: '게시판', en: 'Posts' })}>
      <SidebarItem icon={Newspaper} label={t({ ko: '전체', en: 'All posts' })} active={view === 'list' && !categoryId && !tag} onClick={() => filterCategory(null)} />
      {categories.length || permissions.isAdmin ? <SidebarGroupLabel actions={permissions.isAdmin ? (
        <IconButton size="icon-xs" variant="ghost" label={t({ ko: '새 카테고리', en: 'New category' })} onClick={() => setCategoryDialog({ category: null, parentId: null })}><FolderPlus /></IconButton>
      ) : undefined}>{t({ ko: '카테고리', en: 'Categories' })}</SidebarGroupLabel> : null}
      {shownCategories.map(({ category, depth }) => {
        const folded = collapsedCategories.has(category.id)
        return (
          <ActionContextMenu key={category.id} entries={categoryEntries(category)}>
            <SidebarItem
              asChild
              depth={depth}
              label={(
                <span className="flex min-w-0 items-center gap-1.5">
                  {parentIds.has(category.id) ? (
                    <IconButton variant="ghost" size="icon-xs" tooltip={false} className="size-4 min-w-0 shrink-0"
                      label={folded ? t({ ko: '펼치기', en: 'Expand' }) : t({ ko: '접기', en: 'Collapse' })} aria-expanded={!folded}
                      onClick={(event) => { event.stopPropagation(); event.preventDefault(); toggleCategory(category.id) }}>
                      {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </IconButton>
                  ) : <span className="size-4 shrink-0" />}
                  <span className="truncate">{category.name}</span>
                </span>
              )}
              count={category.postCount || undefined}
              active={categoryId === category.id && view === 'list'}
              onClick={() => filterCategory(category.id)}
            >
              <div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') filterCategory(category.id) }} />
            </SidebarItem>
          </ActionContextMenu>
        )
      })}
    </SidebarNav>
  )

  const closeSearch = () => { setSearchOpen(false); setSearchInput('') }
  // `#tag` in the search box picks a tag filter (the box suggests the board's tags).
  const pickTag = (value: string) => {
    const name = value.trim().replace(/^#/, '').toLowerCase()
    const found = (tagsQuery.data ?? []).find((item) => item.name.toLowerCase() === name)
    if (!value.trim().startsWith('#') || !found) return false
    closeSearch()
    filterTag(found.name)
    return true
  }
  const crumbs = categoryPath(categories, categoryId)
  const LayoutIcon = layout === 'cards' ? LayoutGrid : layout === 'sns' ? Smartphone : Rows3
  const layoutEntries: ActionMenuEntry[] = [
    { key: 'feed', label: t({ ko: '피드', en: 'Feed' }), checked: layout === 'feed', onSelect: () => setLayout('feed') },
    { key: 'cards', label: t({ ko: '카드', en: 'Cards' }), checked: layout === 'cards', onSelect: () => setLayout('cards') },
    { key: 'sns', label: t({ ko: 'SNS', en: 'SNS' }), checked: layout === 'sns', onSelect: () => setLayout('sns') },
  ]
  let toolbarStart
  let toolbarActions
  if (view === 'list') {
    toolbarStart = searchOpen ? (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input autoFocus variant="settings" className="min-w-0 flex-1" aria-label={t({ ko: '글 검색', en: 'Search posts' })} value={searchInput} list="post-tag-options"
          placeholder={knowledgeSearchHint ?? t({ ko: '검색 · #태그', en: 'Search · #tag' })}
          onChange={(event) => {
            // Picking a suggestion replaces the whole text at once: take it as the tag right away.
            if ((event.nativeEvent as InputEvent).inputType === 'insertReplacementText' && pickTag(event.target.value)) return
            setSearchInput(event.target.value)
          }}
          onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); if (event.key === 'Enter' && !event.nativeEvent.isComposing) pickTag(searchInput) }} />
        <datalist id="post-tag-options">
          {searchInput.trim().startsWith('#') ? tagNames.map((name) => <option key={name} value={`#${name}`} />) : null}
        </datalist>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '검색 닫기', en: 'Close search' })} onClick={closeSearch}><X /></IconButton>
      </div>
    ) : (
      <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label={t({ ko: '현재 위치', en: 'Current location' })}>
        <Button variant="ghost" size="sm" aria-current={!crumbs.length ? 'location' : undefined} onClick={() => filterCategory(null)}>{t({ ko: '게시판', en: 'Posts' })}</Button>
        {crumbs.map((category, index) => (
          <span key={category.id} className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">›</span>
            <Button variant="ghost" size="sm" className="max-w-48" aria-current={index === crumbs.length - 1 ? 'location' : undefined} onClick={() => filterCategory(category.id)}><span className="truncate">{category.name}</span></Button>
          </span>
        ))}
        {tag ? (
          <Chip tone="primary" className="ml-1" removeLabel={t({ ko: '태그 필터 빼기', en: 'Clear tag filter' })} onRemove={() => openList({ tag: null })}>#{tag}</Chip>
        ) : null}
      </nav>
    )
    toolbarActions = (
      <>
        {!proposalsView ? <ActionMenuButton size="icon" icon={LayoutIcon} entries={layoutEntries} label={t({ ko: '목록 모양', en: 'Layout' })} /> : null}
        {!searchOpen && !proposalsView ? <IconButton variant="ghost" label={t({ ko: '검색', en: 'Search' })} onClick={() => setSearchOpen(true)}><Search /></IconButton> : null}
        {permissions.canWrite ? <Button onClick={() => update({ edit: 'new', post: null })}><PenSquare />{t({ ko: '새 글', en: 'New post' })}</Button> : null}
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
    toolbarActions = view === 'post' && postQuery.isSuccess ? (
      <PostActions key={postQuery.data.id} post={postQuery.data} onEdit={() => update({ edit: String(postQuery.data.id) })} onGone={() => openList()} />
    ) : null
  }

  const tabLabels: Record<ListTab, string> = {
    all: t({ ko: '전체', en: 'All' }), knowledge: t({ ko: '지식', en: 'Knowledge' }), draft: t({ ko: '초안', en: 'Drafts' }),
    trash: t({ ko: '휴지통', en: 'Trash' }), hidden: t({ ko: '숨김', en: 'Hidden' }),
  }
  const reviewChips: Array<{ value: PostKnowledgeReviewStatus; label: string }> = [
    { value: 'needs_review', label: t({ ko: '재검토 필요', en: 'Needs review' }) },
    { value: 'unreviewed', label: t({ ko: '미검토', en: 'Unreviewed' }) },
    { value: 'verified', label: t({ ko: '검증됨', en: 'Verified' }) },
  ]
  const listHeader = view === 'list' && (listTabs.length > 1 || tab === 'knowledge') ? (
    <div className="flex flex-col gap-2.5 pb-3">
      {listTabs.length > 1 ? (
        <TextTabs value={tab} onChange={openTab} ariaLabel={t({ ko: '목록', en: 'List' })} items={listTabs.map((item) => ({ value: item, label: tabLabels[item] }))} />
      ) : null}
      {tab === 'knowledge' ? (
        <div className="flex flex-wrap gap-1.5">
          {reviewChips.map((chip) => (
            <ToggleChip key={chip.value} size="sm" pressed={!proposalsView && reviewStatus === chip.value} onClick={() => openList({ section: null, review: reviewStatus === chip.value && !proposalsView ? null : chip.value })}>{chip.label}</ToggleChip>
          ))}
          {permissions.canWrite || permissions.canReview ? (
            <ToggleChip size="sm" pressed={proposalsView} onClick={() => openList({ section: proposalsView ? null : 'proposals', review: null })}>{t({ ko: '변경 제안', en: 'Change proposals' })}</ToggleChip>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null

  const trashMenu = (post: PostSummary): ActionMenuEntry[] => post.canEdit ? [
    { key: 'restore', icon: Undo2, disabled: restoreTrash.isPending, label: t({ ko: '복원', en: 'Restore' }), onSelect: () => restoreTrash.mutate(post) },
    { key: 'purge', icon: Trash2, destructive: true, label: t({ ko: '영구 삭제', en: 'Delete permanently' }), onSelect: () => setPermanentDeletePost(post) },
  ] : []

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
    else content = <PostView post={postQuery.data} categories={categories} onTag={filterTag} onCategory={filterCategory} commentDraft={commentDraft} setCommentDraft={setCommentDraft} knowledgeSearchContext={knowledgeSearchContext} />
  } else if (proposalsView) {
    content = <PostKnowledgeProposals standalone />
  } else if (listQuery.isPending) {
    content = <LoadingState />
  } else if (listQuery.isError) {
    content = <ErrorState title={t({ ko: '글 목록을 불러오지 못했어.', en: 'Could not load posts.' })} error={listQuery.error} onRetry={() => void listQuery.refetch()} />
  } else if (posts.length === 0) {
    content = <EmptyState icon={searchOpen && searchQuery ? Search : tab === 'trash' ? Trash2 : Newspaper} title={searchOpen && searchQuery ? t({ ko: '찾은 글이 없어', en: 'No matching posts' }) : tab === 'trash' ? t({ ko: '휴지통이 비었어', en: 'The trash is empty' }) : t({ ko: '아직 글이 없어', en: 'No posts yet' })} description={searchOpen && searchQuery ? t({ ko: '다른 낱말이나 #태그로 찾아 봐.', en: 'Try other words or a #tag.' }) : tab === 'trash' ? undefined : t({ ko: '직접 쓴 글과 채팅 프로필(봇)이 쓴 글이 여기에 모여.', en: 'Posts you write and posts by chat profiles (bots) gather here.' })} action={!(searchOpen && searchQuery) && tab !== 'trash' && permissions.canWrite ? <Button size="sm" onClick={() => update({ edit: 'new', post: null })}><PenSquare />{t({ ko: '새 글', en: 'New post' })}</Button> : undefined} />
  } else {
    const listProps = tab === 'trash' ? { posts, categories, onOpen: () => undefined, onTag: filterTag, menu: trashMenu, menuOnClick: true } : { posts, categories, onOpen: openPost, onTag: filterTag }
    content = (
      <>
        {layout === 'sns' ? <PostSns {...listProps} onReachEnd={() => { if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) void listQuery.fetchNextPage() }} />
          : layout === 'cards' ? <PostCards {...listProps} /> : <PostFeed {...listProps} />}
        {/* Only the virtualized cards auto-load; the feed keeps an explicit button so its DOM grows on request. */}
        {layout === 'cards' ? <LoadMoreSentinel rootMargin="800px" enabled={Boolean(listQuery.hasNextPage) && !listQuery.isFetchingNextPage} onVisible={() => void listQuery.fetchNextPage()} /> : null}
        {layout === 'cards' && listQuery.isFetchingNextPage ? <div className="flex justify-center py-4"><Spinner /></div> : null}
        {layout === 'feed' && listQuery.hasNextPage ? (
          <div className="flex justify-center pt-4">
            <Button variant="ghost" size="sm" disabled={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <PostCommentsContext.Provider value={commentData}>
      <PageWithSidebar
        storageKey="posts"
        sidebarLabel={t({ ko: '게시판', en: 'Posts' })}
        sidebar={sidebar}
        toolbar={<PageToolbar sticky start={toolbarStart} actions={toolbarActions} />}
      >
        {listHeader}
        {content}
      </PageWithSidebar>
      {permanentDeletePost ? <PostKnowledgePermanentDeleteDialog key={permanentDeletePost.id} post={permanentDeletePost} onClose={() => setPermanentDeletePost(null)} /> : null}
      {categoryDialog ? (
        <PostCategoryDialog
          category={categoryDialog.category}
          parentId={categoryDialog.parentId}
          categories={categories}
          onClose={() => setCategoryDialog(null)}
          onDeleted={(deleted) => { if (categoryId === deleted.id) filterCategory(deleted.parentId) }}
        />
      ) : null}
    </PostCommentsContext.Provider>
  )
}
