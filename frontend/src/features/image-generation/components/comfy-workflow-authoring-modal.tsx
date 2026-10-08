import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useBlocker } from 'react-router-dom'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Save, Search, Upload } from 'lucide-react'
import { TextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useBlockerConfirm } from '@/components/ui/use-blocker-confirm'
import { shouldBypassOverlayHistoryBackNavigation, useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import type { CustomDropdownList } from '@/lib/api-image-generation-types'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { nodeTypes, type AuthoringEdge, type AuthoringNode } from './comfy-workflow-authoring-graph'
import { ComfyWorkflowAuthoringSettings } from './comfy-workflow-authoring-settings'
import { ComfyWorkflowMarkedFieldEditor } from './comfy-workflow-marked-field-editor'
import { ComfyWorkflowMarkedFieldList } from './comfy-workflow-marked-field-list'
import {
  INITIAL_AUTHORING_FIT_VIEW_OPTIONS,
  INITIAL_AUTHORING_VIEWPORT,
  useComfyWorkflowAuthoringController,
  type ComfyWorkflowAuthoringModalInitialData,
  type ComfyWorkflowEditorTab,
} from './use-comfy-workflow-authoring-controller'
import { resolveWorkflowMarkedFieldNodeSource } from '../workflow-marked-field-groups'

type ComfyWorkflowAuthoringModalProps = {
  open: boolean
  mode?: 'create' | 'edit'
  initialData?: ComfyWorkflowAuthoringModalInitialData | null
  dropdownLists: CustomDropdownList[]
  onClose: () => void
  onSaved?: (workflowId: number) => void
}

/** Search text with match count and previous/next, shared by the graph canvas and the JSON tab. */
function AuthoringSearchBox({ query, count, index, placeholder, onQueryChange, onStep, className }: {
  query: string
  count: number
  index: number
  placeholder: string
  onQueryChange: (value: string) => void
  onStep: (direction: 1 | -1) => void
  className?: string
}) {
  const { t, formatNumber } = useI18n()
  const hasQuery = query.trim().length > 0

  return (
    <div className={cn('flex h-10 items-center gap-0.5 rounded-md bg-surface-container pr-1 pl-3', className)}>
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          onStep(event.shiftKey ? -1 : 1)
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-44 min-w-0 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground sm:w-52"
      />
      {hasQuery ? (
        <span className="shrink-0 px-1 font-mono text-2xs text-muted-foreground tabular-nums">
          {count === 0 ? '0' : `${formatNumber(Math.min(index, count - 1) + 1)}/${formatNumber(count)}`}
        </span>
      ) : null}
      <IconButton size="icon-sm" variant="ghost" disabled={count === 0} onClick={() => onStep(-1)} label={t({ ko: '이전 결과', en: 'Previous result' })}>
        <ChevronUp />
      </IconButton>
      <IconButton size="icon-sm" variant="ghost" disabled={count === 0} onClick={() => onStep(1)} label={t({ ko: '다음 결과', en: 'Next result' })}>
        <ChevronDown />
      </IconButton>
    </div>
  )
}

/**
 * Full-screen ComfyUI workflow editor (create and edit), under the app header and beside a docked chat panel.
 * Top bar: name, graph / JSON / settings tabs, upload and save. The graph tab pairs the canvas with a field panel:
 * picking an input on the canvas selects its field, and the selected field's node is ringed on the canvas.
 */
export function ComfyWorkflowAuthoringModal({
  open,
  mode = 'create',
  initialData,
  dropdownLists,
  onClose,
  onSaved,
}: ComfyWorkflowAuthoringModalProps) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const isWideLayout = useDesktopPageLayout()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const {
    activeSearchCount,
    authoringMiniMapBgColor,
    authoringMiniMapMaskColor,
    authoringMiniMapNodeColor,
    draft,
    dropdownListNames,
    editorTab,
    graphNodes,
    handleFieldLocate,
    handleFieldPatch,
    handleFieldRemove,
    handleFieldSelect,
    handleFileUpload,
    handleReorderMarkedField,
    handleReorderMarkedFieldGroup,
    handleSave,
    handleWorkflowJsonChange,
    isCoarsePointer,
    isDirty,
    isSaving,
    jsonError,
    jsonTextareaRef,
    markedFieldsWithNodeSources,
    parsedGraph,
    patchDraft,
    reactFlowColorMode,
    roleLimitGroups,
    searchIndex,
    searchQuery,
    selectedField,
    setAuthoringFlowInstance,
    setEditorTab,
    setSearchQuery,
    stepSearch,
  } = useComfyWorkflowAuthoringController({
    dropdownLists,
    initialData,
    mode,
    onClose,
    onSaved,
    open,
  })

  const unsavedMessage = t({ ko: '저장하지 않은 변경이 사라져.', en: 'Unsaved changes will be lost.' })
  const shouldGuard = open && isDirty && !isSaving

  // Leaving with unsaved changes asks first: the back arrow, browser back, and app navigation.
  const requestClose = useCallback(async () => {
    if (isSaving) return
    if (isDirty) {
      const confirmed = await confirm({
        title: t({ ko: '저장하지 않은 변경', en: 'Unsaved changes' }),
        description: unsavedMessage,
        confirmLabel: t({ ko: '나가기', en: 'Leave' }),
        cancelLabel: t({ ko: '머무르기', en: 'Stay' }),
        tone: 'destructive',
      })
      if (!confirmed) return
    }
    onClose()
  }, [confirm, isDirty, isSaving, onClose, t, unsavedMessage])
  useOverlayBackClose({ open, onClose: () => { void requestClose() } })
  const navigationBlocker = useBlocker(useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string, search: string }, nextLocation: { pathname: string, search: string } }) => (
    shouldGuard
    && !shouldBypassOverlayHistoryBackNavigation()
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)
  ), [shouldGuard]))
  useBlockerConfirm(navigationBlocker, unsavedMessage)
  useEffect(() => {
    if (!shouldGuard) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [shouldGuard])

  // The editor covers the page: lock its scroll and move focus in, so keyboard users start inside the editor.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    containerRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const title = mode === 'edit' ? t({ ko: 'ComfyUI 워크플로우 수정', en: 'Edit ComfyUI workflow' }) : t({ ko: 'ComfyUI 워크플로우 등록', en: 'Register ComfyUI workflow' })
  const saveLabel = mode === 'edit' ? t({ ko: '저장', en: 'Save' }) : t({ ko: '등록', en: 'Register' })
  const selectedFieldNodeId = selectedField ? resolveWorkflowMarkedFieldNodeSource(selectedField).nodeId : null
  const openFilePicker = () => fileInputRef.current?.click()

  const bar = (
    <div className={cn('flex h-11 shrink-0 items-center gap-1 border-b border-line', isWideLayout ? 'px-2' : 'px-1')}>
      <IconButton size="icon-sm" variant="ghost" onClick={() => void requestClose()} label={t({ ko: '편집 끝내기', en: 'Leave editor' })}>
        <ArrowLeft />
      </IconButton>
      <div className="relative flex min-w-0 items-center">
        <input
          value={draft.name}
          onChange={(event) => patchDraft({ name: event.target.value })}
          aria-label={t({ ko: '워크플로우 이름', en: 'Workflow name' })}
          placeholder={t({ ko: '이름 없음', en: 'Untitled' })}
          className={cn(
            'h-8 min-w-20 rounded-sm bg-transparent px-1.5 text-sm font-bold text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground hover:bg-fill focus:bg-field',
            isWideLayout ? 'max-w-72' : 'max-w-28',
          )}
        />
        {isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-warning" title={t({ ko: '저장 안 함', en: 'Unsaved' })} /> : null}
      </div>
      <span className="mx-1 h-4 w-px shrink-0 bg-line" />
      <div className="flex h-full min-w-0 shrink items-end overflow-hidden">
        <TextTabs<ComfyWorkflowEditorTab>
          value={editorTab}
          onChange={setEditorTab}
          ariaLabel={t({ ko: '편집 화면', en: 'Editor view' })}
          className="border-b-0"
          items={[
            { value: 'graph', label: t({ ko: '그래프', en: 'Graph' }) },
            { value: 'json', label: 'JSON' },
            { value: 'settings', label: t({ ko: '설정', en: 'Settings' }) },
          ]}
        />
      </div>
      <span className="min-w-1 flex-1" />
      <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => { void handleFileUpload(event.target.files?.[0]); event.target.value = '' }} />
      <IconButton size="icon-sm" variant="ghost" className="shrink-0" onClick={openFilePicker} label={t({ ko: 'JSON 파일 불러오기', en: 'Load JSON file' })}>
        <Upload />
      </IconButton>
      {isWideLayout ? (
        <Button type="button" size="sm" onClick={() => void handleSave()} disabled={isSaving}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saveLabel}
        </Button>
      ) : (
        <IconButton size="icon-sm" variant="ghost" onClick={() => void handleSave()} disabled={isSaving} label={saveLabel} className="shrink-0 text-primary hover:text-primary">
          {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
        </IconButton>
      )}
    </div>
  )

  const graphCanvas = parsedGraph ? (
    <ReactFlowProvider>
      <ReactFlow<AuthoringNode, AuthoringEdge>
        className={isCoarsePointer ? 'theme-graph-flow touch-scroll-safe' : 'theme-graph-flow'}
        nodes={graphNodes}
        edges={parsedGraph.edges}
        nodeTypes={nodeTypes}
        onInit={setAuthoringFlowInstance}
        fitViewOptions={INITIAL_AUTHORING_FIT_VIEW_OPTIONS}
        defaultViewport={INITIAL_AUTHORING_VIEWPORT}
        colorMode={reactFlowColorMode}
        proOptions={{ hideAttribution: true }}
        defaultMarkerColor="var(--foreground)"
        defaultEdgeOptions={{ animated: false }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag={!isCoarsePointer}
      >
        {isWideLayout ? (
          <MiniMap
            pannable
            zoomable
            nodeColor={authoringMiniMapNodeColor}
            nodeStrokeColor={authoringMiniMapNodeColor}
            nodeStrokeWidth={3}
            maskColor={authoringMiniMapMaskColor}
            bgColor={authoringMiniMapBgColor}
            className="!bg-surface-lowest"
          />
        ) : null}
        <Controls />
        <Background color="color-mix(in srgb, var(--foreground) 10%, transparent)" />
      </ReactFlow>
    </ReactFlowProvider>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-sm text-muted-foreground">
        {jsonError ? jsonError : t({ ko: 'workflow JSON을 불러오면 그래프가 보여.', en: 'Load a workflow JSON to see the graph.' })}
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={openFilePicker}>
        <Upload className="size-4" />
        {t({ ko: 'JSON 불러오기', en: 'Load JSON' })}
      </Button>
    </div>
  )

  const fieldPanel = (
    <aside
      aria-label={t({ ko: '필드', en: 'Fields' })}
      className={cn('flex min-h-0 flex-col', isWideLayout ? 'border-l border-line' : 'border-t border-line')}
    >
      <ComfyWorkflowMarkedFieldList
        markedFields={markedFieldsWithNodeSources}
        selectedFieldId={selectedField?.id ?? null}
        onFieldSelect={handleFieldSelect}
        onReorderMarkedField={handleReorderMarkedField}
        onReorderMarkedFieldGroup={handleReorderMarkedFieldGroup}
      />
      {selectedField ? (
        <div className="max-h-[62%] shrink-0 overflow-y-auto overscroll-contain border-t border-line px-4 py-3">
          <ComfyWorkflowMarkedFieldEditor
            key={selectedField.id}
            field={selectedField}
            dropdownListNames={dropdownListNames}
            canLocate={Boolean(parsedGraph && selectedFieldNodeId)}
            onPatch={(patch) => handleFieldPatch(selectedField.id, patch)}
            onRemove={() => handleFieldRemove(selectedField.id)}
            onLocate={() => handleFieldLocate(selectedField.id)}
          />
        </div>
      ) : null}
    </aside>
  )

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-slot="comfy-workflow-editor"
      style={{ '--editor-side-inset': 'var(--chat-dock-width, 0px)' } as CSSProperties}
      className="fixed inset-x-0 bottom-0 top-(--theme-shell-header-height) z-modal flex flex-col bg-background outline-none lg:right-(--editor-side-inset)"
    >
      {bar}
      <div className="relative min-h-0 flex-1">
        {editorTab === 'graph' ? (
          <div className={cn('grid h-full min-h-0', isWideLayout ? 'grid-cols-[minmax(0,1fr)_minmax(320px,380px)]' : 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)]')}>
            <div className="relative min-h-0 min-w-0 bg-surface-lowest">
              {graphCanvas}
              {parsedGraph ? (
                <AuthoringSearchBox
                  className="absolute top-3 left-3 z-10 shadow-elevation-2"
                  query={searchQuery}
                  count={activeSearchCount}
                  index={searchIndex}
                  placeholder={t({ ko: '노드·입력 검색', en: 'Search nodes and inputs' })}
                  onQueryChange={setSearchQuery}
                  onStep={stepSearch}
                />
              ) : null}
            </div>
            {fieldPanel}
          </div>
        ) : editorTab === 'json' ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-end border-b border-line px-2 py-1.5">
              <AuthoringSearchBox
                className="h-9 bg-transparent"
                query={searchQuery}
                count={activeSearchCount}
                index={searchIndex}
                placeholder={t({ ko: 'JSON 검색', en: 'Search JSON' })}
                onQueryChange={setSearchQuery}
                onStep={stepSearch}
              />
            </div>
            <Textarea
              ref={jsonTextareaRef}
              variant="settings"
              value={draft.workflowJson}
              onChange={(event) => handleWorkflowJsonChange(event.target.value)}
              placeholder="ComfyUI API workflow JSON"
              aria-label="Workflow JSON"
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-4 font-mono text-xs focus:ring-0"
            />
            {jsonError ? <div role="alert" className="shrink-0 bg-destructive-soft/40 px-4 py-3 text-xs text-destructive-soft-foreground">{jsonError}</div> : null}
          </div>
        ) : (
          <ComfyWorkflowAuthoringSettings draft={draft} roleLimitGroups={roleLimitGroups} onPatch={patchDraft} />
        )}
      </div>
    </div>,
    document.body,
  )
}
