import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, RefreshCw, Trash2, WandSparkles } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
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
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { ToolbarSearchField } from '@/features/prompts/components/toolbar-search-field'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { LoraAutoCollectModal } from './lora-auto-collect-modal'
import { WildcardEditorModal, type WildcardEditorModalInput } from './wildcard-editor-modal'
import { LoraScanLogCard, WildcardDetailCard } from './wildcard-browser-cards'
import { WildcardExplorerSidebarPanel } from './wildcard-explorer-sidebar-panel'
import { WildcardPreviewModal } from './wildcard-preview-modal'
import { WildcardSyntaxSettingsPanel } from './wildcard-syntax-settings-panel'
import {
  canCreateWorkspaceTabItem,
  copyWildcardText,
  getWildcardPromptSyntax,
  getWildcardPromptSyntaxLabel,
  getWildcardWorkspacePermissions,
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
    { value: 'settings', label: t({ ko: '설정', en: 'Settings' }) },
  ]
}

/** The /wildcards page: tab switch and search in one toolbar, the tab's tree in the sidebar, the selection flat on the right. */
export function WildcardGenerationPanel({ refreshNonce }: WildcardGenerationPanelProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  const authStatusQuery = useAuthStatusQuery()

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
  const isSettingsTab = activeWorkspaceTab === 'settings'
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
  const { canEditWildcardEntries, canDeleteWildcardEntries, canScanLora } = getWildcardWorkspacePermissions(permissionKeys)
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
    const confirmed = await confirm({
      title: t({ ko: '항목 삭제', en: 'Delete item' }),
      description: hasChildren
        ? t({ ko: '{name} 항목을 삭제할까? 하위 항목 처리 방식도 바로 이어서 물어볼게.', en: 'Delete the {name} item? I will ask how to handle child items next.' }, { name: selectedWildcard.name })
        : t({ ko: '{name} 항목을 삭제할까?', en: 'Delete the {name} item?' }, { name: selectedWildcard.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    const cascade = hasChildren
      ? await confirm({
        title: t({ ko: '하위 항목도 삭제할까?', en: 'Delete child items too?' }),
        description: t({ ko: '현재 항목만 삭제하면 하위 항목은 한 단계 위로 올라가.', en: 'Deleting only this item moves its children up one level.' }),
        confirmLabel: t({ ko: '하위 항목까지 삭제', en: 'Delete children too' }),
        cancelLabel: t({ ko: '현재 항목만 삭제', en: 'Delete only this item' }),
        tone: 'destructive',
      })
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

  const toolbar = (
    <PageToolbar
      start={(
        <SegmentedControl
          value={activeWorkspaceTab}
          items={workspaceTabs}
          onChange={(nextTab) => setActiveWorkspaceTab(nextTab as WildcardWorkspaceTab)}
          size="sm"
          semantics="tabs"
          ariaLabel={t({ ko: '와일드카드 종류', en: 'Wildcard kind' })}
        />
      )}
      actions={(
        <>
          {!isSettingsTab ? (
            <IconButton variant="ghost" size="icon-sm" onClick={() => void wildcardsQuery.refetch()} label={t('image-generation.components.wildcard.explorer.sidebar.panel.refresh')}>
              <RefreshCw />
            </IconButton>
          ) : null}
          <IconButton variant="ghost" size="icon-sm" onClick={() => setIsPreviewModalOpen(true)} label={t('image-generation.components.wildcard.generation.panel.parsing.test')}>
            <WandSparkles />
          </IconButton>
        </>
      )}
    >
      {!isSettingsTab ? (
        <ToolbarSearchField
          value={searchInput}
          placeholder={t('image-generation.components.wildcard.explorer.sidebar.panel.search.name.or.path')}
          onChange={setSearchInput}
        />
      ) : null}
    </PageToolbar>
  )

  return (
    <>
      {isSettingsTab ? (
        <div>
          {toolbar}
          <WildcardSyntaxSettingsPanel />
        </div>
      ) : (
        <PageWithSidebar
          storageKey="wildcards"
          sidebarLabel={activeTabLabel}
          toolbar={toolbar}
          sidebar={(
            <WildcardExplorerSidebarPanel
              activeWorkspaceTab={activeWorkspaceTab}
              tabLabel={activeTabLabel}
              browserEntries={browserEntries}
              browserTreeNodes={browserTreeNodes}
              filteredEntries={filteredEntries}
              selectedWildcardId={selectedWildcardId}
              selectedWildcard={selectedWildcard}
              searchInput={searchInput}
              canCreateInActiveTab={canCreateInActiveTab}
              canEditInActiveTab={canEditWildcardEntries && !isReadonlyActiveTab}
              canScanLora={canScanLora}
              isLoading={wildcardsQuery.isLoading}
              isError={wildcardsQuery.isError}
              isRefreshingLog={loraScanLogQuery.isFetching}
              errorMessage={getErrorMessage(wildcardsQuery.error, t('image-generation.components.wildcard.generation.panel.could.not.load.the.list'))}
              onOpenLoraCollect={() => setIsLoraCollectModalOpen(true)}
              onRefreshLoraLog={() => {
                void loraScanLogQuery.refetch()
              }}
              onOpenCreate={handleOpenCreateModal}
              onSelectWildcard={setSelectedWildcardId}
            />
          )}
        >
          <div className="max-w-5xl space-y-10 pt-2">
            <WildcardDetailCard
              selectedEntry={selectedEntry}
              onCopySyntax={handleCopy}
              extraActions={selectedWildcard && !isReadonlyActiveTab && (canEditWildcardEntries || canDeleteWildcardEntries) ? (
                <>
                  {canEditWildcardEntries ? (
                    <IconButton variant="ghost" size="icon-sm" onClick={handleOpenEditModal} label={t('image-generation.components.wildcard.generation.panel.edit')}>
                      <Pencil />
                    </IconButton>
                  ) : null}
                  {canDeleteWildcardEntries ? (
                    <IconButton variant="ghost" size="icon-sm" onClick={() => void handleDeleteSelected()} disabled={deleteMutation.isPending} label={t('image-generation.components.wildcard.generation.panel.delete')}>
                      <Trash2 />
                    </IconButton>
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
          </div>
        </PageWithSidebar>
      )}

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
    </>
  )
}




