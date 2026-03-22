import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { getPromptGroups, searchPromptCollection } from '@/lib/api'
import type { PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'
import { PromptListItem } from './components/prompt-list-item'
import { PromptSidebar } from './components/prompt-sidebar'
import { PromptToolbar } from './components/prompt-toolbar'

export function PromptPage() {
  const [promptType, setPromptType] = useState<PromptTypeFilter>('positive')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<PromptSortBy>('usage_count')
  const [sortOrder, setSortOrder] = useState<PromptSortOrder>('DESC')
  const [page, setPage] = useState(1)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const groupsQuery = useQuery({
    queryKey: ['prompt-groups', promptType],
    queryFn: () => getPromptGroups(promptType),
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
        groupId: selectedGroupId ?? undefined,
      }),
  })

  const currentGroupName = promptSearchQuery.data?.groupInfo?.group_name
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

  const handleApplySearch = () => {
    setSearchQuery(searchInput)
    setPage(1)
  }

  const handleChangeType = (nextType: PromptTypeFilter) => {
    setPromptType(nextType)
    setSelectedGroupId(undefined)
    setPage(1)
  }

  return (
    <div className="space-y-8">
      <PageHeader title={currentGroupName ?? 'Prompt Explorer'} />

      {copyNotice ? (
        <Alert>
          <AlertTitle>Prompt</AlertTitle>
          <AlertDescription>{copyNotice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-8 min-[800px]:grid-cols-[260px_minmax(0,1fr)]">
        <PromptSidebar
          promptType={promptType}
          groups={groupsQuery.data ?? []}
          selectedGroupId={selectedGroupId}
          groupsLoading={groupsQuery.isLoading}
          groupsError={groupsQuery.error instanceof Error ? groupsQuery.error.message : groupsQuery.isError ? '알 수 없는 오류가 발생했어.' : null}
          onChangeType={handleChangeType}
          onSelectGroup={(groupId) => {
            setSelectedGroupId(groupId)
            setPage(1)
          }}
        />

        <section className="space-y-6">
          <PromptToolbar
            searchInput={searchInput}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSearchInputChange={setSearchInput}
            onApplySearch={handleApplySearch}
            onChangeSortBy={(value) => {
              setSortBy(value)
              setPage(1)
            }}
            onChangeSortOrder={(value) => {
              setSortOrder(value)
              setPage(1)
            }}
          />

          {promptSearchQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>프롬프트 목록을 불러오지 못했어</AlertTitle>
              <AlertDescription>
                {promptSearchQuery.error instanceof Error ? promptSearchQuery.error.message : '알 수 없는 오류가 발생했어.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {promptType === 'auto' && !promptSearchQuery.isLoading && items.length === 0 ? (
            <Alert>
              <AlertTitle>Auto prompts are empty</AlertTitle>
              <AlertDescription>
                현재 DB에는 auto_tags 기반 프롬프트가 아직 수집되지 않았어. auto/artist 항목은 백엔드 sync 이후에 실제 값이 보여.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_52px] border-b border-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <span>Prompt</span>
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

            {!promptSearchQuery.isLoading && items.length === 0 && promptType !== 'auto' ? (
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
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
