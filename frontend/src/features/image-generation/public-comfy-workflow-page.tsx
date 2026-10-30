import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useI18n } from '@/i18n'
import type { GenerationWorkflowDetail, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { DEFAULT_COMFY_MODEL_API_PATHS, getGenerationWorkflow, getGenerationCustomDropdownLists, scanGenerationComfyUIModelDropdownLists } from '@/lib/api-image-generation-workflows'
import { getPublicGenerationWorkflow, queuePublicGenerationWorkflowJob } from '@/lib/api-public-workflows'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { refreshGenerationQueueViews } from './components/generation-queue-actions'
import { GenerationNarrowSplit, type GenerationNarrowView } from './components/generation-narrow-split'
import { GenerationResultArea, type GenerationResultView } from './components/generation-result-area'
import { ComfyWorkflowControllerPanel } from './components/comfy-workflow-controller-panel'
import { useGenerationImageSaveOptions } from './components/use-generation-image-save-options'
import { useComfyWorkflowDraft } from './components/use-comfy-workflow-draft'
import { useComfyFieldValidation } from './components/use-comfy-field-validation'
import { useHistorySettingsLoad } from './components/use-history-settings-load'
import { useChatPage } from '@/features/codex-chat/chat-page-context'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { WorkflowArtifactExplorerPanel } from './components/workflow-artifact-explorer-panel'
import { useComfyChatPage } from './components/use-comfy-chat-page'
import { ComfyWorkflowAuthoringModal } from './components/comfy-workflow-authoring-modal'
import { findAutoCollectedPowerLoraOptions } from './components/power-lora-loader-utils'
import { useGenerationHistoryFeed } from './components/use-generation-history-feed'
import { GenerationLayoutControls } from './layout/generation-layout-controls'
import { GenerationLayoutProvider, useGenerationLayout } from './layout/generation-layout-context'
import { GenerationLayoutListEditor } from './layout/generation-layout-list-editor'
import { resolveRecentStripPlacement } from './layout/generation-layout-ops'
import {
  buildWorkflowDraft,
  buildWorkflowPromptData,
} from './image-generation-drafts'
import { buildComfyDraftFromHistoryPayload, confirmHistorySettingsOverwrite, getHistorySettingsLoadedMessage, hasWorkflowDraftDifference } from './history-settings-mapping'
import {
  getErrorMessage,
  parseNumberInput,
  type ComfyUIServerTestState,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from './image-generation-shared'

const PUBLIC_QUEUE_REGISTRATION_MIN = 1
const PUBLIC_QUEUE_REGISTRATION_MAX_FALLBACK = 32
const PUBLIC_STICKY_ACTION_BAR_SLOT_ID = 'public-workflow-sticky-action-bar'
const NO_SERVER_TESTS: Record<number, ComfyUIServerTestState> = {}
const ignoreTargetChange = () => {}

function resolvePublicQueueMaxCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PUBLIC_QUEUE_REGISTRATION_MAX_FALLBACK
  }

  return Math.min(PUBLIC_QUEUE_REGISTRATION_MAX_FALLBACK, Math.max(PUBLIC_QUEUE_REGISTRATION_MIN, Math.trunc(value)))
}

function clampQueueRegistrationCount(value: string, maxCount: number) {
  const parsed = Math.trunc(parseNumberInput(value, PUBLIC_QUEUE_REGISTRATION_MIN))
  return Math.min(maxCount, Math.max(PUBLIC_QUEUE_REGISTRATION_MIN, parsed))
}

/**
 * A ComfyUI workflow shared by link. It is the generation page's workflow screen (same controller, result area and
 * layout presets); only the data routes differ: the public ones, where the server picks the ComfyUI target and
 * applies the viewer's queue limits.
 */
export function PublicComfyWorkflowPage() {
  return (
    <GenerationLayoutProvider>
      <PublicComfyWorkflowPageContent />
    </GenerationLayoutProvider>
  )
}

