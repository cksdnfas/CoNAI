import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
import { SidebarGroupLabel, SidebarNav } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getDanbooruBrowserArtists,
  getDanbooruBrowserCharacters,
  getDanbooruBrowserSummary,
  getDanbooruBrowserTags,
} from '@/lib/api-danbooru-browser'
import type { DanbooruBrowserDatabaseInfo, DanbooruBrowserRelatedTagCategory, DanbooruBrowserTreeNode } from '@/types/danbooru-browser'
import { useI18n } from '@/i18n'
import { useCanSeeServerDetails } from '../use-can-see-server-details'
import { PromptPageToolbar, type PromptPageToolbarBaseProps } from './prompt-page-toolbar'
import { SidebarTree } from './sidebar-tree'
import { ToolbarSearchField } from './toolbar-search-field'
import {
  CHARACTER_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_RELATED_TAG_LIMIT,
  FALLBACK_TREE,
  RELATED_TAG_CATEGORIES,
  ArtistsTable,
  CharacterRelatedTagOptionsPopup,
  CharactersTable,
  PaginationControls,
  TableLoading,
  TagsTable,
  formatCompactCount,
  getDefaultExpandedTreeIds,
  getDefaultRelatedTagOptions,
  getLocalizedTreeLabel,
  parseRelatedTagLimitInput,
  parseRelatedTagScoreInput,
  persistRelatedTagOptions,
  readStoredRelatedTagOptions,
  type DanbooruBrowserSelectedNode,
} from './prompt-danbooru-browser-panel-ui'

