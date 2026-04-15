import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, WandSparkles } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
  type WildcardRecord,
  type WildcardTool,
} from '@/lib/api'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { LoraAutoCollectModal } from './lora-auto-collect-modal'
import { WildcardEditorModal, type WildcardEditorModalInput } from './wildcard-editor-modal'
import { LoraScanLogCard, WildcardDetailCard } from './wildcard-browser-cards'
import { WildcardExplorerSidebarPanel } from './wildcard-explorer-sidebar-panel'
import { WildcardPreviewModal } from './wildcard-preview-modal'
import {
  canCreateWorkspaceTabItem,
  copyWildcardText,
  filterWildcardTree,
  flattenWildcardTree,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  getWorkspaceTabRecordType,
  isReadonlyWorkspaceTab,
  matchesWorkspaceTab,
  type WildcardWorkspaceTab,
} from './wildcard-generation-panel-helpers'
import { getErrorMessage } from '../image-generation-shared'

type WildcardGenerationPanelProps = {
  refreshNonce: number
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
  const selectedWildcardSyntax = selectedEntry
    ? getWildcardPromptSyntax(selectedEntry.wildcard.name, { type: selectedEntry.wildcard.type, tab: activeWorkspaceTab })
    : ''
  const selectedWildcardSyntaxLabel = selectedEntry
    ? getWildcardPromptSyntaxLabel({ type: selectedEntry.wildcard.type, tab: activeWorkspaceTab })
    : '항목 문법'
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
      await copyWildcardText(text)
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
      <SegmentedTabBar
        value={activeWorkspaceTab}
        items={WORKSPACE_TABS}
        onChange={(nextTab) => setActiveWorkspaceTab(nextTab as WildcardWorkspaceTab)}
        actions={(
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
        )}
      />

      <div className={cn('grid gap-8', isWideLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
        <WildcardExplorerSidebarPanel
          isWideLayout={isWideLayout}
          activeWorkspaceTab={activeWorkspaceTab}
          browserEntries={browserEntries}
          browserTreeNodes={browserTreeNodes}
          filteredEntries={filteredEntries}
          selectedWildcardId={selectedWildcardId}
          selectedWildcard={selectedWildcard}
          searchInput={searchInput}
          canCreateInActiveTab={canCreateInActiveTab}
          isLoading={wildcardsQuery.isLoading}
          isError={wildcardsQuery.isError}
          isDeleting={deleteMutation.isPending}
          isRefreshingLog={loraScanLogQuery.isFetching}
          errorMessage={getErrorMessage(wildcardsQuery.error, '목록을 불러오지 못했어.')}
          onSearchChange={setSearchInput}
          onRefresh={() => {
            void wildcardsQuery.refetch()
          }}
          onOpenLoraCollect={() => setIsLoraCollectModalOpen(true)}
          onRefreshLoraLog={() => {
            void loraScanLogQuery.refetch()
          }}
          onOpenCreate={handleOpenCreateModal}
          onOpenEdit={handleOpenEditModal}
          onDeleteSelected={() => {
            void handleDeleteSelected()
          }}
          onSelectWildcard={setSelectedWildcardId}
        />

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

      <WildcardPreviewModal
        open={isPreviewModalOpen}
        selectedWildcardSyntax={selectedWildcardSyntax}
        selectedWildcardSyntaxLabel={selectedWildcardSyntaxLabel}
        previewTool={previewTool}
        previewCount={previewCount}
        previewText={previewText}
        isParsing={parseMutation.isPending}
        parseErrorMessage={parseMutation.isError ? getErrorMessage(parseMutation.error, '테스트 중 오류가 났어.') : null}
        parseResult={parseMutation.data ?? null}
        onClose={() => setIsPreviewModalOpen(false)}
        onPreviewToolChange={setPreviewTool}
        onPreviewCountChange={setPreviewCount}
        onPreviewTextChange={setPreviewText}
        onFillSelectedSyntax={() => setPreviewText(selectedWildcardSyntax)}
        onParsePreview={() => {
          void handleParsePreview()
        }}
        onCopyResult={(text, label) => {
          void handleCopy(text, label)
        }}
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




