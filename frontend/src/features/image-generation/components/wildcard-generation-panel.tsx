import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, Copy, FolderPlus, History, ListTree, Pencil, RefreshCw, Sparkles, Trash2, Upload, WandSparkles } from 'lucide-react'
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
  createWildcard,
  deleteWildcard,
  getWildcardLastScanLog,
  getWildcards,
  parseWildcards,
  scanWildcardLoraFolder,
  updateWildcard,
  type LoraScanRequest,
  type WildcardItemRecord,
  type WildcardRecord,
  type WildcardScanLog,
  type WildcardTool,
} from '@/lib/api'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { LoraAutoCollectModal } from './lora-auto-collect-modal'
import { WildcardEditorModal, type WildcardEditorModalInput } from './wildcard-editor-modal'
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

type WildcardEditorState =
  | {
    mode: 'create'
    defaultParentId: number | null
  }
  | {
    mode: 'edit'
    wildcard: WildcardRecord
  }
  | null

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

function getWorkspaceTabDescription(tab: WildcardWorkspaceTab) {
  if (tab === 'preprocess') {
    return '전처리용 chain 항목만 같은 방식으로 관리해.'
  }

  if (tab === 'lora') {
    return '자동 수집된 LoRA 항목만 같은 방식으로 보여줘.'
  }

  return '와일드카드는 그룹처럼 묶어 쓰니까 폴더 트리 기준으로 탐색하면 된다.'
}

function matchesWorkspaceTab(node: WildcardRecord, tab: WildcardWorkspaceTab) {
  if (tab === 'preprocess') {
    return node.type === 'chain' && node.is_auto_collected !== 1
  }

  if (tab === 'lora') {
    return node.is_auto_collected === 1
  }

  return node.type !== 'chain' && node.is_auto_collected !== 1
}

/** Return the persistence type that should be used for each workspace tab. */
function getWorkspaceTabRecordType(tab: WildcardWorkspaceTab) {
  return tab === 'preprocess' ? 'chain' : 'wildcard'
}

/** Guard create actions for tabs backed by auto-collected data. */
function canCreateWorkspaceTabItem(tab: WildcardWorkspaceTab) {
  return tab !== 'lora'
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

function WildcardDetailCard({
  selectedEntry,
  onCopyToken,
  extraActions,
}: {
  selectedEntry: WildcardTreeEntry | null
  onCopyToken: (text: string, label: string) => Promise<void>
  extraActions?: ReactNode
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
              {extraActions}
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

function LoraScanLogCard({ log }: { log: WildcardScanLog | null }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading="최근 자동 수집 로그"
          description="마지막 LoRA 자동 수집 결과 요약이야."
          actions={log ? <Badge variant="outline">{log.totalWildcards}</Badge> : undefined}
        />

        {log ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">시간</div>
                <div className="mt-1 text-sm text-foreground">{formatDateTime(log.timestamp)}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">LoRA weight</div>
                <div className="mt-1 text-sm text-foreground">{log.loraWeight}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">중복 처리</div>
                <div className="mt-1 text-sm text-foreground">{log.duplicateHandling}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-container p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">생성 항목</div>
                <div className="mt-1 text-sm text-foreground">{log.totalItems}</div>
              </div>
            </div>

            <div className="space-y-2">
              {log.wildcards.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-sm border border-border bg-surface-container px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">++{entry.name}++</span>
                    <Badge variant="outline">items {entry.itemCount}</Badge>
                    <Badge variant="outline">level {entry.level}</Badge>
                  </div>
                  <div className="mt-1 break-all">{entry.folderName}</div>
                </div>
              ))}
              {log.wildcards.length > 8 ? <div className="text-xs text-muted-foreground">외 {log.wildcards.length - 8}개 더 있어.</div> : null}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">아직 기록된 자동 수집 로그가 없어.</div>
        )}
      </CardContent>
    </Card>
  )
}

