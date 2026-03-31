import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Copy, ListTree, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  getWildcardLastScanLog,
  getWildcards,
  parseWildcards,
  type WildcardItemRecord,
  type WildcardRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'

type WildcardGenerationPanelProps = {
  refreshNonce: number
}

type WildcardWorkspaceTab = 'wildcards' | 'preprocess' | 'lora'

type WildcardTreeEntry = {
  wildcard: WildcardRecord
  depth: number
  path: string[]
}

const WORKSPACE_TABS: Array<{ value: WildcardWorkspaceTab; label: string }> = [
  { value: 'wildcards', label: '와일드카드' },
  { value: 'preprocess', label: '전처리' },
  { value: 'lora', label: '로라' },
]

function flattenWildcardTree(nodes: WildcardRecord[], depth = 0, parentPath: string[] = []): WildcardTreeEntry[] {
  const entries: WildcardTreeEntry[] = []

  for (const node of nodes) {
    const path = [...parentPath, node.name]
    entries.push({ wildcard: node, depth, path })

    if (node.children && node.children.length > 0) {
      entries.push(...flattenWildcardTree(node.children, depth + 1, path))
    }
  }

  return entries
}

function filterWildcardTree(nodes: WildcardRecord[], predicate: (node: WildcardRecord) => boolean): WildcardRecord[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterWildcardTree(node.children ?? [], predicate)
    if (!predicate(node) && filteredChildren.length === 0) {
      return []
    }

    return [{
      ...node,
      children: filteredChildren.length > 0 ? filteredChildren : undefined,
    }]
  })
}

function countItemsByTool(items: WildcardItemRecord[] | undefined, tool: WildcardTool) {
  return (items ?? []).filter((item) => item.tool === tool).length
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

function WildcardTreeList({
  nodes,
  selectedId,
  onSelect,
  depth = 0,
}: {
  nodes: WildcardRecord[]
  selectedId: number | null
  onSelect: (wildcardId: number) => void
  depth?: number
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const comfyCount = countItemsByTool(node.items, 'comfyui')
        const naiCount = countItemsByTool(node.items, 'nai')
        const isSelected = node.id === selectedId

        return (
          <div key={node.id} className="space-y-1">
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left transition-colors',
                isSelected
                  ? 'border-primary bg-surface-container text-foreground'
                  : 'border-border bg-surface-lowest text-foreground hover:bg-surface-high',
              )}
              style={{ marginLeft: depth * 14 }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{node.name}</span>
                  <Badge variant={node.type === 'chain' ? 'secondary' : 'outline'}>{node.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
                  {node.is_auto_collected === 1 ? <Badge variant="outline">Auto LoRA</Badge> : null}
                </div>
                {node.description ? <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{node.description}</div> : null}
              </div>

              <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant="outline">NAI {naiCount}</Badge>
                <Badge variant="outline">Comfy {comfyCount}</Badge>
                {node.children && node.children.length > 0 ? <Badge variant="outline">하위 {node.children.length}</Badge> : null}
              </div>
            </button>

            {node.children && node.children.length > 0 ? (
              <WildcardTreeList nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function WildcardItemSection({ title, items }: { title: string; items: WildcardItemRecord[] }) {
  return (
    <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <Badge variant="outline">{items.length}</Badge>
      </div>

      {items.length > 0 ? (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="rounded-sm border border-border/70 bg-surface-lowest px-3 py-2 text-xs text-muted-foreground">
              <div className="break-words whitespace-pre-wrap text-foreground">{item.content}</div>
              <div className="mt-1">weight {item.weight}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">등록된 항목이 없어.</div>
      )}
    </div>
  )
}

function WildcardScanLogCard({ log }: { log: WildcardScanLog | null }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading="최근 LoRA 스캔"
          description="백엔드 자동 수집으로 만들어진 LoRA 와일드카드 요약이야."
          actions={log ? <Badge variant="outline">{log.totalWildcards}</Badge> : undefined}
        />

        {log ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em]">시간</div>
                <div className="mt-1 text-sm text-foreground">{formatDateTime(log.timestamp)}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em]">가중치</div>
                <div className="mt-1 text-sm text-foreground">{log.loraWeight}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em]">중복 처리</div>
                <div className="mt-1 text-sm text-foreground">{log.duplicateHandling}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em]">생성 항목</div>
                <div className="mt-1 text-sm text-foreground">{log.totalItems}</div>
              </div>
            </div>

            <div className="space-y-2">
              {log.wildcards.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-sm border border-border bg-surface-container px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{entry.name}</span>
                    <Badge variant="outline">level {entry.level}</Badge>
                    <Badge variant="outline">items {entry.itemCount}</Badge>
                  </div>
                  <div className="mt-1 break-all">{entry.folderName}</div>
                </div>
              ))}
              {log.wildcards.length > 8 ? <div className="text-xs text-muted-foreground">외 {log.wildcards.length - 8}개 더 있어.</div> : null}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">기록된 LoRA 스캔 로그가 아직 없어.</div>
        )}
      </CardContent>
    </Card>
  )
}

