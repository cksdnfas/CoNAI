import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, ChevronUp, Search, Upload } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsSection, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { getPermissionGroupDisplayName } from '@/features/settings/components/security-ui-text'
import { useI18n } from '@/i18n'
import type { CustomDropdownList } from '@/lib/api-image-generation-types'
import { nodeTypes, type AuthoringEdge, type AuthoringNode } from './comfy-workflow-authoring-graph'
import { ComfyWorkflowMarkedFieldsEditor } from './comfy-workflow-marked-fields-editor'
import {
  INITIAL_AUTHORING_FIT_VIEW_OPTIONS,
  INITIAL_AUTHORING_VIEWPORT,
  useComfyWorkflowAuthoringController,
  type ComfyWorkflowAuthoringModalInitialData,
} from './use-comfy-workflow-authoring-controller'
import { clampPublicQueueMaxCount, slugifyPublicWorkflow } from './comfy-workflow-public-settings'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

type ComfyWorkflowAuthoringModalProps = {
  open: boolean
  mode?: 'create' | 'edit'
  initialData?: ComfyWorkflowAuthoringModalInitialData | null
  dropdownLists: CustomDropdownList[]
  onClose: () => void
  onSaved?: (workflowId: number) => void
}

export function ComfyWorkflowAuthoringModal({
  open,
  mode = 'create',
  initialData,
  dropdownLists,
  onClose,
  onSaved,
}: ComfyWorkflowAuthoringModalProps) {
  const { t, language } = useI18n()
  const {
    activeSearchCount,
    artifactDirectoryMode,
    artifactRootPath,
    authoringMiniMapBgColor,
    authoringMiniMapMaskColor,
    authoringMiniMapNodeColor,
    dropdownListNames,
    expandedFieldIds,
    formatNumber,
    graphNodes,
    graphSearchQuery,
    handleFieldExpandToggle,
    handleFieldPatch,
    handleFieldRemove,
    handleFileUpload,
    handleReorderMarkedField,
    handleReorderMarkedFieldGroup,
    handleSave,
    handleWorkflowJsonChange,
    isCoarsePointer,
    isPublicPage,
    isSaving,
    jsonError,
    jsonTextareaRef,
    markedFieldsWithNodeSources,
    parsedGraph,
    publicQueueMaxCount,
    publicQueueRoleLimits,
    publicSlug,
    reactFlowColorMode,
    resultViewMode,
    roleLimitGroups,
    searchPlaceholder,
    setArtifactDirectoryMode,
    setArtifactRootPath,
    setAuthoringFlowInstance,
    setGraphSearchIndex,
    setGraphSearchQuery,
    setIsPublicPage,
    setPublicQueueMaxCount,
    setPublicQueueRoleLimits,
    setPublicSlug,
    setResultViewMode,
    setWorkflowDescription,
    setWorkflowEditorTab,
    setWorkflowName,
    workflowDescription,
    workflowEditorTab,
    workflowJson,
    workflowName,
  } = useComfyWorkflowAuthoringController({
    dropdownLists,
    initialData,
    mode,
    onClose,
    onSaved,
    open,
  })

  const modalTitle = mode === 'edit' ? t({ ko: 'ComfyUI Workflow 수정', en: 'Edit ComfyUI Workflow' }) : t({ ko: 'ComfyUI Workflow 등록', en: 'Register ComfyUI Workflow' })
  const submitLabel = mode === 'edit' ? t({ ko: '워크플로우 저장', en: 'Save workflow' }) : t({ ko: '워크플로우 등록', en: 'Register workflow' })

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={modalTitle}
      widthClassName="max-w-[1180px]"
    >
      <SettingsModalBody className="space-y-5">
        <SettingsSection heading={t({ ko: '기본 정보', en: 'Basic information' })}>
          <div className="grid gap-4">
            <SettingsField label={t({ ko: '이름', en: 'Name' })}>
              <Input
                variant="settings"
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
                placeholder="ComfyUI Workflow"
              />
            </SettingsField>

            <SettingsField label={t({ ko: '설명', en: 'Description' })}>
              <Textarea
                variant="settings"
                rows={4}
                value={workflowDescription}
                onChange={(event) => setWorkflowDescription(event.target.value)}
                placeholder={t({ ko: '선택', en: 'Optional' })}
              />
            </SettingsField>

            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={isPublicPage}
                onChange={(event) => setIsPublicPage(event.target.checked)}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{t({ ko: '공용 페이지 사용', en: 'Use public page' })}</div>
              </div>
            </SettingsToggleRow>

            {isPublicPage ? (
              <>
                <SettingsField label={t({ ko: '공용 slug', en: 'Public slug' })}>
                  <Input
                    variant="settings"
                    value={publicSlug}
                    onChange={(event) => setPublicSlug(slugifyPublicWorkflow(event.target.value))}
                    placeholder="character-poster-generator"
                  />
                </SettingsField>

                <SettingsField label={t({ ko: '공용 1회 요청 상한', en: 'Public per-request limit' })}>
                  <NumberStepperInput
                    variant="settings"

                    min={1}
                    max={32}
                    value={publicQueueMaxCount}
                    onValueCommit={(nextValue) => setPublicQueueMaxCount(nextValue)}
                    onBlur={() => setPublicQueueMaxCount(String(clampPublicQueueMaxCount(publicQueueMaxCount)))}
                  />
                </SettingsField>

                <div className="grid gap-2.5 rounded-sm border border-border/70 px-3 py-3">
                  <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t({ ko: '등급별 동시 대기열 제한', en: 'Per-role active queue limit' })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t({
                      ko: '각 등급의 회원 한 명이 이 워크플로우에서 동시에 유지할 수 있는 대기열 개수야. 등급 전체 합산이 아니라 회원별 제한이고, 비워두면 무제한이야. 0은 등록 금지야.',
                      en: 'How many active queue jobs a single member of each role can keep on this workflow. The limit applies per member, not to the whole role. Leave empty for unlimited; 0 blocks the role.',
                    })}
                  </div>
                  {roleLimitGroups.map((group) => (
                    <div key={group.groupKey} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
                      </span>
                      <NumberStepperInput
                        variant="settings"
                        min={0}
                        max={999}
                        allowEmpty
                        className="w-44 shrink-0"
                        value={publicQueueRoleLimits[group.groupKey] ?? ''}
                        placeholder={t({ ko: '무제한', en: 'Unlimited' })}
                        aria-label={t(
                          { ko: '{name} 동시 대기열 제한', en: '{name} active queue limit' },
                          { name: getPermissionGroupDisplayName(language, group.groupKey, group.name) },
                        )}
                        onValueCommit={(nextValue) => setPublicQueueRoleLimits((current) => ({ ...current, [group.groupKey]: nextValue }))}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <SettingsField label={t({ ko: '결과 표시 방식', en: 'Result view' })}>
              <Select
                variant="settings"
                value={resultViewMode}
                onChange={(event) => setResultViewMode(event.target.value as 'history' | 'artifact_explorer')}
              >
                <option value="history">{t({ ko: '히스토리 뷰어', en: 'History viewer' })}</option>
                <option value="artifact_explorer">{t({ ko: '탐색형 뷰어', en: 'Explorer viewer' })}</option>
              </Select>
            </SettingsField>

            {resultViewMode === 'artifact_explorer' ? (
              <>
                <SettingsField label={t({ ko: '결과 저장 방식', en: 'Result storage mode' })}>
                  <Select
                    variant="settings"
                    value={artifactDirectoryMode}
                    onChange={(event) => setArtifactDirectoryMode(event.target.value as 'shared' | 'per_run')}
                  >
                    <option value="shared">{t({ ko: '공유 폴더', en: 'Shared folder' })}</option>
                    <option value="per_run">{t({ ko: '실행별 폴더', en: 'Folder per run' })}</option>
                  </Select>
                </SettingsField>

                <SettingsField label={t({ ko: '결과 저장 루트 경로', en: 'Result storage root path' })}>
                  <Input
                    variant="settings"
                    value={artifactRootPath}
                    onChange={(event) => setArtifactRootPath(event.target.value)}
                    placeholder={t({ ko: '기본값: runtime/artifacts/comfy-workflows/<workflow>', en: 'Default: runtime/artifacts/comfy-workflows/<workflow>' })}
                  />
                </SettingsField>
              </>
            ) : null}
          </div>
        </SettingsSection>

        <SettingsSection
          heading={
            <SegmentedControl
              value={workflowEditorTab}
              items={[
                { value: 'graph', label: t({ ko: '그래프 보기', en: 'Graph View' }) },
                { value: 'json', label: 'Workflow JSON' },
              ]}
              onChange={(nextTab) => setWorkflowEditorTab(nextTab as 'json' | 'graph')}
              size="sm"
            />
          }
          bodyClassName="space-y-0 px-0 py-0"
          headerClassName="flex-col items-stretch lg:flex-row lg:items-center"
          actions={
            <div className="flex w-full flex-wrap items-center justify-start gap-2 lg:w-auto lg:justify-end">
              <div className="relative min-w-0 basis-full flex-1 sm:basis-auto sm:min-w-[280px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  variant="settings"
                  value={graphSearchQuery}
                  onChange={(event) => setGraphSearchQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="pl-8"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {graphSearchQuery.trim().length > 0 ? t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(activeSearchCount) }) : t({ ko: '검색 없음', en: 'No search' })}
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={activeSearchCount === 0}
                onClick={() => setGraphSearchIndex((current) => (
                  activeSearchCount === 0
                    ? 0
                    : (current - 1 + activeSearchCount) % activeSearchCount
                ))}
                title={t({ ko: '이전 검색 결과', en: 'Previous search result' })}
                aria-label={t({ ko: '이전 검색 결과', en: 'Previous search result' })}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={activeSearchCount === 0}
                onClick={() => setGraphSearchIndex((current) => (
                  activeSearchCount === 0
                    ? 0
                    : (current + 1) % activeSearchCount
                ))}
                title={t({ ko: '다음 검색 결과', en: 'Next search result' })}
                aria-label={t({ ko: '다음 검색 결과', en: 'Next search result' })}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4" />
                  {t({ ko: '업로드', en: 'Upload' })}
                  <input type="file" accept=".json,application/json" hidden onChange={(event) => void handleFileUpload(event.target.files?.[0])} />
                </label>
              </Button>
            </div>
          }
        >
          {workflowEditorTab === 'json' ? (
            <div className="space-y-0">
              <Textarea
                ref={jsonTextareaRef}
                variant="settings"
                rows={12}
                value={workflowJson}
                onChange={(event) => handleWorkflowJsonChange(event.target.value)}
                placeholder="ComfyUI API workflow JSON"
                className="min-h-[520px] rounded-none border-0 bg-transparent px-4 py-4 font-mono text-xs focus:ring-0"
              />

              {jsonError ? <div className="border-t border-border/70 px-4 py-3 text-xs text-[#ffb4ab]">{jsonError}</div> : null}
            </div>
          ) : (
            <div className="px-4 py-4">
              <div className="mx-auto w-full max-w-[980px]">
                <div className="h-[620px] overflow-hidden rounded-sm border border-border/85 bg-surface-lowest">
                  {parsedGraph ? (
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
                        <Controls />
                        <Background color="color-mix(in srgb, var(--foreground) 10%, transparent)" />
                      </ReactFlow>
                    </ReactFlowProvider>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      {t({ ko: '유효한 workflow JSON을 넣으면 그래프가 보여.', en: 'Enter a valid workflow JSON to show the graph.' })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </SettingsSection>

        <ComfyWorkflowMarkedFieldsEditor
          markedFields={markedFieldsWithNodeSources}
          expandedFieldIds={expandedFieldIds}
          dropdownListNames={dropdownListNames}
          listClassName="max-h-[520px]"
          onFieldPatch={handleFieldPatch}
          onFieldRemove={handleFieldRemove}
          onFieldExpandToggle={handleFieldExpandToggle}
          onReorderMarkedField={handleReorderMarkedField}
          onReorderMarkedFieldGroup={handleReorderMarkedFieldGroup}
        />

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || workflowName.trim().length === 0 || workflowJson.trim().length === 0 || jsonError !== null}>
            {isSaving ? t({ ko: '저장 중…', en: 'Saving…' }) : submitLabel}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
