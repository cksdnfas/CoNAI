import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Folder, FolderOpen, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { getPromptGroups, getPromptStatistics, getTopPrompts, searchPromptCollection } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem, PromptGroupRecord, PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'

interface PromptTreeProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  onSelectGroup: (groupId?: number | null) => void
}

function PromptTree({ groups, selectedGroupId, onSelectGroup }: PromptTreeProps) {
  const groupsByParentId = useMemo(() => {
    const map = new Map<number | null, PromptGroupRecord[]>()

    for (const group of groups) {
      const parentId = group.parent_id ?? null
      const siblings = map.get(parentId) ?? []
      siblings.push(group)
      map.set(parentId, siblings)
    }

    for (const siblings of map.values()) {
      siblings.sort((left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name))
    }

    return map
  }, [groups])

  const renderNodes = (parentId: number | null, depth: number) => {
    const nodes = groupsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    return (
      <div className="space-y-1">
        {nodes.map((group) => {
          const hasChildren = (groupsByParentId.get(group.id) ?? []).length > 0
          const isSelected = selectedGroupId === group.id

          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => onSelectGroup(group.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-surface-container text-primary'
                    : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                )}
                style={{ paddingLeft: `${12 + depth * 14}px` }}
              >
                {hasChildren ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                <span className="truncate">{group.group_name}</span>
              </button>
              {renderNodes(group.id, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelectGroup(undefined)}
        className={cn(
          'flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm transition-colors',
          selectedGroupId == null
            ? 'bg-surface-container text-primary'
            : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
        )}
      >
        <span>All prompts</span>
      </button>
      {renderNodes(null, 0)}
    </div>
  )
}

function PromptListItem({ item, onCopy }: { item: PromptCollectionItem; onCopy: (text: string) => void }) {
  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_120px_52px] items-center rounded-sm bg-surface-lowest px-3 py-2 transition-colors hover:bg-surface-high">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{item.prompt}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="ghost">{item.type}</Badge>
          {item.synonyms.length > 0 ? <span>synonyms {item.synonyms.length}</span> : null}
        </div>
      </div>
      <div className="text-right text-[11px] font-mono text-muted-foreground">{item.usage_count.toLocaleString('ko-KR')}</div>
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-sm p-2 text-muted-foreground transition-colors hover:text-primary"
          onClick={() => onCopy(item.prompt)}
          aria-label="copy prompt"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function PromptPage() {
  const [promptType, setPromptType] = useState<PromptTypeFilter>('positive')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<PromptSortBy>('usage_count')
  const [sortOrder, setSortOrder] = useState<PromptSortOrder>('DESC')
  const [page, setPage] = useState(1)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const supportsExplorer = promptType !== 'both'

  const groupsQuery = useQuery({
    queryKey: ['prompt-groups', promptType],
    queryFn: () => getPromptGroups(promptType === 'negative' ? 'negative' : 'positive'),
    enabled: supportsExplorer,
  })

  const statisticsQuery = useQuery({
    queryKey: ['prompt-statistics'],
    queryFn: getPromptStatistics,
  })

  const topPromptsQuery = useQuery({
    queryKey: ['top-prompts', promptType],
    queryFn: () => getTopPrompts({ type: promptType, limit: 8 }),
  })

  const promptSearchQuery = useQuery({
    queryKey: ['prompt-search', promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder],
    queryFn: () =>
      searchPromptCollection({
        query: searchQuery,
        type: promptType,
        page,
        limit: 40,
        sortBy,
        sortOrder,
        groupId: supportsExplorer ? (selectedGroupId ?? undefined) : undefined,
      }),
  })

  const currentGroupName = promptSearchQuery.data?.groupInfo?.group_name
  const topPrompts = topPromptsQuery.data ?? []
  const items = promptSearchQuery.data?.items ?? []
  const pagination = promptSearchQuery.data?.pagination

  const handleCopyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyNotice('프롬프트를 클립보드에 복사했어.')
      window.setTimeout(() => setCopyNotice(null), 1800)
    } catch {
      setCopyNotice('복사에 실패했어.')
      window.setTimeout(() => setCopyNotice(null), 1800)
    }
  }

  const handleChangeType = (nextType: PromptTypeFilter) => {
    setPromptType(nextType)
    setSelectedGroupId(undefined)
    setPage(1)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Prompt"
        title={currentGroupName ?? '프롬프트 탐색'}
        description="프롬프트 그룹을 따라 탐색하고, 사용 빈도 기반으로 빠르게 검색하고 복사한다."
      />

      {copyNotice ? (
        <Alert>
          <AlertTitle>프롬프트</AlertTitle>
          <AlertDescription>{copyNotice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-surface-container">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">positive</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {statisticsQuery.data?.total_prompts?.toLocaleString('ko-KR') ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface-container">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">negative</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {statisticsQuery.data?.total_negative_prompts?.toLocaleString('ko-KR') ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface-container">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">auto</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {statisticsQuery.data?.total_auto_prompts?.toLocaleString('ko-KR') ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface-container">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">top results</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{topPrompts.length.toLocaleString('ko-KR')}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-sm bg-surface-lowest p-4 xl:sticky xl:top-24 xl:self-start">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Explorer</h2>
            {supportsExplorer ? <Badge variant="outline">{groupsQuery.data?.length ?? 0}</Badge> : <Badge variant="secondary">mixed</Badge>}
          </div>

          <div className="mb-4 flex gap-2 border-b border-white/5 pb-2 text-xs font-semibold">
            {([
              ['positive', 'Positive'],
              ['negative', 'Negative'],
              ['both', 'Mixed'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handleChangeType(value)}
                className={cn(
                  'rounded-sm px-2 py-1 transition-colors',
                  promptType === value ? 'bg-surface-container text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {!supportsExplorer ? (
            <p className="text-sm text-muted-foreground">Mixed 모드에서는 그룹 필터 없이 positive/negative를 함께 탐색해.</p>
          ) : null}

          {supportsExplorer && groupsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {supportsExplorer && groupsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>그룹을 불러오지 못했어</AlertTitle>
              <AlertDescription>
                {groupsQuery.error instanceof Error ? groupsQuery.error.message : '알 수 없는 오류가 발생했어.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {supportsExplorer && !groupsQuery.isLoading && !groupsQuery.isError ? (
            <PromptTree groups={groupsQuery.data ?? []} selectedGroupId={selectedGroupId} onSelectGroup={(groupId) => {
              setSelectedGroupId(groupId)
              setPage(1)
            }} />
          ) : null}
        </aside>

        <section className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-xl space-y-2">
              <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Search</div>
              <div className="flex items-center gap-2 rounded-sm bg-surface-lowest px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setSearchQuery(searchInput)
                      setPage(1)
                    }
                  }}
                  placeholder="프롬프트 검색"
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <Button size="sm" onClick={() => {
                  setSearchQuery(searchInput)
                  setPage(1)
                }}>
                  적용
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as PromptSortBy)
                  setPage(1)
                }}
                className="h-9 rounded-sm bg-surface-lowest px-3 text-sm text-foreground outline-none"
              >
                <option value="usage_count">usage</option>
                <option value="created_at">created</option>
                <option value="prompt">prompt</option>
              </select>
              <select
                value={sortOrder}
                onChange={(event) => {
                  setSortOrder(event.target.value as PromptSortOrder)
                  setPage(1)
                }}
                className="h-9 rounded-sm bg-surface-lowest px-3 text-sm text-foreground outline-none"
              >
                <option value="DESC">DESC</option>
                <option value="ASC">ASC</option>
              </select>
            </div>
          </div>

          {topPrompts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topPrompts.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onClick={() => handleCopyPrompt(item.prompt)}
                  className="rounded-sm bg-surface-container px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground"
                >
                  <span className="font-medium text-foreground">{item.prompt}</span>
                  <span className="ml-2 font-mono">{item.usage_count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {promptSearchQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>프롬프트 목록을 불러오지 못했어</AlertTitle>
              <AlertDescription>
                {promptSearchQuery.error instanceof Error ? promptSearchQuery.error.message : '알 수 없는 오류가 발생했어.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_52px] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground border-b border-white/5">
              <span>Prompt title</span>
              <span className="text-right">Usage</span>
              <span />
            </div>

            {promptSearchQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full rounded-sm" />
                ))}
              </div>
            ) : null}

            {!promptSearchQuery.isLoading && items.length > 0
              ? items.map((item) => <PromptListItem key={`${item.type}-${item.id}`} item={item} onCopy={handleCopyPrompt} />)
              : null}

            {!promptSearchQuery.isLoading && items.length === 0 ? (
              <Card className="bg-surface-container">
                <CardContent className="p-6 text-sm text-muted-foreground">표시할 프롬프트가 없어.</CardContent>
              </Card>
            ) : null}
          </div>

          {pagination ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                page {pagination.page} / {pagination.totalPages} · total {pagination.total.toLocaleString('ko-KR')}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  이전
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  다음
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