/** Render the shared wildcard/preprocess/lora workspace with one common UI and tab-based data filters. */
export function WildcardGenerationPanel({ refreshNonce }: WildcardGenerationPanelProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const isWideLayout = useDesktopPageLayout()

  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WildcardWorkspaceTab>('wildcards')
  const [searchInput, setSearchInput] = useState('')
  const [selectedWildcardId, setSelectedWildcardId] = useState<number | null>(null)
  const [previewTool, setPreviewTool] = useState<WildcardTool>('nai')
  const [previewText, setPreviewText] = useState('')
  const [previewCount, setPreviewCount] = useState('5')
  const [editorState, setEditorState] = useState<WildcardEditorState>(null)
  const [isLoraCollectModalOpen, setIsLoraCollectModalOpen] = useState(false)

  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'hierarchical-browser', refreshNonce],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
  })

  const loraScanLogQuery = useQuery({
    queryKey: ['wildcards', 'lora-scan-log', refreshNonce],
    queryFn: getWildcardLastScanLog,
  })

  const parseMutation = useMutation({
    mutationFn: (input: { text: string; tool: WildcardTool; count: number }) => parseWildcards(input),
  })

  const createMutation = useMutation({
    mutationFn: createWildcard,
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: '항목을 만들었어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      setSelectedWildcardId(result.id)
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, '항목 생성에 실패했어.'), tone: 'error' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ wildcardId, input }: { wildcardId: number; input: Parameters<typeof updateWildcard>[1] }) => updateWildcard(wildcardId, input),
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: '항목을 저장했어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      setSelectedWildcardId(result.id)
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, '항목 저장에 실패했어.'), tone: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ wildcardId, cascade }: { wildcardId: number; cascade: boolean }) => deleteWildcard(wildcardId, { cascade }),
    onSuccess: async () => {
      showSnackbar({ message: '항목을 삭제했어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      setSelectedWildcardId(null)
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, '항목 삭제에 실패했어.'), tone: 'error' })
    },
  })

  const loraCollectMutation = useMutation({
    mutationFn: (input: LoraScanRequest) => scanWildcardLoraFolder(input),
    onSuccess: async (result) => {
      setIsLoraCollectModalOpen(false)
      showSnackbar({ message: `LoRA 자동 수집 완료. ${result.created}개 항목을 만들었어.`, tone: 'info' })
      setSelectedWildcardId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wildcards'] }),
        queryClient.invalidateQueries({ queryKey: ['wildcards', 'lora-scan-log'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, 'LoRA 자동 수집에 실패했어.'), tone: 'error' })
    },
  })

  const browserTreeNodes = useMemo(
    () => filterWildcardTree(wildcardsQuery.data ?? [], (node) => matchesWorkspaceTab(node, activeWorkspaceTab)),
    [activeWorkspaceTab, wildcardsQuery.data],
  )
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
  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedToken = selectedEntry ? `++${selectedEntry.wildcard.name}++` : ''
  const activeTabLabel = WORKSPACE_TABS.find((tab) => tab.value === activeWorkspaceTab)?.label ?? '와일드카드'
  const canCreateInActiveTab = canCreateWorkspaceTabItem(activeWorkspaceTab)

  useEffect(() => {
    if (browserEntries.length === 0) {
      setSelectedWildcardId(null)
      return
    }

    if (selectedWildcardId === null || !browserEntries.some((entry) => entry.wildcard.id === selectedWildcardId)) {
      setSelectedWildcardId(browserEntries[0].wildcard.id)
    }
  }, [browserEntries, selectedWildcardId])

  useEffect(() => {
    if (!selectedToken) {
      return
    }

    setPreviewText((current) => (current.trim().length === 0 ? selectedToken : current))
  }, [selectedToken])

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
      showSnackbar({ message: getErrorMessage(error, '프리뷰 생성에 실패했어.'), tone: 'error' })
    }
  }

  const handleOpenCreateModal = (defaultParentId: number | null) => {
    if (!canCreateInActiveTab) {
      showSnackbar({ message: '로라 탭은 자동 수집 항목 기반이라 새 항목 생성은 막아둘게.', tone: 'info' })
      return
    }

    setEditorState({
      mode: 'create',
      defaultParentId,
    })
  }

  const handleOpenEditModal = () => {
    if (!selectedWildcard) {
      return
    }

    setEditorState({
      mode: 'edit',
      wildcard: selectedWildcard,
    })
  }

  const handleDeleteSelected = async () => {
    if (!selectedWildcard) {
      return
    }

    const hasChildren = browserEntries.some((entry) => entry.wildcard.parent_id === selectedWildcard.id)
    const confirmed = window.confirm(
      hasChildren
        ? `${selectedWildcard.name} 항목을 삭제할까? 하위 항목 처리 방식도 바로 이어서 물어볼게.`
        : `${selectedWildcard.name} 항목을 삭제할까?`,
    )
    if (!confirmed) {
      return
    }

    const cascade = hasChildren
      ? window.confirm('하위 항목까지 전부 같이 삭제할까?\n확인 = 하위까지 삭제\n취소 = 현재 항목만 삭제하고 자식은 위로 올림')
      : false

    await deleteMutation.mutateAsync({
      wildcardId: selectedWildcard.id,
      cascade,
    })
  }

  const handleSubmitEditor = async (input: WildcardEditorModalInput) => {
    if (!editorState) {
      return
    }

    if (editorState.mode === 'create') {
      await createMutation.mutateAsync({
        ...input,
        type: getWorkspaceTabRecordType(activeWorkspaceTab),
      })
      return
    }

    await updateMutation.mutateAsync({
      wildcardId: editorState.wildcard.id,
      input: {
        ...input,
        type: editorState.wildcard.type,
      },
    })
  }

  const handleSubmitLoraCollect = async (input: LoraScanRequest) => {
    await loraCollectMutation.mutateAsync(input)
  }

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
        <ExplorerSidebar
          title="Explorer"
          badge={<Badge variant="outline">{browserEntries.length}</Badge>}
          floatingFrame
          className={cn(isWideLayout && 'sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
          bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1')}
          headerExtra={(
            <div className="space-y-3 border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="이름 또는 경로 검색" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0 bg-surface-container"
                  onClick={() => {
                    void wildcardsQuery.refetch()
                  }}
                  aria-label="새로고침"
                  title="새로고침"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeWorkspaceTab === 'lora' ? (
                  <>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setIsLoraCollectModalOpen(true)}>
                      <Upload className="h-4 w-4" />
                      자동 수집
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void loraScanLogQuery.refetch()} disabled={loraScanLogQuery.isFetching}>
                      <History className="h-4 w-4" />
                      로그 새로고침
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => handleOpenCreateModal(null)}
                      disabled={!canCreateInActiveTab}
                    >
                      <FolderPlus className="h-4 w-4" />
                      새 항목
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => handleOpenCreateModal(selectedWildcard?.id ?? null)}
                      disabled={!canCreateInActiveTab || !selectedWildcard}
                    >
                      <FolderPlus className="h-4 w-4" />
                      하위 추가
                    </Button>
                  </>
                )}
                <Button type="button" size="icon-sm" variant="outline" onClick={handleOpenEditModal} disabled={!selectedWildcard} aria-label="편집" title="편집">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon-sm" variant="outline" onClick={() => void handleDeleteSelected()} disabled={!selectedWildcard || deleteMutation.isPending} aria-label="삭제" title="삭제">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ListTree className="h-3.5 w-3.5" />
                <span>{getWorkspaceTabDescription(activeWorkspaceTab)}</span>
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
              <AlertDescription>{getErrorMessage(wildcardsQuery.error, '목록을 불러오지 못했어.')}</AlertDescription>
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

        <section className="space-y-6">
          <WildcardDetailCard
            selectedEntry={selectedEntry}
            onCopyToken={handleCopy}
            extraActions={selectedWildcard ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={handleOpenEditModal}>
                  <Pencil className="h-4 w-4" />
                  편집
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleDeleteSelected()} disabled={deleteMutation.isPending}>
                  <Trash2 className="h-4 w-4" />
                  삭제
                </Button>
              </>
            ) : undefined}
          />

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
                <Input value={selectedToken} readOnly placeholder="선택한 토큰" />
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
                <Button type="button" onClick={() => void handleParsePreview()} disabled={parseMutation.isPending || previewText.trim().length === 0}>
                  <Sparkles className="h-4 w-4" />
                  {parseMutation.isPending ? '프리뷰 생성 중…' : '프리뷰 생성'}
                </Button>
              </div>

              {parseMutation.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>프리뷰 생성 실패</AlertTitle>
                  <AlertDescription>{getErrorMessage(parseMutation.error, '프리뷰 생성 중 오류가 났어.')}</AlertDescription>
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
                <div className="text-sm text-muted-foreground">프리뷰를 실행하면 파싱 결과 샘플을 여기 보여줄게.</div>
              )}
            </CardContent>
          </Card>

          {activeWorkspaceTab === 'lora' ? (
            loraScanLogQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>LoRA 스캔 로그를 불러오지 못했어</AlertTitle>
                <AlertDescription>{getErrorMessage(loraScanLogQuery.error, '최근 스캔 로그를 불러오지 못했어.')}</AlertDescription>
              </Alert>
            ) : (
              <LoraScanLogCard log={loraScanLogQuery.data ?? null} />
            )
          ) : null}
        </section>
      </div>

      <LoraAutoCollectModal
        open={isLoraCollectModalOpen}
        isSubmitting={loraCollectMutation.isPending}
        onClose={() => setIsLoraCollectModalOpen(false)}
        onSubmit={handleSubmitLoraCollect}
      />

      <WildcardEditorModal
        open={editorState !== null}
        mode={editorState?.mode ?? 'create'}
        tabLabel={activeTabLabel}
        isChainTab={activeWorkspaceTab === 'preprocess'}
        wildcards={browserEntries.map((entry) => entry.wildcard)}
        wildcard={editorState?.mode === 'edit' ? editorState.wildcard : null}
        defaultParentId={editorState?.mode === 'create' ? editorState.defaultParentId : null}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        onClose={() => setEditorState(null)}
        onSubmit={handleSubmitEditor}
      />
    </div>
  )
}
