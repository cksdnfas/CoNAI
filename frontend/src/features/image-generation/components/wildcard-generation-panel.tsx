import { useEffect, useState } from 'react'
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
} from '@/lib/api-wildcards'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { LoraAutoCollectModal } from './lora-auto-collect-modal'
import { WildcardEditorModal, type WildcardEditorModalInput } from './wildcard-editor-modal'
import { LoraScanLogCard, WildcardDetailCard } from './wildcard-browser-cards'
import { WildcardExplorerSidebarPanel } from './wildcard-explorer-sidebar-panel'
import { WildcardPreviewModal } from './wildcard-preview-modal'
import {
  canCreateWorkspaceTabItem,
  copyWildcardText,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  getWorkspaceTabRecordType,
  isReadonlyWorkspaceTab,
  type WildcardWorkspaceTab,
} from './wildcard-generation-panel-helpers'
import { useWildcardWorkspaceBrowser } from './use-wildcard-workspace-browser'
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

function getWorkspaceTabs(t: ReturnType<typeof useI18n>['t']): Array<{ value: WildcardWorkspaceTab; label: string }> {
  return [
    { value: 'wildcards', label: t('image-generation.components.wildcard.generation.panel.wildcard') },
    { value: 'preprocess', label: t('image-generation.components.wildcard.generation.panel.preprocess') },
    { value: 'lora', label: t('image-generation.components.wildcard.generation.panel.lora') },
  ]
}