function WildcardDetailCard({
  selectedEntry,
  onCopyToken,
}: {
  selectedEntry: WildcardTreeEntry | null
  onCopyToken: (text: string, label: string) => Promise<void>
}) {
  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedToken = selectedWildcard ? `++${selectedWildcard.name}++` : ''
  const selectedNaiItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'nai'),
    [selectedWildcard],
  )
  const selectedComfyItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'comfyui'),
    [selectedWildcard],
  )

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading={selectedWildcard ? selectedWildcard.name : '항목 선택'}
          description={selectedWildcard ? '선택한 항목의 토큰과 실제 내용을 확인해.' : '왼쪽 사이드바에서 항목을 하나 골라줘.'}
          actions={selectedWildcard ? (
            <>
              <Badge variant={selectedWildcard.type === 'chain' ? 'secondary' : 'outline'}>{selectedWildcard.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
              {selectedWildcard.is_auto_collected === 1 ? <Badge variant="outline">Auto LoRA</Badge> : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void onCopyToken(selectedToken, '토큰')}>
                <Copy className="h-4 w-4" />
                토큰 복사
              </Button>
            </>
          ) : undefined}
        />

        {selectedWildcard ? (
          <div className="space-y-4">
            <div className="rounded-sm border border-border bg-surface-container p-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">token</Badge>
                <code className="rounded-sm bg-surface-lowest px-2 py-1 text-xs text-foreground">{selectedToken}</code>
              </div>
              <div className="mt-2 break-words text-xs">경로: {selectedEntry?.path.join(' / ') ?? selectedWildcard.name}</div>
              {selectedWildcard.description ? <div className="mt-2 text-xs">설명: {selectedWildcard.description}</div> : null}
              {selectedWildcard.source_path ? <div className="mt-2 break-all text-xs">소스: {selectedWildcard.source_path}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">하위 자동 포함 {selectedWildcard.include_children === 1 ? 'ON' : 'OFF'}</Badge>
                <Badge variant="outline">자식만 {selectedWildcard.only_children === 1 ? 'ON' : 'OFF'}</Badge>
                <Badge variant="outline">chain {selectedWildcard.chain_option}</Badge>
                {selectedWildcard.lora_weight != null ? <Badge variant="outline">LoRA weight {selectedWildcard.lora_weight}</Badge> : null}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <WildcardItemSection title="NAI 항목" items={selectedNaiItems} />
              <WildcardItemSection title="ComfyUI 항목" items={selectedComfyItems} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">항목을 선택하면 세부 정보를 보여줄게.</div>
        )}
      </CardContent>
    </Card>
  )
}

