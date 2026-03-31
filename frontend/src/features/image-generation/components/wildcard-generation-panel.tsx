import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, Copy, Folder, FolderOpen, FolderPlus, History, Pencil, RefreshCw, Sparkles, Trash2, Upload, WandSparkles } from 'lucide-react'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SegmentedControl } from '@/components/common/segmented-control'
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
import { SettingsModal } from '@/features/settings/components/settings-modal'
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

function isReadonlyWorkspaceTab(tab: WildcardWorkspaceTab) {
  return tab === 'lora'
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

function WildcardTree({
  entries,
  selectedId,
  onSelect,
}: {
  entries: WildcardTreeEntry[]
  selectedId: number | null
  onSelect: (wildcardId: number) => void
}) {
  return (
    <HierarchyNav
      items={entries.map((entry) => entry.wildcard)}
      expandable
      selectedId={selectedId}
      onSelect={(wildcard) => onSelect(wildcard.id)}
      getId={(wildcard) => wildcard.id}
      getParentId={(wildcard) => wildcard.parent_id}
      getLabel={(wildcard) => <span className="truncate">{wildcard.name}</span>}
      sortItems={(left, right) => left.name.localeCompare(right.name)}
      renderIcon={(_, state) => (state.hasChildren || state.isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
    />
  )
}

function WildcardItemSection({ title, items }: { title: string; items: WildcardItemRecord[] }) {
  return (
    <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
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
  onCopySyntax,
  extraActions,
}: {
  selectedEntry: WildcardTreeEntry | null
  onCopySyntax: (text: string, label: string) => Promise<void>
  extraActions?: ReactNode
}) {
  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedWildcardSyntax = selectedWildcard ? `++${selectedWildcard.name}++` : ''
  const [activeItemTool, setActiveItemTool] = useState<WildcardTool>('comfyui')
  const selectedNaiItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'nai'),
    [selectedWildcard],
  )
  const selectedComfyItems = useMemo(
    () => (selectedWildcard?.items ?? []).filter((item) => item.tool === 'comfyui'),
    [selectedWildcard],
  )
  const activeItems = activeItemTool === 'comfyui' ? selectedComfyItems : selectedNaiItems

  useEffect(() => {
    setActiveItemTool('comfyui')
  }, [selectedWildcard?.id])

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading={selectedWildcard ? selectedWildcard.name : '항목 선택'}
          actions={selectedWildcard ? extraActions : undefined}
        />

        {selectedWildcard ? (
          <div className="space-y-4">
            <div className="rounded-sm border border-border bg-surface-low p-3 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => void onCopySyntax(selectedWildcardSyntax, '와일드카드 문법')}
                className="inline-flex max-w-full items-center rounded-sm bg-surface-lowest px-3 py-2 text-left transition-colors hover:bg-surface-high"
                title="클릭해서 복사"
              >
                <code className="truncate text-base font-semibold text-foreground md:text-lg">{selectedWildcardSyntax}</code>
              </button>
              <div className="mt-3 break-words text-xs">경로: {selectedEntry?.path.join(' / ') ?? selectedWildcard.name}</div>
              {selectedWildcard.description ? <div className="mt-2 text-xs">설명: {selectedWildcard.description}</div> : null}
              {selectedWildcard.source_path ? <div className="mt-2 break-all text-xs">소스: {selectedWildcard.source_path}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">하위 자동 포함 {selectedWildcard.include_children === 1 ? 'ON' : 'OFF'}</Badge>
                <Badge variant="outline">자식만 {selectedWildcard.only_children === 1 ? 'ON' : 'OFF'}</Badge>
                <Badge variant="outline">chain {selectedWildcard.chain_option}</Badge>
                {selectedWildcard.lora_weight != null ? <Badge variant="outline">LoRA weight {selectedWildcard.lora_weight}</Badge> : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 border-b border-border/70 pb-3">
                <button
                  type="button"
                  onClick={() => setActiveItemTool('comfyui')}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                    activeItemTool === 'comfyui'
                      ? 'bg-surface-high text-primary'
                      : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                  )}
                >
                  ComfyUI
                </button>
                <button
                  type="button"
                  onClick={() => setActiveItemTool('nai')}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                    activeItemTool === 'nai'
                      ? 'bg-surface-high text-primary'
                      : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                  )}
                >
                  NAI
                </button>
              </div>

              <WildcardItemSection title={activeItemTool === 'comfyui' ? 'ComfyUI 항목' : 'NAI 항목'} items={activeItems} />
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
          actions={log ? <Badge variant="outline">{log.totalWildcards}</Badge> : undefined}
        />

        {log ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">시간</div>
                <div className="mt-1 text-sm text-foreground">{formatDateTime(log.timestamp)}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">LoRA weight</div>
                <div className="mt-1 text-sm text-foreground">{log.loraWeight}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">중복 처리</div>
                <div className="mt-1 text-sm text-foreground">{log.duplicateHandling}</div>
              </div>
              <div className="rounded-sm border border-border bg-surface-low p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">생성 항목</div>
                <div className="mt-1 text-sm text-foreground">{log.totalItems}</div>
              </div>
            </div>

            <div className="space-y-2">
              {log.wildcards.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground">
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
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
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
  const selectedWildcardSyntax = selectedEntry ? `++${selectedEntry.wildcard.name}++` : ''
  const activeTabLabel = WORKSPACE_TABS.find((tab) => tab.value === activeWorkspaceTab)?.label ?? '와일드카드'
  const canCreateInActiveTab = canCreateWorkspaceTabItem(activeWorkspaceTab)
  const isReadonlyActiveTab = isReadonlyWorkspaceTab(activeWorkspaceTab)

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
    if (!selectedWildcardSyntax) {
      return
    }

    setPreviewText((current) => (current.trim().length === 0 ? selectedWildcardSyntax : current))
  }, [selectedWildcardSyntax])

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
    if (isReadonlyActiveTab) {
      showSnackbar({ message: '로라 탭 항목은 자동 수집 기반이라 편집할 수 없어.', tone: 'info' })
      return
    }

    if (!selectedWildcard) {
      return
    }

    setEditorState({
      mode: 'edit',
      wildcard: selectedWildcard,
    })
  }

  const handleDeleteSelected = async () => {
    if (isReadonlyActiveTab) {
      showSnackbar({ message: '로라 탭 항목은 자동 수집 기반이라 삭제할 수 없어.', tone: 'info' })
      return
    }

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
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
        <SegmentedControl
          value={activeWorkspaceTab}
          items={WORKSPACE_TABS}
          onChange={(nextTab) => setActiveWorkspaceTab(nextTab as WildcardWorkspaceTab)}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => setIsPreviewModalOpen(true)}
          aria-label="파싱 테스트"
          title="파싱 테스트"
        >
          <WandSparkles className="h-4 w-4" />
        </Button>
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
              <div className="flex flex-wrap items-center gap-2">
                {activeWorkspaceTab === 'lora' ? (
                  <>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="bg-surface-low"
                      onClick={() => setIsLoraCollectModalOpen(true)}
                      aria-label="자동 수집"
                      title="자동 수집"
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="bg-surface-low"
                      onClick={() => void loraScanLogQuery.refetch()}
                      disabled={loraScanLogQuery.isFetching}
                      aria-label="로그 새로고침"
                      title="로그 새로고침"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="bg-surface-low"
                      onClick={() => handleOpenCreateModal(selectedWildcard?.id ?? null)}
                      disabled={!canCreateInActiveTab}
                      aria-label="항목 추가"
                      title="항목 추가"
                    >
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="bg-surface-low"
                      onClick={handleOpenEditModal}
                      disabled={!selectedWildcard}
                      aria-label="편집"
                      title="편집"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="ml-2 bg-surface-low"
                      onClick={() => void handleDeleteSelected()}
                      disabled={!selectedWildcard || deleteMutation.isPending}
                      aria-label="삭제"
                      title="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="이름 또는 경로 검색" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0 bg-surface-low"
                  onClick={() => {
                    void wildcardsQuery.refetch()
                  }}
                  aria-label="새로고침"
                  title="새로고침"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
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
                            ? 'border-primary bg-surface-high'
                            : 'border-border bg-surface-lowest hover:border-primary/35',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium text-foreground">{wildcard.name}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{entry.path.join(' / ')}</div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">검색 결과가 없어.</div>
              )
            ) : browserTreeNodes.length > 0 ? (
              <WildcardTree entries={browserEntries} selectedId={selectedWildcardId} onSelect={setSelectedWildcardId} />
            ) : (
              <div className="text-sm text-muted-foreground">표시할 항목이 아직 없어.</div>
            )
          ) : null}
        </ExplorerSidebar>

        <section className="space-y-6">
          <WildcardDetailCard
            selectedEntry={selectedEntry}
            onCopySyntax={handleCopy}
            extraActions={selectedWildcard && !isReadonlyActiveTab ? (
              <>
                <Button type="button" variant="outline" size="icon-sm" className="bg-surface-low" onClick={handleOpenEditModal} aria-label="편집" title="편집">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon-sm" className="bg-surface-low" onClick={() => void handleDeleteSelected()} disabled={deleteMutation.isPending} aria-label="삭제" title="삭제">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : undefined}
          />


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

      <SettingsModal
        open={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        title={(
          <span className="flex items-center gap-2">
            <WandSparkles className="h-4 w-4 text-primary" />
            파싱 테스트
          </span>
        )}
        widthClassName="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px]">
            <Input value={selectedWildcardSyntax} readOnly placeholder="선택한 와일드카드 문법" />
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
            <Button type="button" variant="outline" onClick={() => setPreviewText(selectedWildcardSyntax)} disabled={!selectedWildcardSyntax}>
              <Braces className="h-4 w-4" />
              선택 항목 넣기
            </Button>
            <Button type="button" onClick={() => void handleParsePreview()} disabled={parseMutation.isPending || previewText.trim().length === 0}>
              <Sparkles className="h-4 w-4" />
              {parseMutation.isPending ? '테스트 중…' : '테스트'}
            </Button>
          </div>

          {parseMutation.isError ? (
            <Alert variant="destructive">
              <AlertTitle>테스트 실패</AlertTitle>
              <AlertDescription>{getErrorMessage(parseMutation.error, '테스트 중 오류가 났어.')}</AlertDescription>
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
                  <div key={`${index}:${result}`} className="rounded-sm border border-border bg-surface-low p-3 text-sm text-muted-foreground">
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
          ) : null}
        </div>
      </SettingsModal>

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