function DanbooruDatabaseMissingNotice({ database }: { database: DanbooruBrowserDatabaseInfo }) {
  const { t } = useI18n()
  const canSeeServerDetails = useCanSeeServerDetails()
  const filePatterns = database.filePatterns.join(', ')

  if (!canSeeServerDetails) {
    return (
      <Alert>
        <AlertTitle>{t({ ko: 'Danbooru 데이터가 아직 없어', en: 'Danbooru data is not installed yet' })}</AlertTitle>
        <AlertDescription>
          {t({ ko: '태그, 작가, 캐릭터 목록을 쓰려면 관리자가 Danbooru DB 파일을 설치해야 해.', en: 'An administrator needs to install the Danbooru DB file before tags, artists and characters can be browsed.' })}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert>
      <AlertTitle>{t({ ko: 'Danbooru DB 파일 없음', en: 'Danbooru DB file missing' })}</AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          <div className="grid gap-1 text-xs sm:grid-cols-[120px_minmax(0,1fr)]">
            <span className="font-medium text-muted-foreground">{t({ ko: '기본 경로', en: 'Default path' })}</span>
            <span className="min-w-0 break-all font-mono text-foreground">{database.expectedPath}</span>
            <span className="font-medium text-muted-foreground">{t({ ko: '허용 파일명', en: 'Accepted names' })}</span>
            <span className="min-w-0 break-all font-mono text-foreground">{filePatterns}</span>
            <span className="font-medium text-muted-foreground">{t({ ko: '다운로드', en: 'Download' })}</span>
            <a className="min-w-0 break-all text-primary underline-offset-4 hover:underline" href={database.downloadUrl} target="_blank" rel="noreferrer">{database.downloadUrl}</a>
          </div>
          <p className="text-xs">{t({ ko: '다른 위치를 쓰려면 DANBOORU_SQLITE_PATH 환경변수로 파일 경로를 지정해.', en: 'Set DANBOORU_SQLITE_PATH to use a file from another location.' })}</p>
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function PromptDanbooruBrowserPanel({ toolbarProps }: { toolbarProps: PromptPageToolbarBaseProps }) {
  const { language, t, formatNumber } = useI18n()
  const [selectedNodeId, setSelectedNodeId] = useState('tags')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [isRelatedTagOptionsOpen, setIsRelatedTagOptionsOpen] = useState(false)
  const [relatedTagCategories, setRelatedTagCategories] = useState<DanbooruBrowserRelatedTagCategory[]>(() => readStoredRelatedTagOptions().categories)
  const [relatedTagScoreMinInput, setRelatedTagScoreMinInput] = useState(() => readStoredRelatedTagOptions().scoreMinInput)
  const [relatedTagScoreMaxInput, setRelatedTagScoreMaxInput] = useState(() => readStoredRelatedTagOptions().scoreMaxInput)
  const [relatedTagLimitInput, setRelatedTagLimitInput] = useState(() => readStoredRelatedTagOptions().limitInput)
  const relatedTagOptionsAnchorRef = useRef<HTMLDivElement | null>(null)

  const summaryQuery = useQuery({
    queryKey: ['danbooru-browser-summary'],
    queryFn: getDanbooruBrowserSummary,
  })
  const database = summaryQuery.data?.database
  const isDanbooruDbAvailable = database?.available === true

  const tree = summaryQuery.data?.tree ?? FALLBACK_TREE
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of tree) {
      if (node.parentId) {
        counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1)
      }
    }
    return counts
  }, [tree])
  const selectedNode = useMemo<DanbooruBrowserSelectedNode>(() => {
    return tree.find((node) => node.id === selectedNodeId) ?? tree[0] ?? FALLBACK_TREE[0]
  }, [selectedNodeId, tree])
  const activeSection = selectedNode.section
  const categoryCode = activeSection === 'tags' ? selectedNode.filter?.categoryCode : undefined
  const taxonomyNodeId = activeSection === 'tags' ? selectedNode.filter?.taxonomyNodeId : undefined
  const copyrightTagId = activeSection === 'characters' ? selectedNode.filter?.copyrightTagId : undefined
  const currentLimit = activeSection === 'characters' ? CHARACTER_PAGE_SIZE : DEFAULT_PAGE_SIZE
  const relatedTagScoreMin = parseRelatedTagScoreInput(relatedTagScoreMinInput)
  const relatedTagScoreMax = parseRelatedTagScoreInput(relatedTagScoreMaxInput)
  const relatedTagLimit = parseRelatedTagLimitInput(relatedTagLimitInput)
  const relatedTagFilterActive = relatedTagCategories.length !== RELATED_TAG_CATEGORIES.length || relatedTagScoreMin !== undefined || relatedTagScoreMax !== undefined || relatedTagLimit !== DEFAULT_RELATED_TAG_LIMIT
  const defaultExpandedTreeIds = useMemo(() => getDefaultExpandedTreeIds(activeSection), [activeSection])

  useEffect(() => {
    setPage(1)
  }, [activeSection, categoryCode, taxonomyNodeId, copyrightTagId, searchQuery, relatedTagCategories, relatedTagScoreMin, relatedTagScoreMax, relatedTagLimit])

  useEffect(() => {
    persistRelatedTagOptions({
      categories: relatedTagCategories,
      scoreMinInput: relatedTagScoreMinInput,
      scoreMaxInput: relatedTagScoreMaxInput,
      limitInput: relatedTagLimitInput,
    })
  }, [relatedTagCategories, relatedTagScoreMinInput, relatedTagScoreMaxInput, relatedTagLimitInput])

  useEffect(() => {
    if (activeSection !== 'characters') {
      setIsRelatedTagOptionsOpen(false)
    }
  }, [activeSection])

  const tagsQuery = useQuery({
    queryKey: ['danbooru-browser-tags', searchQuery, categoryCode, taxonomyNodeId, page],
    queryFn: () => getDanbooruBrowserTags({ query: searchQuery, categoryCode, taxonomyNodeId, page, limit: currentLimit }),
    enabled: isDanbooruDbAvailable && activeSection === 'tags',
  })

  const artistsQuery = useQuery({
    queryKey: ['danbooru-browser-artists', searchQuery, page],
    queryFn: () => getDanbooruBrowserArtists({ query: searchQuery, page, limit: currentLimit }),
    enabled: isDanbooruDbAvailable && activeSection === 'artists',
  })

  const charactersQuery = useQuery({
    queryKey: ['danbooru-browser-characters', searchQuery, copyrightTagId, page, relatedTagCategories, relatedTagScoreMin, relatedTagScoreMax, relatedTagLimit],
    queryFn: () => getDanbooruBrowserCharacters({
      query: searchQuery,
      copyrightTagId,
      page,
      limit: CHARACTER_PAGE_SIZE,
      relatedTagCategories,
      relatedTagScoreMin,
      relatedTagScoreMax,
      relatedTagLimit,
    }),
    enabled: isDanbooruDbAvailable && activeSection === 'characters',
  })

  const activeQuery = activeSection === 'tags' ? tagsQuery : activeSection === 'artists' ? artistsQuery : charactersQuery
  const pagination = activeQuery.data?.pagination
  const activeItemCount = activeSection === 'tags'
    ? (tagsQuery.data?.items.length ?? 0)
    : activeSection === 'artists'
      ? (artistsQuery.data?.items.length ?? 0)
      : (charactersQuery.data?.items.length ?? 0)

  const tagItems = useMemo(() => tagsQuery.data?.items ?? [], [tagsQuery.data?.items])
  const artistItems = useMemo(() => artistsQuery.data?.items ?? [], [artistsQuery.data?.items])
  const characterItems = useMemo(() => charactersQuery.data?.items ?? [], [charactersQuery.data?.items])

  const handleSelectNode = useCallback((node: DanbooruBrowserTreeNode) => {
    setSelectedNodeId(node.id)
  }, [])

  const getNodeId = useCallback((node: DanbooruBrowserTreeNode) => node.id, [])

  const getNodeParentId = useCallback((node: DanbooruBrowserTreeNode) => node.parentId, [])

  const getNodeLabel = useCallback((node: DanbooruBrowserTreeNode) => getLocalizedTreeLabel(node, language), [language])

  const getNodeCount = useCallback((node: DanbooruBrowserTreeNode) => {
    const hasChildren = (childCountByParentId.get(node.id) ?? 0) > 0
    if (hasChildren && node.directCount !== undefined) {
      return node.directCount === 0
        ? `(${formatCompactCount(node.count, formatNumber)})`
        : `${formatCompactCount(node.directCount, formatNumber)}(${formatCompactCount(node.count, formatNumber)})`
    }
    return formatCompactCount(node.count, formatNumber)
  }, [childCountByParentId, formatNumber])

  const sortTreeItems = useCallback((left: DanbooruBrowserTreeNode, right: DanbooruBrowserTreeNode) => {
    const rootOrder: Record<string, number> = { artists: 0, tags: 1, characters: 2 }
    const leftIsRoot = left.parentId === null
    const rightIsRoot = right.parentId === null
    if (leftIsRoot || rightIsRoot) {
      return (rootOrder[left.id] ?? 99) - (rootOrder[right.id] ?? 99)
    }

    const leftLabel = getLocalizedTreeLabel(left, language)
    const rightLabel = getLocalizedTreeLabel(right, language)
    const leftIsUnclassified = left.label.toLowerCase() === 'unclassified'
    const rightIsUnclassified = right.label.toLowerCase() === 'unclassified'
    if (leftIsUnclassified !== rightIsUnclassified) return leftIsUnclassified ? -1 : 1

    return leftLabel.localeCompare(rightLabel, ['ko', 'en'], { numeric: true, sensitivity: 'base' })
  }, [language])

  const handleApplySearch = useCallback(() => {
    setSearchQuery(searchInput.trim())
  }, [searchInput])

  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    setSearchQuery('')
  }, [])

  const handleToggleRelatedTagOptionsOpen = useCallback(() => {
    setIsRelatedTagOptionsOpen((open) => !open)
  }, [])

  const handleCloseRelatedTagOptions = useCallback(() => {
    setIsRelatedTagOptionsOpen(false)
  }, [])

  const handleToggleRelatedTagCategory = useCallback((category: DanbooruBrowserRelatedTagCategory) => {
    setRelatedTagCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : RELATED_TAG_CATEGORIES.filter((item) => item === category || current.includes(item))
    ))
  }, [])

  const handleResetRelatedTagOptions = useCallback(() => {
    const defaults = getDefaultRelatedTagOptions()
    setRelatedTagCategories(defaults.categories)
    setRelatedTagScoreMinInput(defaults.scoreMinInput)
    setRelatedTagScoreMaxInput(defaults.scoreMaxInput)
    setRelatedTagLimitInput(defaults.limitInput)
  }, [])

  const sidebar = (
    <SidebarNav>
      <SidebarGroupLabel>Danbooru DB</SidebarGroupLabel>
      {summaryQuery.isLoading ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="my-0.5 h-8 w-full rounded-sm" />) : null}
      {summaryQuery.isError ? (
        <Alert variant="destructive" className="mt-2">
          <AlertTitle>{t({ ko: 'DB 요약 로드 실패', en: 'Failed to load DB summary' })}</AlertTitle>
          <AlertDescription>{summaryQuery.error instanceof Error ? summaryQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
        </Alert>
      ) : null}
      {!summaryQuery.isLoading && !summaryQuery.isError ? (
        <SidebarTree
          key={activeSection}
          items={tree}
          defaultExpandedIds={defaultExpandedTreeIds}
          selectedId={selectedNodeId}
          onSelect={handleSelectNode}
          getId={getNodeId}
          getParentId={getNodeParentId}
          getLabel={getNodeLabel}
          getCount={getNodeCount}
          sortItems={sortTreeItems}
        />
      ) : null}
    </SidebarNav>
  )

  return (
    <PageWithSidebar
      storageKey="prompts"
      sidebarLabel="Danbooru DB"
      sidebar={sidebar}
      toolbar={(
        <PromptPageToolbar
          {...toolbarProps}
          actions={activeSection === 'characters' ? (
            <div ref={relatedTagOptionsAnchorRef}>
              <IconButton
                variant="ghost"
                size="icon-sm"
                active={relatedTagFilterActive || isRelatedTagOptionsOpen}
                onClick={handleToggleRelatedTagOptionsOpen}
                label={t({ ko: 'Related tags 표시 옵션', en: 'Related tags display options' })}
                aria-haspopup="dialog"
                aria-expanded={isRelatedTagOptionsOpen}
              >
                <SlidersHorizontal />
              </IconButton>
            </div>
          ) : undefined}
        >
          <ToolbarSearchField
            value={searchInput}
            placeholder={t({ ko: '검색', en: 'Search' })}
            onChange={setSearchInput}
            onSubmit={handleApplySearch}
            onClear={handleClearSearch}
          />
        </PromptPageToolbar>
      )}
    >
      <div className="space-y-4">
        <CharacterRelatedTagOptionsPopup
          open={activeSection === 'characters' && isRelatedTagOptionsOpen}
          anchorRef={relatedTagOptionsAnchorRef}
          selectedCategories={relatedTagCategories}
          scoreMinInput={relatedTagScoreMinInput}
          scoreMaxInput={relatedTagScoreMaxInput}
          limitInput={relatedTagLimitInput}
          onClose={handleCloseRelatedTagOptions}
          onToggleCategory={handleToggleRelatedTagCategory}
          onScoreMinInputChange={setRelatedTagScoreMinInput}
          onScoreMaxInputChange={setRelatedTagScoreMaxInput}
          onLimitInputChange={setRelatedTagLimitInput}
          onReset={handleResetRelatedTagOptions}
        />

        {isDanbooruDbAvailable && activeQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '목록 로드 실패', en: 'Failed to load rows' })}</AlertTitle>
            <AlertDescription>{activeQuery.error instanceof Error ? activeQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
          </Alert>
        ) : null}

        {isDanbooruDbAvailable && activeQuery.isLoading ? <TableLoading columns={activeSection === 'characters' ? 6 : activeSection === 'artists' ? 3 : 2} /> : null}

        {!summaryQuery.isLoading && !summaryQuery.isError && database && !isDanbooruDbAvailable ? <DanbooruDatabaseMissingNotice database={database} /> : null}

        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'tags' ? <TagsTable items={tagItems} language={language} /> : null}
        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'artists' ? <ArtistsTable items={artistItems} language={language} /> : null}
        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'characters' ? <CharactersTable items={characterItems} language={language} /> : null}

        {isDanbooruDbAvailable ? <PaginationControls pagination={pagination} visibleCount={activeItemCount} onPageChange={setPage} /> : null}
      </div>
    </PageWithSidebar>
  )
}
