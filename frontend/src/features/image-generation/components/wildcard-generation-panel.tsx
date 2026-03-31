import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Braces, Copy, ListTree, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  getWildcardLastScanLog,
  getWildcards,
  getWildcardStatistics,
  parseWildcards,
  type WildcardItemRecord,
  type WildcardParseResponse,
  type WildcardRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'

type WildcardGenerationPanelProps = {
  refreshNonce: number
  onInsertToNaiPrompt: (text: string, sourceLabel: string) => void
}

type WildcardTreeEntry = {
  wildcard: WildcardRecord
  depth: number
  path: string[]
}

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
          description="백엔드 자동 수집으로 만들어진 와일드카드 요약이야."
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

/** Render a wildcard browser/preview tab inside the image generation page. */
export function WildcardGenerationPanel({ refreshNonce, onInsertToNaiPrompt }: WildcardGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [searchInput, setSearchInput] = useState('')
  const [selectedWildcardId, setSelectedWildcardId] = useState<number | null>(null)
  const [previewTool, setPreviewTool] = useState<WildcardTool>('nai')
  const [previewText, setPreviewText] = useState('')
  const [previewCount, setPreviewCount] = useState('5')

  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'hierarchical-browser', refreshNonce],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
  })

  const wildcardStatsQuery = useQuery({
    queryKey: ['wildcards', 'stats', refreshNonce],
    queryFn: getWildcardStatistics,
  })

  const lastScanLogQuery = useQuery({
    queryKey: ['wildcards', 'last-scan-log', refreshNonce],
    queryFn: getWildcardLastScanLog,
  })

  const parseMutation = useMutation({
    mutationFn: (input: { text: string; tool: WildcardTool; count: number }) => parseWildcards(input),
  })

  const flattenedWildcards = useMemo(() => flattenWildcardTree(wildcardsQuery.data ?? []), [wildcardsQuery.data])

  const selectedEntry = useMemo(
    () => flattenedWildcards.find((entry) => entry.wildcard.id === selectedWildcardId) ?? null,
    [flattenedWildcards, selectedWildcardId],
  )

  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedToken = selectedWildcard ? `++${selectedWildcard.name}++` : ''

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchInput.trim().toLowerCase()
    if (!normalizedSearch) {
      return flattenedWildcards
    }

    return flattenedWildcards.filter((entry) => {
      const pathText = entry.path.join(' / ').toLowerCase()
      return entry.wildcard.name.toLowerCase().includes(normalizedSearch) || pathText.includes(normalizedSearch)
    })
  }, [flattenedWildcards, searchInput])

  useEffect(() => {
    if (flattenedWildcards.length === 0) {
      setSelectedWildcardId(null)
      return
    }

    if (selectedWildcardId === null || !flattenedWildcards.some((entry) => entry.wildcard.id === selectedWildcardId)) {
      setSelectedWildcardId(flattenedWildcards[0].wildcard.id)
    }
  }, [flattenedWildcards, selectedWildcardId])

  useEffect(() => {
    if (!selectedToken) {
      return
    }

    setPreviewText((current) => (current.trim().length === 0 ? selectedToken : current))
  }, [selectedToken])

  const selectedNaiItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'nai'),
    [selectedWildcard],
  )
  const selectedComfyItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'comfyui'),
    [selectedWildcard],
  )

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
      showSnackbar({ message: '프리뷰할 텍스트를 먼저 넣어줘.', tone: 'error' })
      return
    }

    try {
      await parseMutation.mutateAsync({
        text,
        tool: previewTool,
        count: Math.max(1, Math.min(10, Number(previewCount) || 5)),
      })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '와일드카드 프리뷰 생성에 실패했어.'), tone: 'error' })
    }
  }

  const handleInsertSelectedTokenToNai = () => {
    if (!selectedToken) {
      showSnackbar({ message: '먼저 와일드카드를 골라줘.', tone: 'error' })
      return
    }

    onInsertToNaiPrompt(selectedToken, '와일드카드 토큰')
  }

  const handleInsertPreviewResultToNai = (result: string, index: number) => {
    const text = result.trim()
    if (!text) {
      showSnackbar({ message: '비어 있는 프리뷰 결과는 보낼 수 없어.', tone: 'error' })
      return
    }

    onInsertToNaiPrompt(text, `프리뷰 결과 ${index + 1}`)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-sm border border-border bg-surface-container p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">wildcards</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{wildcardStatsQuery.data?.totalWildcards?.toLocaleString('ko-KR') ?? '—'}</div>
        </div>
        <div className="rounded-sm border border-border bg-surface-container p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">NAI items</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{wildcardStatsQuery.data?.itemsByTool.nai?.toLocaleString('ko-KR') ?? '—'}</div>
        </div>
        <div className="rounded-sm border border-border bg-surface-container p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">ComfyUI items</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{wildcardStatsQuery.data?.itemsByTool.comfyui?.toLocaleString('ko-KR') ?? '—'}</div>
        </div>
        <div className="rounded-sm border border-border bg-surface-container p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">avg items</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{wildcardStatsQuery.data ? wildcardStatsQuery.data.averageItemsPerWildcard.toFixed(1) : '—'}</div>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              className="border-b border-border/70 pb-4"
              heading={(
                <span className="flex items-center gap-2">
                  <ListTree className="h-4 w-4 text-primary" />
                  와일드카드 브라우저
                </span>
              )}
              description="생성용 와일드카드를 계층 구조로 확인하고 선택해."
              actions={(
                <>
                  <Badge variant="outline">{filteredEntries.length}</Badge>
                  <Button type="button" variant="outline" size="icon-sm" onClick={() => {
                    void wildcardsQuery.refetch()
                    void wildcardStatsQuery.refetch()
                    void lastScanLogQuery.refetch()
                  }} aria-label="와일드카드 새로고침" title="와일드카드 새로고침">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </>
              )}
            />

            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="이름 또는 경로 검색" />

            {wildcardsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">와일드카드 불러오는 중…</div>
            ) : wildcardsQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>와일드카드 목록 오류</AlertTitle>
                <AlertDescription>{getErrorMessage(wildcardsQuery.error, '목록을 불러오지 못했어.')}</AlertDescription>
              </Alert>
            ) : searchInput.trim().length > 0 ? (
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
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{entry.path.join(' / ')}</div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">검색 결과가 없어.</div>
              )
            ) : (wildcardsQuery.data?.length ?? 0) > 0 ? (
              <div className="max-h-[68vh] overflow-y-auto pr-1">
                <WildcardTreeList nodes={wildcardsQuery.data ?? []} selectedId={selectedWildcardId} onSelect={setSelectedWildcardId} />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">등록된 와일드카드가 아직 없어.</div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                className="border-b border-border/70 pb-4"
                heading={selectedWildcard ? selectedWildcard.name : '와일드카드 선택'}
                description={selectedWildcard ? '선택한 와일드카드의 토큰과 항목 구성을 확인해.' : '왼쪽에서 와일드카드를 하나 골라줘.'}
                actions={selectedWildcard ? (
                  <>
                    <Badge variant={selectedWildcard.type === 'chain' ? 'secondary' : 'outline'}>{selectedWildcard.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
                    {selectedWildcard.is_auto_collected === 1 ? <Badge variant="outline">Auto LoRA</Badge> : null}
                    <Button type="button" variant="outline" size="sm" onClick={handleInsertSelectedTokenToNai}>
                      <Sparkles className="h-4 w-4" />
                      NAI로 보내기
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy(selectedToken, '와일드카드 토큰')}>
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
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">하위 자동 포함 {selectedWildcard.include_children === 1 ? 'ON' : 'OFF'}</Badge>
                      <Badge variant="outline">자식만 {selectedWildcard.only_children === 1 ? 'ON' : 'OFF'}</Badge>
                      <Badge variant="outline">chain {selectedWildcard.chain_option}</Badge>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <WildcardItemSection title="NAI 항목" items={selectedNaiItems} />
                    <WildcardItemSection title="ComfyUI 항목" items={selectedComfyItems} />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">와일드카드를 선택하면 세부 정보를 보여줄게.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                className="border-b border-border/70 pb-4"
                heading={(
                  <span className="flex items-center gap-2">
                    <WandSparkles className="h-4 w-4 text-primary" />
                    파싱 프리뷰
                  </span>
                )}
                description="선택한 토큰이나 임의 프롬프트를 넣고 결과 샘플을 미리 확인해."
                actions={parseMutation.data ? <Badge variant="outline">{parseMutation.data.results.length}</Badge> : undefined}
              />

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px]">
                <Input value={selectedToken} readOnly placeholder="선택한 와일드카드 토큰" />
                <Select value={previewTool} onChange={(event) => setPreviewTool(event.target.value as WildcardTool)}>
                  <option value="nai">NAI</option>
                  <option value="comfyui">ComfyUI</option>
                </Select>
                <Select value={previewCount} onChange={(event) => setPreviewCount(event.target.value)}>
                  <option value="3">3개</option>
                  <option value="5">5개</option>
                  <option value="10">10개</option>
                </Select>
              </div>

              <Textarea
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                rows={5}
                placeholder="예: masterpiece, ++character_pose++, cinematic lighting"
              />

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setPreviewText(selectedToken)} disabled={!selectedToken}>
                  <Braces className="h-4 w-4" />
                  토큰만 넣기
                </Button>
                <Button type="button" variant="outline" onClick={handleInsertSelectedTokenToNai} disabled={!selectedToken}>
                  <Sparkles className="h-4 w-4" />
                  선택 토큰 NAI로 보내기
                </Button>
                <Button type="button" onClick={() => void handleParsePreview()} disabled={parseMutation.isPending || previewText.trim().length === 0}>
                  <Sparkles className="h-4 w-4" />
                  {parseMutation.isPending ? '프리뷰 생성 중…' : '프리뷰 생성'}
                </Button>
              </div>

              <Alert>
                <AlertTitle>NAI 연동</AlertTitle>
                <AlertDescription>선택 토큰이나 프리뷰 결과를 누르면 NAI 탭으로 이동하면서 현재 prompt 뒤에 바로 붙여줘.</AlertDescription>
              </Alert>

              {parseMutation.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>프리뷰 생성 실패</AlertTitle>
                  <AlertDescription>{getErrorMessage(parseMutation.error, '와일드카드 프리뷰 생성 중 오류가 났어.')}</AlertDescription>
                </Alert>
              ) : null}

              {parseMutation.data ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">used</Badge>
                    {parseMutation.data.usedWildcards.length > 0 ? parseMutation.data.usedWildcards.map((name) => <Badge key={name} variant="outline">{name}</Badge>) : <span>감지된 와일드카드가 없어.</span>}
                  </div>

                  <div className="space-y-2">
                    {parseMutation.data.results.map((result, index) => (
                      <div key={`${index}:${result}`} className="rounded-sm border border-border bg-surface-container p-3 text-sm text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs uppercase tracking-[0.18em]">sample {index + 1}</div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => handleInsertPreviewResultToNai(result, index)}>
                              <Sparkles className="h-4 w-4" />
                              NAI로 보내기
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopy(result, `프리뷰 결과 ${index + 1}`)}>
                              <Copy className="h-4 w-4" />
                              복사
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 break-words whitespace-pre-wrap text-foreground">{result}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">프리뷰를 실행하면 파싱 결과 샘플을 여기 보여줄게.</div>
              )}
            </CardContent>
          </Card>

          <WildcardScanLogCard log={lastScanLogQuery.data ?? null} />
        </div>
      </div>
    </div>
  )
}