function PublicComfyWorkflowPageContent() {
  const { slug = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isWideLayout = useDesktopPageLayout()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const chatPage = useChatPage()
  const confirm = useConfirm()
  const generationLayout = useGenerationLayout()
  const authStatusQuery = useAuthStatusQuery()
  const draftStorageOwner = resolveAccountDraftOwner(authStatusQuery.data)
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [resultView, setResultView] = useState<GenerationResultView>('stage')
  const [narrowView, setNarrowView] = useState<GenerationNarrowView>('edit')
  const [queueRegistrationCount, setQueueRegistrationCount] = useState('1')
  const [authoringWorkflow, setAuthoringWorkflow] = useState<GenerationWorkflowDetail | null>(null)
  const [isAuthoringOpen, setIsAuthoringOpen] = useState(false)
  const authoringDropdowns = useQuery({ queryKey: ['image-generation-custom-dropdown-lists'], queryFn: getGenerationCustomDropdownLists, enabled: isAuthoringOpen || authStatusQuery.data?.permissionKeys.includes('workflows.view') === true })
  const [isQueueSubmitting, setIsQueueSubmitting] = useState(false)
  const [isRefreshingDropdownLists, setIsRefreshingDropdownLists] = useState(false)

  const workflowQuery = useQuery({
    queryKey: ['public-generation-workflow', slug],
    queryFn: () => getPublicGenerationWorkflow(slug),
    enabled: slug.trim().length > 0 && authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const { options: generationImageSaveOptions } = useGenerationImageSaveOptions(authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true)

  const workflow = workflowQuery.data ?? null
  const workflowFields = useMemo(() => (workflow?.marked_fields ?? []) as WorkflowMarkedField[], [workflow?.marked_fields])
  const { workflowDraft, setWorkflowDraft, workflowDraftOwnerId, persistDraft, resetDraft } = useComfyWorkflowDraft(draftStorageOwner, workflow, workflowFields)
  const { fieldIssues, clearFieldIssue, clearFieldIssues, validate } = useComfyFieldValidation(workflow?.id ?? null, workflowFields, workflowDraft, showSnackbar)
  const shouldShowArtifactExplorer = workflow?.result_view_mode === 'artifact_explorer'
  const publicQueueMaxCount = resolvePublicQueueMaxCount(workflow?.public_queue_max_count)
  // 등급별 회원 1인당 동시 대기열 제한(조회 시점 스냅샷). 최종 판정은 서버가 한다.
  const viewerQueueRoleLimit = typeof workflow?.viewer_queue_role_limit === 'number' ? workflow.viewer_queue_role_limit : null
  const viewerQueueRoleActive = typeof workflow?.viewer_queue_role_active === 'number' ? workflow.viewer_queue_role_active : 0
  const viewerQueueRoleLabel = workflow?.viewer_queue_role_label ?? null
  const viewerQueueRoleLimitReached = viewerQueueRoleLimit !== null
    && (viewerQueueRoleLimit <= 0 || viewerQueueRoleActive >= viewerQueueRoleLimit)
  const historyFeed = useGenerationHistoryFeed({
    refreshNonce: historyRefreshNonce,
    serviceType: 'comfyui',
    workflowId: workflow?.id ?? null,
    publicWorkflowSlug: slug,
    enabled: workflow !== null && (!shouldShowArtifactExplorer || chatPage?.enabled === true),
  })

  useEffect(() => {
    setQueueRegistrationCount((current) => String(clampQueueRegistrationCount(current, publicQueueMaxCount)))
  }, [publicQueueMaxCount])

  const handleFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
    clearFieldIssue(fieldId)
  }

  const handleImageChange = (fieldId: string, image?: SelectedImageDraft) => {
    handleFieldChange(fieldId, image ?? '')
  }

  useHistorySettingsLoad('comfyui', (request) => {
    if (!workflow || request.workflowId !== workflow.id) {
      showSnackbar({ message: t({ ko: '이 기록의 워크플로우가 현재 공유 화면과 달라.', en: 'This record belongs to a different workflow.' }), tone: 'error' })
      return
    }
    if (workflowDraftOwnerId !== workflow.id) return false
    const result = buildComfyDraftFromHistoryPayload(request.payload, workflowFields, workflowDraft)
    if (!result) {
      showSnackbar({ message: t({ ko: '이 기록에는 불러올 워크플로우 입력이 없어.', en: 'This record has no workflow inputs to load.' }), tone: 'error' })
      return
    }
    void (async () => {
      const dirty = hasWorkflowDraftDifference(workflowFields, workflowDraft, buildWorkflowDraft(workflowFields))
      if (dirty && hasWorkflowDraftDifference(workflowFields, workflowDraft, result.draft) && !(await confirmHistorySettingsOverwrite(confirm, t))) return
      if (!persistDraft(result.draft)) return
      setWorkflowDraft(result.draft)
      clearFieldIssues()
      showSnackbar({ message: getHistorySettingsLoadedMessage(t, request.historyId, result.hasImageInputs), tone: 'info' })
    })()
  })

  const loraOptions = findAutoCollectedPowerLoraOptions(authoringDropdowns.data ?? [])
  useComfyChatPage(workflow, workflowFields, workflowDraft, workflowDraftOwnerId, handleFieldChange, {
    enabled: !!workflow && !isAuthoringOpen,
    generate: () => handleQueueSubmit(),
    records: historyFeed.historyRecords,
    queueCount: clampQueueRegistrationCount(queueRegistrationCount, publicQueueMaxCount),
    replaceDraft: (next) => { if (!persistDraft(next)) throw new Error('워크플로우 초안이 바뀌었어.'); setWorkflowDraft(next); clearFieldIssues() },
    loraOptions,
    onRefresh: async () => { const result = await workflowQuery.refetch(); if (result.error) throw result.error },
    onOpenCreate: authStatusQuery.data?.permissionKeys.includes('workflows.edit') && authStatusQuery.data.permissionKeys.includes('workflows.view') ? () => { setAuthoringWorkflow(null); setIsAuthoringOpen(true) } : undefined,
    onOpenEdit: authStatusQuery.data?.permissionKeys.includes('workflows.edit') && authStatusQuery.data.permissionKeys.includes('workflows.view') ? async (id, assertCurrent) => { const detail = await getGenerationWorkflow(id); assertCurrent(); setAuthoringWorkflow(detail); setIsAuthoringOpen(true) } : undefined,
  })

  const handleResetDraft = async () => {
    if (await resetDraft()) clearFieldIssues()
  }

  const handleRefreshDropdownLists = async () => {
    if (isRefreshingDropdownLists) {
      return
    }

    try {
      setIsRefreshingDropdownLists(true)
      const response = await scanGenerationComfyUIModelDropdownLists({ apiPaths: DEFAULT_COMFY_MODEL_API_PATHS })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['image-generation-custom-dropdown-lists'] }),
        workflowQuery.refetch(),
      ])
      showSnackbar({ message: response.data.message || t({ ko: '자동수집 목록을 갱신했어.', en: 'Refreshed the auto-collect list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '자동수집 목록 생성에 실패했어.', en: 'Failed to create the auto-collect list.' })), tone: 'error' })
    } finally {
      setIsRefreshingDropdownLists(false)
    }
  }

  const handleQueueSubmit = async () => {
    if (!workflow || isQueueSubmitting) {
      return false
    }

    if (!validate()) return false

    const promptData = buildWorkflowPromptData(workflowFields, workflowDraft)
    const registrationCount = clampQueueRegistrationCount(queueRegistrationCount, publicQueueMaxCount)

    try {
      setIsQueueSubmitting(true)
      const result = await queuePublicGenerationWorkflowJob(slug, {
        enqueue_count: registrationCount,
        request_summary: `${workflow.name} public queue job`,
        request_payload: {
          prompt_data: promptData,
          imageSaveOptions: generationImageSaveOptions,
        },
      })

      const successCount = result.enqueued_count ?? result.records?.filter(Boolean).length ?? (result.record ? 1 : 0)

      void refreshGenerationQueueViews(queryClient, () => setHistoryRefreshNonce((current) => current + 1))
      showSnackbar({ message: t({ ko: '{name} 큐에 {count}건 등록했어.', en: 'Queued {count} job(s) for {name}.' }, { name: workflow.name, count: successCount }), tone: 'info' })
      return successCount >= registrationCount ? true : successCount > 0 ? { queued: successCount, requested: registrationCount } : false
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '공용 워크플로우 큐 등록에 실패했어.', en: 'Failed to enqueue the public workflow.' })), tone: 'error' })
      return false
    } finally {
      setIsQueueSubmitting(false)
      if (viewerQueueRoleLimit !== null) {
        // 등급별 제한 배너의 진행 중 개수를 서버 기준으로 다시 맞춘다.
        void workflowQuery.refetch()
      }
    }
  }

  if (authStatusQuery.isLoading) {
    return <div className="ui-tone-plinth min-h-[40vh] animate-pulse rounded-sm" />
  }

  if (authStatusQuery.data?.hasCredentials === false) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t({ ko: '게스트 로그인 전용 페이지야', en: 'This page is for guest login only' })}</AlertTitle>
        <AlertDescription>{t({ ko: '이 공용 워크플로우 페이지는 로컬 인증과 게스트 계정 구성이 먼저 필요해.', en: 'This public workflow page requires local authentication and guest account setup first.' })}</AlertDescription>
      </Alert>
    )
  }

  if (authStatusQuery.data?.hasCredentials && authStatusQuery.data.authenticated !== true) {
    const nextPath = `${location.pathname}${location.search}` || '/'
    return <Navigate to={`/login?next=${encodeURIComponent(nextPath)}`} replace />
  }

  const viewerRoleName = viewerQueueRoleLabel ?? t({ ko: '현재', en: 'current' })
  const queueLimitNotice = viewerQueueRoleLimit !== null ? (
    <Alert variant={viewerQueueRoleLimitReached ? 'destructive' : undefined}>
      <AlertTitle>{t({ ko: '대기열 생성 제한', en: 'Queue creation limit' })}</AlertTitle>
      <AlertDescription>
        {viewerQueueRoleLimit <= 0
          ? t(
            { ko: '{role} 등급은 이 워크플로우에서 대기열을 만들 수 없어.', en: 'The {role} role cannot create queue jobs on this workflow.' },
            { role: viewerRoleName },
          )
          : viewerQueueRoleLimitReached
            ? t(
              { ko: '{role} 등급은 이 워크플로우에서 동시에 {limit}개까지만 대기열을 만들 수 있어. 진행 중인 {active}개가 끝난 뒤에 다시 등록할 수 있어.', en: 'The {role} role can keep at most {limit} active queue job(s) on this workflow. You can enqueue again after your {active} active job(s) finish.' },
              { role: viewerRoleName, limit: viewerQueueRoleLimit, active: viewerQueueRoleActive },
            )
            : t(
              { ko: '{role} 등급은 이 워크플로우에서 동시에 {limit}개까지 대기열을 만들 수 있어. (현재 {active}개 진행 중)', en: 'The {role} role can keep up to {limit} active queue job(s) on this workflow. ({active} in progress now)' },
              { role: viewerRoleName, limit: viewerQueueRoleLimit, active: viewerQueueRoleActive },
            )}
      </AlertDescription>
    </Alert>
  ) : null

  const resultPanel = workflow ? (
    shouldShowArtifactExplorer ? (
      <WorkflowArtifactExplorerPanel
        workflowId={workflow.id}
        publicWorkflowSlug={slug}
        refreshNonce={historyRefreshNonce}
        splitPaneScroll={isWideLayout}
      />
    ) : (
      <GenerationResultArea
        feed={historyFeed}
        serviceType="comfyui"
        workflowId={workflow.id}
        publicWorkflowSlug={slug}
        splitPaneScroll={isWideLayout}
        compact={!isWideLayout}
        view={resultView}
        onViewChange={setResultView}
        recentStrip={resolveRecentStripPlacement(generationLayout.presetOf('comfy'))}
      />
    )
  ) : null

  const controllerPanel = workflow ? (
    <ComfyWorkflowControllerPanel
      workflowName={workflow.name}
      workflowDescription={workflow.description ?? undefined}
      workflowFields={workflowFields}
      servers={[]}
      serverTests={NO_SERVER_TESTS}
      selectedTarget="auto"
      serverRouting={false}
      queueMaxCount={publicQueueMaxCount}
      notice={queueLimitNotice}
      workflowDraft={workflowDraft}
      queueRegistrationCount={queueRegistrationCount}
      isGenerating={isQueueSubmitting}
      loraOptions={loraOptions}
      isRefreshingDropdownLists={isRefreshingDropdownLists}
      fieldIssues={fieldIssues}
      splitPaneScroll={isWideLayout}
      compactActionBarContentTargetId={isWideLayout ? undefined : PUBLIC_STICKY_ACTION_BAR_SLOT_ID}
      blockLayout={isWideLayout ? { result: resultPanel } : undefined}
      onBack={() => navigate('/access')}
      onSelectTarget={ignoreTargetChange}
      onQueueRegistrationCountChange={setQueueRegistrationCount}
      onFieldChange={handleFieldChange}
      onImageChange={handleImageChange}
      onRefreshDropdownLists={handleRefreshDropdownLists}
      onResetDraft={() => void handleResetDraft()}
      onGenerateSelected={() => void handleQueueSubmit()}
      onRevealFieldIssues={() => { validate() }}
    />
  ) : null

  const historyTotal = historyFeed.historyQuery.data?.pages[0]?.total
  const isNarrowLayoutEditing = !isWideLayout && generationLayout.editing !== null

  return (
    <div
      className={cn(
        isWideLayout
          ? 'flex h-[calc(100vh-var(--theme-shell-header-height)-var(--theme-shell-main-padding-bottom)-var(--shell-bottom-inset))] min-h-0 flex-col overflow-hidden'
          : 'space-y-4',
        !isWideLayout && narrowView === 'edit' && 'pb-28',
      )}
    >
      {/* Same toolbar end as the generation page: the preset picker, and the editor for admins. */}
      <div className="flex shrink-0 items-center justify-end gap-2 py-2 empty:hidden">
        <GenerationLayoutControls wide={isWideLayout} />
      </div>

      {workflowQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '공용 워크플로우를 불러오지 못했어', en: 'Failed to load the public workflow' })}</AlertTitle>
          <AlertDescription>{getErrorMessage(workflowQuery.error, t({ ko: '공용 워크플로우 조회 실패', en: 'Failed to load the public workflow' }))}</AlertDescription>
        </Alert>
      ) : null}

      {workflowQuery.isLoading ? <LoadingState variant="inline" label={t({ ko: '공용 워크플로우 불러오는 중…', en: 'Loading public workflow…' })} /> : null}

      {isNarrowLayoutEditing && generationLayout.editing ? <GenerationLayoutListEditor surface={generationLayout.editing} /> : null}

      {workflow ? (
        isWideLayout ? (
          <div className="flex min-h-0 flex-1 flex-col">{controllerPanel}</div>
        ) : (
          <GenerationNarrowSplit
            view={narrowView}
            onViewChange={setNarrowView}
            resultLabel={!shouldShowArtifactExplorer && historyTotal !== undefined ? `${t({ ko: '결과', en: 'Result' })} (${formatNumber(historyTotal)})` : undefined}
            controller={controllerPanel}
            result={resultPanel}
            stickySlotId={PUBLIC_STICKY_ACTION_BAR_SLOT_ID}
            className={cn(isNarrowLayoutEditing && 'hidden')}
          />
        )
      ) : null}
      <ComfyWorkflowAuthoringModal open={isAuthoringOpen} mode={authoringWorkflow ? 'edit' : 'create'} initialData={authoringWorkflow ? { workflow: authoringWorkflow } : null} dropdownLists={authoringDropdowns.data ?? []} onClose={() => { setIsAuthoringOpen(false); setAuthoringWorkflow(null) }} onSaved={() => { setIsAuthoringOpen(false); setAuthoringWorkflow(null); void workflowQuery.refetch() }} />
    </div>
  )
}
