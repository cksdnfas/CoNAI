import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderOpen, Search, SlidersHorizontal, X } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getDanbooruBrowserArtists,
  getDanbooruBrowserCharacters,
  getDanbooruBrowserSummary,
  getDanbooruBrowserTags,
} from '@/lib/api-danbooru-browser'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { DanbooruBrowserRelatedTagCategory } from '@/types/danbooru-browser'
import { useI18n } from '@/i18n'
import {
  CHARACTER_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_RELATED_TAG_LIMIT,
  FALLBACK_TREE,
  RELATED_TAG_CATEGORIES,
  ArtistsTable,
  CharacterRelatedTagOptionsPopup,
  CharactersTable,
  MissingDanbooruDatabaseNotice,
  PaginationControls,
  TableLoading,
  TagsTable,
  formatCompactK,
  getDefaultExpandedTreeIds,
  getDefaultRelatedTagOptions,
  getLocalizedTreeLabel,
  getSectionTitle,
  parseRelatedTagLimitInput,
  parseRelatedTagScoreInput,
  persistRelatedTagOptions,
  readStoredRelatedTagOptions,
  type DanbooruBrowserSelectedNode,
} from './prompt-danbooru-browser-panel-ui'

export function PromptDanbooruBrowserPanel() {
  const { language, t } = useI18n()
  const isDesktopPageLayout = useDesktopPageLayout()
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
  const currentCount = pagination?.total ?? selectedNode.count

  const handleApplySearch = () => {
    setSearchQuery(searchInput.trim())
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
  }

  const handleToggleRelatedTagCategory = (category: DanbooruBrowserRelatedTagCategory) => {
    setRelatedTagCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : RELATED_TAG_CATEGORIES.filter((item) => item === category || current.includes(item))
    ))
  }

  const handleResetRelatedTagOptions = () => {
    const defaults = getDefaultRelatedTagOptions()
    setRelatedTagCategories(defaults.categories)
    setRelatedTagScoreMinInput(defaults.scoreMinInput)
    setRelatedTagScoreMaxInput(defaults.scoreMaxInput)
    setRelatedTagLimitInput(defaults.limitInput)
  }

  return (
    <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-1')}>
      <ExplorerSidebar
        title="Danbooru DB"
        badge={<Badge variant="outline">{formatCompactK(summaryQuery.data?.counts.tags ?? 0)}</Badge>}
        floatingFrame
        floatingLockStorageKey="conai:prompts:danbooru-sidebar-locked"
        className={cn('sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
        bodyClassName="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
      >
        {summaryQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full rounded-sm" />
            ))}
          </div>
        ) : null}

        {summaryQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: 'DB 요약 로드 실패', en: 'Failed to load DB summary' })}</AlertTitle>
            <AlertDescription>{summaryQuery.error instanceof Error ? summaryQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
          </Alert>
        ) : null}

        {!summaryQuery.isLoading && !summaryQuery.isError ? (
          <HierarchyNav
            key={activeSection}
            items={tree}
            expandable
            defaultExpandedIds={defaultExpandedTreeIds}
            selectedId={selectedNodeId}
            onSelect={(node) => setSelectedNodeId(node.id)}
            getId={(node) => node.id}
            getParentId={(node) => node.parentId}
            getLabel={(node) => {
              const hasChildren = (childCountByParentId.get(node.id) ?? 0) > 0
              const countLabel = hasChildren && node.directCount !== undefined
                ? node.directCount === 0
                  ? `(${formatCompactK(node.count)})`
                  : `${formatCompactK(node.directCount)}(${formatCompactK(node.count)})`
                : formatCompactK(node.count)

              return (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <span className="min-w-0 truncate">{getLocalizedTreeLabel(node, language)}</span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{countLabel}</span>
                </div>
              )
            }}
            sortItems={(left, right) => {
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
            }}
            renderIcon={(_node, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
          />
        ) : null}
      </ExplorerSidebar>

      <section className="relative z-0 space-y-4">
        <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{getSectionTitle(selectedNode, language)}</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              {t({ ko: '{count}개 표시 가능', en: '{count} available' }, { count: formatCompactK(currentCount) })}
              {activeSection === 'characters' ? <span> · {t({ ko: '페이지당 30개', en: '30 per page' })}</span> : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px]">
            <div className="flex gap-2">
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleApplySearch()
                }}
                placeholder={t({ ko: '검색', en: 'Search' })}
              />
              <Button size="sm" variant="outline" onClick={handleApplySearch}>
                <Search className="h-4 w-4" />
              </Button>
              {activeSection === 'characters' ? (
                <div ref={relatedTagOptionsAnchorRef}>
                  <Button
                    size="sm"
                    variant={relatedTagFilterActive ? 'default' : 'outline'}
                    onClick={() => setIsRelatedTagOptionsOpen((open) => !open)}
                    title={t({ ko: 'Related tags 표시 옵션', en: 'Related tags display options' })}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              {searchQuery ? (
                <Button size="sm" variant="ghost" onClick={handleClearSearch}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <CharacterRelatedTagOptionsPopup
          open={activeSection === 'characters' && isRelatedTagOptionsOpen}
          anchorRef={relatedTagOptionsAnchorRef}
          selectedCategories={relatedTagCategories}
          scoreMinInput={relatedTagScoreMinInput}
          scoreMaxInput={relatedTagScoreMaxInput}
          limitInput={relatedTagLimitInput}
          onClose={() => setIsRelatedTagOptionsOpen(false)}
          onToggleCategory={handleToggleRelatedTagCategory}
          onScoreMinInputChange={setRelatedTagScoreMinInput}
          onScoreMaxInputChange={setRelatedTagScoreMaxInput}
          onLimitInputChange={setRelatedTagLimitInput}
          onReset={handleResetRelatedTagOptions}
        />

        {!summaryQuery.isLoading && !summaryQuery.isError && !isDanbooruDbAvailable ? (
          <MissingDanbooruDatabaseNotice database={database} />
        ) : null}

        {isDanbooruDbAvailable && activeQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '목록 로드 실패', en: 'Failed to load rows' })}</AlertTitle>
            <AlertDescription>{activeQuery.error instanceof Error ? activeQuery.error.message : t({ ko: '알 수 없는 오류', en: 'Unknown error' })}</AlertDescription>
          </Alert>
        ) : null}

        {isDanbooruDbAvailable && activeQuery.isLoading ? <TableLoading columns={activeSection === 'characters' ? 6 : activeSection === 'artists' ? 3 : 2} /> : null}

        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'tags' ? <TagsTable items={tagsQuery.data?.items ?? []} language={language} /> : null}
        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'artists' ? <ArtistsTable items={artistsQuery.data?.items ?? []} language={language} /> : null}
        {isDanbooruDbAvailable && !activeQuery.isLoading && activeSection === 'characters' ? <CharactersTable items={charactersQuery.data?.items ?? []} language={language} /> : null}

        {isDanbooruDbAvailable ? <PaginationControls pagination={pagination} onPageChange={setPage} /> : null}
      </section>
    </div>
  )
}