/** Render the wildcard workspace with section tabs, shared sidebar, and tree-based browsing. */
export function WildcardGenerationPanel({ refreshNonce }: WildcardGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const isWideLayout = useDesktopPageLayout()

  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WildcardWorkspaceTab>('wildcards')
  const [searchInput, setSearchInput] = useState('')
  const [selectedWildcardId, setSelectedWildcardId] = useState<number | null>(null)
  const [previewTool, setPreviewTool] = useState<WildcardTool>('nai')
  const [previewText, setPreviewText] = useState('')
  const [previewCount, setPreviewCount] = useState('5')

  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'hierarchical-browser', refreshNonce],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
  })

  const lastScanLogQuery = useQuery({
    queryKey: ['wildcards', 'last-scan-log', refreshNonce],
    queryFn: getWildcardLastScanLog,
  })

  const parseMutation = useMutation({
    mutationFn: (input: { text: string; tool: WildcardTool; count: number }) => parseWildcards(input),
  })

  const browserTreeNodes = useMemo(() => {
    if (activeWorkspaceTab === 'preprocess') {
      return []
    }

    return filterWildcardTree(
      wildcardsQuery.data ?? [],
      (node) => (activeWorkspaceTab === 'lora' ? node.is_auto_collected === 1 : node.is_auto_collected !== 1),
    )
  }, [activeWorkspaceTab, wildcardsQuery.data])

  const browserEntries = useMemo(() => flattenWildcardTree(browserTreeNodes), [browserTreeNodes])

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchInput.trim().toLowerCase()
    if (!normalizedSearch) {
      return browserEntries
    }

    return browserEntries.filter((entry) => {
      const pathText = entry.path.join(' / ').toLowerCase()
      return entry.wildcard.name.toLowerCase().includes(normalizedSearch) || pathText.includes(normalizedSearch)
    })
  }, [browserEntries, searchInput])

  const selectedEntry = useMemo(
    () => browserEntries.find((entry) => entry.wildcard.id === selectedWildcardId) ?? null,
    [browserEntries, selectedWildcardId],
  )

  useEffect(() => {
    if (activeWorkspaceTab === 'preprocess') {
      return
    }

    if (browserEntries.length === 0) {
      setSelectedWildcardId(null)
      return
    }

    if (selectedWildcardId === null || !browserEntries.some((entry) => entry.wildcard.id === selectedWildcardId)) {
      setSelectedWildcardId(browserEntries[0].wildcard.id)
    }
  }, [activeWorkspaceTab, browserEntries, selectedWildcardId])

  const handleCopy = async (text: string, label: string) => {
    try {
      await copyText(text)
      showSnackbar({ message: `${label} 복사했어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, `${label} 복사에 실패했어.`), tone: 'error' })
    }
  }

  const handleParsePreview = async () => {
    const text = previewText.trim()
    if (!text) {
      showSnackbar({ message: '전처리 프리뷰할 텍스트를 먼저 넣어줘.', tone: 'error' })
      return
    }

    try {
      await parseMutation.mutateAsync({
        text,
        tool: previewTool,
        count: Math.max(1, Math.min(10, Number(previewCount) || 5)),
      })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '전처리 프리뷰 생성에 실패했어.'), tone: 'error' })
    }
  }

  const browserSidebar = (
    <ExplorerSidebar
      title={activeWorkspaceTab === 'lora' ? 'LoRA' : 'Explorer'}
      badge={<Badge variant="outline">{browserEntries.length}</Badge>}
      floatingFrame
      className={cn(isWideLayout && 'sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1')}
      headerExtra={(
        <div className="space-y-3 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={activeWorkspaceTab === 'lora' ? 'LoRA 이름 또는 경로 검색' : '이름 또는 경로 검색'} />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 bg-surface-container"
              onClick={() => {
                void wildcardsQuery.refetch()
                if (activeWorkspaceTab === 'lora') {
                  void lastScanLogQuery.refetch()
                }
              }}
              aria-label="새로고침"
              title="새로고침"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            {activeWorkspaceTab === 'lora'
              ? '자동 수집된 LoRA 항목만 분리해서 본다.'
              : '와일드카드는 그룹처럼 묶어 쓰니까 폴더 트리 기준으로 탐색하면 된다.'}
          </div>
        </div>
      )}
    >
      {wildcardsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {wildcardsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>목록을 불러오지 못했어</AlertTitle>
          <AlertDescription>{getErrorMessage(wildcardsQuery.error, '와일드카드 목록을 불러오지 못했어.')}</AlertDescription>
        </Alert>
      ) : null}

      {!wildcardsQuery.isLoading && !wildcardsQuery.isError ? (
        searchInput.trim().length > 0 ? (
          filteredEntries.length > 0 ? (
            <div className="space-y-2">
              {filteredEntries.map((entry) => {
                const wildcard = entry.wildcard
                const isSelected = wildcard.id === selectedWildcardId

                return (
                  <button
                    key={wildcard.id}
                    type="button"
                    onClick={() => setSelectedWildcardId(wildcard.id)}
                    className={cn(
                      'w-full rounded-sm border px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-surface-container'
                        : 'border-border bg-surface-lowest hover:bg-surface-high',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{wildcard.name}</span>
                      <Badge variant={wildcard.type === 'chain' ? 'secondary' : 'outline'}>{wildcard.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
                      {wildcard.is_auto_collected === 1 ? <Badge variant="outline">Auto LoRA</Badge> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{entry.path.join(' / ')}</div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">검색 결과가 없어.</div>
          )
        ) : browserTreeNodes.length > 0 ? (
          <WildcardTreeList nodes={browserTreeNodes} selectedId={selectedWildcardId} onSelect={setSelectedWildcardId} />
        ) : (
          <div className="text-sm text-muted-foreground">표시할 항목이 아직 없어.</div>
        )
      ) : null}
    </ExplorerSidebar>
  )

  const preprocessSidebar = (
    <ExplorerSidebar
      title="Preprocess"
      badge={parseMutation.data ? <Badge variant="outline">{parseMutation.data.results.length}</Badge> : undefined}
      floatingFrame
      className={cn(isWideLayout && 'sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1')}
      headerExtra={(
        <div className="space-y-3 border-b border-white/5 pb-3 text-xs text-muted-foreground">
          <div>와일드카드 전처리/파싱 확인용 탭이야.</div>
        </div>
      )}
    >
      <div className="space-y-4 rounded-sm border border-border bg-surface-container p-3">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tool</div>
          <Select value={previewTool} onChange={(event) => setPreviewTool(event.target.value as WildcardTool)}>
            <option value="nai">NAI</option>
            <option value="comfyui">ComfyUI</option>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Samples</div>
          <Select value={previewCount} onChange={(event) => setPreviewCount(event.target.value)}>
            <option value="3">3개</option>
            <option value="5">5개</option>
            <option value="10">10개</option>
          </Select>
        </div>

        <Button type="button" onClick={() => void handleParsePreview()} disabled={parseMutation.isPending || previewText.trim().length === 0}>
          <Sparkles className="h-4 w-4" />
          {parseMutation.isPending ? '전처리 중…' : '전처리 실행'}
        </Button>
      </div>
    </ExplorerSidebar>
  )

  return (
    <div className="space-y-6">
      <div className="border-b border-border/70 pb-2">
        <div className="flex flex-wrap gap-2">
          {WORKSPACE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveWorkspaceTab(tab.value)}
              className={cn(
                'rounded-sm px-4 py-2 text-sm font-semibold transition-colors',
                activeWorkspaceTab === tab.value
                  ? 'bg-surface-container text-primary'
                  : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('grid gap-8', isWideLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
        {activeWorkspaceTab === 'preprocess' ? preprocessSidebar : browserSidebar}

        <section className="space-y-6">
          {activeWorkspaceTab === 'wildcards' ? (
            <WildcardDetailCard selectedEntry={selectedEntry} onCopyToken={handleCopy} />
          ) : null}

          {activeWorkspaceTab === 'preprocess' ? (
            <Card>
              <CardContent className="space-y-4">
                <SectionHeading
                  variant="inside"
                  className="border-b border-border/70 pb-4"
                  heading={(
                    <span className="flex items-center gap-2">
                      <WandSparkles className="h-4 w-4 text-primary" />
                      전처리 프리뷰
                    </span>
                  )}
                  description="임의 프롬프트를 넣고 파싱 결과 샘플을 먼저 확인해."
                  actions={parseMutation.data ? <Badge variant="outline">{parseMutation.data.results.length}</Badge> : undefined}
                />

                <Textarea
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  rows={8}
                  placeholder="예: masterpiece, ++character_pose++, cinematic lighting"
                />

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setPreviewText('')} disabled={previewText.length === 0}>
                    입력 비우기
                  </Button>
                  <Button type="button" onClick={() => void handleParsePreview()} disabled={parseMutation.isPending || previewText.trim().length === 0}>
                    <Sparkles className="h-4 w-4" />
                    {parseMutation.isPending ? '전처리 중…' : '전처리 실행'}
                  </Button>
                </div>

                {parseMutation.isError ? (
                  <Alert variant="destructive">
                    <AlertTitle>전처리 실패</AlertTitle>
                    <AlertDescription>{getErrorMessage(parseMutation.error, '전처리 중 오류가 났어.')}</AlertDescription>
                  </Alert>
                ) : null}

                {parseMutation.data ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">used</Badge>
                      {parseMutation.data.usedWildcards.length > 0
                        ? parseMutation.data.usedWildcards.map((name) => <Badge key={name} variant="outline">{name}</Badge>)
                        : <span>감지된 와일드카드가 없어.</span>}
                    </div>

                    <div className="space-y-2">
                      {parseMutation.data.results.map((result, index) => (
                        <div key={`${index}:${result}`} className="rounded-sm border border-border bg-surface-container p-3 text-sm text-muted-foreground">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs uppercase tracking-[0.18em]">sample {index + 1}</div>
                            <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopy(result, `프리뷰 결과 ${index + 1}`)}>
                              <Copy className="h-4 w-4" />
                              복사
                            </Button>
                          </div>
                          <div className="mt-2 break-words whitespace-pre-wrap text-foreground">{result}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">전처리를 실행하면 결과 샘플을 여기 보여줄게.</div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {activeWorkspaceTab === 'lora' ? (
            <>
              <WildcardDetailCard selectedEntry={selectedEntry} onCopyToken={handleCopy} />
              <WildcardScanLogCard log={lastScanLogQuery.data ?? null} />
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}