/** Render the shared wildcard/preprocess/lora workspace with one common UI and tab-based data filters. */
export function WildcardGenerationPanel({ refreshNonce }: WildcardGenerationPanelProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const isWideLayout = useDesktopPageLayout()

  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WildcardWorkspaceTab>('wildcards')
  const [searchInput, setSearchInput] = useState('')
  const [previewTool, setPreviewTool] = useState<WildcardTool | 'codex'>('general')
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
    mutationFn: (input: { text: string; tool: WildcardTool | 'codex'; count: number }) => parseWildcards(input),
  })

  const createMutation = useMutation({
    mutationFn: createWildcard,
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.item.created'), tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      setSelectedWildcardId(result.id)
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.wildcard.generation.panel.failed.to.create.item')), tone: 'error' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ wildcardId, input }: { wildcardId: number; input: Parameters<typeof updateWildcard>[1] }) => updateWildcard(wildcardId, input),
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.item.saved'), tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      setSelectedWildcardId(result.id)
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.wildcard.generation.panel.failed.to.save.item')), tone: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ wildcardId, cascade }: { wildcardId: number; cascade: boolean }) => deleteWildcard(wildcardId, { cascade }),
    onSuccess: async () => {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.item.deleted'), tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['wildcards'] })
      setSelectedWildcardId(null)
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.wildcard.generation.panel.failed.to.delete.item')), tone: 'error' })
    },
  })

  const loraCollectMutation = useMutation({
    mutationFn: (input: LoraScanRequest) => scanWildcardLoraFolder(input),
    onSuccess: async (result) => {
      setIsLoraCollectModalOpen(false)
      showSnackbar({ message: t({ ko: 'LoRA 자동 수집 완료. {count}개 항목을 만들었어.', en: 'LoRA auto-collect complete. Created {count} items.' }, { count: result.created }), tone: 'info' })
      setSelectedWildcardId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wildcards'] }),
        queryClient.invalidateQueries({ queryKey: ['wildcards', 'lora-scan-log'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.wildcard.generation.panel.lora.auto.collect.failed')), tone: 'error' })
    },
  })

  const workspaceTabs = getWorkspaceTabs(t)

  const {
    treeNodes: browserTreeNodes,
    entries: browserEntries,
    filteredEntries,
    selectedWildcardId,
    selectedEntry,
    setSelectedWildcardId,
  } = useWildcardWorkspaceBrowser({
    records: wildcardsQuery.data ?? [],
    activeTab: activeWorkspaceTab,
    searchQuery: searchInput,
  })
  const selectedWildcard = selectedEntry?.wildcard ?? null
  const selectedWildcardSyntax = selectedEntry
    ? getWildcardPromptSyntax(selectedEntry.wildcard.name, { type: selectedEntry.wildcard.type, tab: activeWorkspaceTab })
    : ''
  const selectedWildcardSyntaxLabel = selectedEntry
    ? getWildcardPromptSyntaxLabel(
        { type: selectedEntry.wildcard.type, tab: activeWorkspaceTab },
        {
          preprocess: t('image-generation.components.wildcard.generation.panel.helpers.preprocess.keyword'),
          wildcard: t('image-generation.components.wildcard.generation.panel.helpers.wildcard.syntax'),
        },
      )
    : t('image-generation.components.wildcard.generation.panel.item.syntax')
  const activeTabLabel = workspaceTabs.find((tab) => tab.value === activeWorkspaceTab)?.label ?? t('image-generation.components.wildcard.generation.panel.wildcard')
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const canEditWildcardEntries = hasAuthPermission(permissionKeys, 'wildcards.edit')
  const canDeleteWildcardEntries = hasAuthPermission(permissionKeys, 'wildcards.delete')
  const canScanLora = hasAuthPermission(permissionKeys, 'wildcards.lora.scan')
  const canCreateInActiveTab = canCreateWorkspaceTabItem(activeWorkspaceTab) && canEditWildcardEntries
  const isReadonlyActiveTab = isReadonlyWorkspaceTab(activeWorkspaceTab)

  useEffect(() => {
    if (!selectedWildcardSyntax) {
      return
    }

    setPreviewText((current) => (current.trim().length === 0 ? selectedWildcardSyntax : current))
  }, [selectedWildcardSyntax])

  const handleCopy = async (text: string, label: string) => {
    try {
      await copyWildcardText(text)
      showSnackbar({ message: t({ ko: '{label} 복사했어.', en: 'Copied {label}.' }, { label }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '{label} 복사에 실패했어.', en: 'Failed to copy {label}.' }, { label })), tone: 'error' })
    }
  }

  const handleParsePreview = async () => {
    const text = previewText.trim()
    if (!text) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.enter.text.to.preview.first'), tone: 'error' })
      return
    }

    try {
      await parseMutation.mutateAsync({
        text,
        tool: previewTool,
        count: Math.max(1, Math.min(10, Number(previewCount) || 5)),
      })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('image-generation.components.wildcard.generation.panel.failed.to.generate.preview')), tone: 'error' })
    }
  }

  const handleOpenCreateModal = (defaultParentId: number | null) => {
    if (!canEditWildcardEntries) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.this.account.cannot.add.items'), tone: 'info' })
      return
    }

    if (!canCreateWorkspaceTabItem(activeWorkspaceTab)) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.the.lora.tab.is.based.on.auto'), tone: 'info' })
      return
    }

    setEditorState({
      mode: 'create',
      defaultParentId,
    })
  }

  const handleOpenEditModal = () => {
    if (!canEditWildcardEntries) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.this.account.cannot.edit.items'), tone: 'info' })
      return
    }

    if (isReadonlyActiveTab) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.lora.tab.items.are.auto.collected.and'), tone: 'info' })
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
    if (!canDeleteWildcardEntries) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.this.account.cannot.delete.items'), tone: 'info' })
      return
    }

    if (isReadonlyActiveTab) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.lora.tab.items.are.auto.collected.and.9e6c6b9d'), tone: 'info' })
      return
    }

    if (!selectedWildcard) {
      return
    }

    const hasChildren = browserEntries.some((entry) => entry.wildcard.parent_id === selectedWildcard.id)
    const confirmed = window.confirm(
      hasChildren
        ? t({ ko: '{name} 항목을 삭제할까? 하위 항목 처리 방식도 바로 이어서 물어볼게.', en: 'Delete the {name} item? I will ask how to handle child items next.' }, { name: selectedWildcard.name })
        : t({ ko: '{name} 항목을 삭제할까?', en: 'Delete the {name} item?' }, { name: selectedWildcard.name }),
    )
    if (!confirmed) {
      return
    }

    const cascade = hasChildren
      ? window.confirm(t('image-generation.components.wildcard.generation.panel.delete.all.child.items.too.nok.delete'))
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
    if (!canScanLora) {
      showSnackbar({ message: t('image-generation.components.wildcard.generation.panel.this.account.cannot.run.lora.auto.collect'), tone: 'info' })
      return
    }

    await loraCollectMutation.mutateAsync(input)
  }

  return (
    <div className="space-y-6">
      <SegmentedTabBar
        value={activeWorkspaceTab}
        items={workspaceTabs}
        onChange={(nextTab) => setActiveWorkspaceTab(nextTab as WildcardWorkspaceTab)}
        actions={(
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => setIsPreviewModalOpen(true)}
            aria-label={t('image-generation.components.wildcard.generation.panel.parsing.test')}
            title={t('image-generation.components.wildcard.generation.panel.parsing.test')}
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
          canEditInActiveTab={canEditWildcardEntries && !isReadonlyActiveTab}
          canDeleteInActiveTab={canDeleteWildcardEntries && !isReadonlyActiveTab}
          canScanLora={canScanLora}
          isLoading={wildcardsQuery.isLoading}
          isError={wildcardsQuery.isError}
          isDeleting={deleteMutation.isPending}
          isRefreshingLog={loraScanLogQuery.isFetching}
          errorMessage={getErrorMessage(wildcardsQuery.error, t('image-generation.components.wildcard.generation.panel.could.not.load.the.list'))}
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
            extraActions={selectedWildcard && !isReadonlyActiveTab && (canEditWildcardEntries || canDeleteWildcardEntries) ? (
              <>
                {canEditWildcardEntries ? (
                  <Button type="button" variant="outline" size="icon-sm" className="bg-surface-low" onClick={handleOpenEditModal} aria-label={t('image-generation.components.wildcard.generation.panel.edit')} title={t('image-generation.components.wildcard.generation.panel.edit')}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
                {canDeleteWildcardEntries ? (
                  <Button type="button" variant="outline" size="icon-sm" className="bg-surface-low" onClick={() => void handleDeleteSelected()} disabled={deleteMutation.isPending} aria-label={t('image-generation.components.wildcard.generation.panel.delete')} title={t('image-generation.components.wildcard.generation.panel.delete')}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </>
            ) : undefined}
          />


          {activeWorkspaceTab === 'lora' ? (
            loraScanLogQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t('image-generation.components.wildcard.generation.panel.could.not.load.lora.scan.logs')}</AlertTitle>
                <AlertDescription>{getErrorMessage(loraScanLogQuery.error, t('image-generation.components.wildcard.generation.panel.could.not.load.recent.scan.logs'))}</AlertDescription>
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
        parseErrorMessage={parseMutation.isError ? getErrorMessage(parseMutation.error, t('image-generation.components.wildcard.generation.panel.an.error.occurred.during.the.test')) : null}
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




