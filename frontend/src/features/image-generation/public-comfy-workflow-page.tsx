import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArrowLeft, Play, RotateCcw } from 'lucide-react'
import { BottomDrawerNotice, BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getAppSettings, getPublicGenerationWorkflow, queuePublicGenerationWorkflowJob, type WorkflowMarkedField } from '@/lib/api'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { refreshGenerationQueueViews } from './components/generation-queue-actions'
import { GenerationHistoryPanel } from './components/generation-history-panel'
import { CompactGenerationActionSurface, CompactGenerationControllerActionBar, GenerationControllerFieldStack } from './components/shared-generation-controller'
import { WorkflowFieldDisclosureCard } from './components/workflow-field-disclosure-card'
import {
  buildWorkflowDraft,
  buildWorkflowPromptData,
  clearPersistedComfyWorkflowDraft,
  getErrorMessage,
  hasWorkflowFieldValue,
  loadPersistedComfyWorkflowDraft,
  parseNumberInput,
  persistComfyWorkflowDraft,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from './image-generation-shared'

const PUBLIC_QUEUE_REGISTRATION_MIN = 1
const PUBLIC_QUEUE_REGISTRATION_MAX = 32

function clampQueueRegistrationCount(value: string) {
  const parsed = Math.trunc(parseNumberInput(value, PUBLIC_QUEUE_REGISTRATION_MIN))
  return Math.min(PUBLIC_QUEUE_REGISTRATION_MAX, Math.max(PUBLIC_QUEUE_REGISTRATION_MIN, parsed))
}

export function PublicComfyWorkflowPage() {
  const { slug = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isWideLayout = useDesktopPageLayout()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [queueRegistrationCount, setQueueRegistrationCount] = useState('1')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [isQueueSubmitting, setIsQueueSubmitting] = useState(false)
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const [drawerHeaderPortalRevision, setDrawerHeaderPortalRevision] = useState(0)

  const workflowQuery = useQuery({
    queryKey: ['public-generation-workflow', slug],
    queryFn: () => getPublicGenerationWorkflow(slug),
    enabled: slug.trim().length > 0 && authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    enabled: authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const workflow = workflowQuery.data ?? null
  const workflowFields = workflow?.marked_fields ?? []
  const generationSaveOptions = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

  useEffect(() => {
    if (!workflow) {
      return
    }

    const baseDraft = buildWorkflowDraft(workflowFields)
    const persistedDraft = loadPersistedComfyWorkflowDraft(workflow.id, workflowFields)
    setWorkflowDraft({ ...baseDraft, ...persistedDraft })
  }, [workflow, workflowFields])

  useEffect(() => {
    if (!workflow) {
      return
    }

    persistComfyWorkflowDraft(workflow.id, workflowDraft)
  }, [workflow, workflowDraft])

  const missingRequiredField = useMemo(
    () => workflowFields.find((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id])),
    [workflowDraft, workflowFields],
  )

  const handleFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleImageChange = (fieldId: string, image?: SelectedImageDraft) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: image ?? '',
    }))
  }

  const handleResetDraft = () => {
    if (!workflow) {
      return
    }

    clearPersistedComfyWorkflowDraft(workflow.id)
    setWorkflowDraft(buildWorkflowDraft(workflowFields))
  }

  const handleQueueSubmit = async () => {
    if (!workflow || isQueueSubmitting) {
      return
    }

    if (missingRequiredField) {
      showSnackbar({ message: `필수 필드가 비어 있어: ${missingRequiredField.label}`, tone: 'error' })
      return
    }

    const promptData = buildWorkflowPromptData(workflowFields as WorkflowMarkedField[], workflowDraft)
    const registrationCount = clampQueueRegistrationCount(queueRegistrationCount)

    try {
      setIsQueueSubmitting(true)
      const results = await Promise.allSettled(
        Array.from({ length: registrationCount }, () => queuePublicGenerationWorkflowJob(slug, {
          request_summary: `${workflow.name} public queue job`,
          request_payload: {
            prompt_data: promptData,
            imageSaveOptions: {
              format: generationSaveOptions.defaultFormat,
              quality: generationSaveOptions.quality,
              resizeEnabled: generationSaveOptions.resizeEnabled,
              maxWidth: generationSaveOptions.maxWidth,
              maxHeight: generationSaveOptions.maxHeight,
            },
          },
        })),
      )

      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedCount = results.length - successCount

      void refreshGenerationQueueViews(queryClient, () => setHistoryRefreshNonce((current) => current + 1))

      if (failedCount === 0) {
        showSnackbar({ message: `${workflow.name} 큐에 ${successCount}건 등록했어.`, tone: 'info' })
      } else if (successCount === 0) {
        showSnackbar({ message: `${workflow.name} 큐 등록이 전부 실패했어.`, tone: 'error' })
      } else {
        showSnackbar({ message: `${workflow.name} 큐 등록 ${successCount}건 성공, ${failedCount}건 실패.`, tone: 'error' })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '공용 워크플로우 큐 등록에 실패했어.'), tone: 'error' })
    } finally {
      setIsQueueSubmitting(false)
    }
  }

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (authStatusQuery.data?.hasCredentials === false) {
    return (
      <Alert variant="destructive">
        <AlertTitle>게스트 로그인 전용 페이지야</AlertTitle>
        <AlertDescription>이 공용 워크플로우 페이지는 로컬 인증과 게스트 계정 구성이 먼저 필요해.</AlertDescription>
      </Alert>
    )
  }

  if (authStatusQuery.data?.hasCredentials && authStatusQuery.data.authenticated !== true) {
    const nextPath = `${location.pathname}${location.search}` || '/'
    return <Navigate to={`/login?next=${encodeURIComponent(nextPath)}`} replace />
  }

  useEffect(() => {
    if (isWideLayout || !isControllerOpen || typeof document === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setDrawerHeaderPortalRevision((current) => current + 1)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isControllerOpen, isWideLayout])

  const drawerHeaderContentId = 'public-comfy-workflow-drawer-header'
  const drawerHeaderPortalTarget = !isWideLayout && typeof document !== 'undefined'
    ? document.getElementById(drawerHeaderContentId)
    : null
  void drawerHeaderPortalRevision

  const desktopControllerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleResetDraft}
        disabled={isQueueSubmitting}
        aria-label="초기화"
        title="초기화"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <ScrubbableNumberInput
        min={1}
        max={32}
        step={1}
        scrubRatio={1}
        variant="detail"
        className="h-9 w-[72px] shrink-0 px-2 text-center text-xs"
        value={queueRegistrationCount}
        onChange={setQueueRegistrationCount}
        disabled={isQueueSubmitting}
        aria-label="큐 등록 개수"
        inputMode="numeric"
      />
      <Button
        type="button"
        size="icon-sm"
        onClick={() => void handleQueueSubmit()}
        disabled={isQueueSubmitting || workflowFields.length === 0}
        aria-label={isQueueSubmitting ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
        title={isQueueSubmitting ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
        className="shadow-[0_0_20px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
      >
        <Play className="h-4 w-4 fill-current" />
      </Button>
    </div>
  )

  const desktopControllerHeaderContent = workflow ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Button asChild type="button" variant="ghost" size="sm" className="w-fit">
            <Link to="/access">
              <ArrowLeft className="h-4 w-4" />
              뒤로가기
            </Link>
          </Button>

          <div>
            <div className="text-base font-semibold text-foreground">{workflow.name}</div>
            {workflow.description ? <div className="mt-1 text-sm text-muted-foreground">{workflow.description}</div> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">필드 {workflowFields.length}</Badge>
        </div>
      </div>

      {desktopControllerActions}
    </div>
  ) : null

  const drawerControllerHeaderContent = workflow ? (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{workflow.name}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleResetDraft}
        disabled={isQueueSubmitting}
        aria-label="초기화"
        title="초기화"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
    </div>
  ) : null

  const controllerBodyContent = (
    <>
      {missingRequiredField ? (
        <Alert>
          <AlertTitle>입력이 더 필요해</AlertTitle>
          <AlertDescription>{missingRequiredField.label} 필드는 꼭 채워야 해.</AlertDescription>
        </Alert>
      ) : null}

      {workflowFields.length === 0 ? (
        <BottomDrawerNotice>노출된 입력 필드가 아직 없어.</BottomDrawerNotice>
      ) : (
        <GenerationControllerFieldStack>
          {workflowFields.map((field) => (
            <WorkflowFieldDisclosureCard
              key={field.id}
              field={field}
              value={workflowDraft[field.id] ?? ''}
              onChange={(value) => handleFieldChange(field.id, value)}
              onImageChange={(image) => handleImageChange(field.id, image)}
            />
          ))}
        </GenerationControllerFieldStack>
      )}
    </>
  )

  const controllerPanel = workflow ? (
    isWideLayout ? (
      <section className="space-y-3">
        <div className="border-b border-border/70 pb-4">{desktopControllerHeaderContent}</div>
        <div className="space-y-5">{controllerBodyContent}</div>
      </section>
    ) : (
      <div className="space-y-4">{controllerBodyContent}</div>
    )
  ) : null

  const shouldUseControllerDrawer = !isWideLayout && workflow !== null
  const isDrawerOpen = shouldUseControllerDrawer && isControllerOpen
  const compactControllerActionBar = workflow && !isWideLayout ? (
    <CompactGenerationControllerActionBar
      isExpanded={isDrawerOpen}
      onToggle={() => setIsControllerOpen((current) => !current)}
      expandedContent={(
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => navigate('/access')}
            aria-label="뒤로가기"
            title="뒤로가기"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <CompactGenerationActionSurface>
            <ScrubbableNumberInput
              min={1}
              max={32}
              step={1}
              scrubRatio={1}
              variant="detail"
              className="h-8 w-[54px] shrink-0 !rounded-none !border-0 !bg-transparent px-0 text-center text-xs"
              value={queueRegistrationCount}
              onChange={setQueueRegistrationCount}
              disabled={isQueueSubmitting}
              aria-label="큐 등록 개수"
              inputMode="numeric"
            />
            <Button
              type="button"
              size="icon-sm"
              className="rounded-none border-l border-border/70 shadow-none"
              onClick={() => void handleQueueSubmit()}
              disabled={isQueueSubmitting || workflowFields.length === 0}
              aria-label={isQueueSubmitting ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
              title={isQueueSubmitting ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
            >
              <Play className="h-4 w-4 fill-current" />
            </Button>
          </CompactGenerationActionSurface>
        </div>
      )}
    />
  ) : null

  return (
    <div className={isWideLayout ? 'space-y-6' : 'space-y-6 pb-24'}>
      {workflowQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>공용 워크플로우를 불러오지 못했어</AlertTitle>
          <AlertDescription>{getErrorMessage(workflowQuery.error, '공용 워크플로우 조회 실패')}</AlertDescription>
        </Alert>
      ) : null}

      {workflowQuery.isLoading ? <div className="text-sm text-muted-foreground">공용 워크플로우 불러오는 중…</div> : null}

      {workflow ? (
        isWideLayout ? (
          <div className="grid items-start gap-8 grid-cols-[minmax(360px,4fr)_minmax(0,6fr)]">
            {controllerPanel}
            <GenerationHistoryPanel
              refreshNonce={historyRefreshNonce}
              serviceType="comfyui"
              workflowId={workflow.id}
              publicWorkflowSlug={slug}
            />
          </div>
        ) : (
          <>
            <GenerationHistoryPanel
              refreshNonce={historyRefreshNonce}
              serviceType="comfyui"
              workflowId={workflow.id}
              publicWorkflowSlug={slug}
              onBack={() => navigate('/access')}
            />

            {compactControllerActionBar}

            <BottomDrawerSheet
              open={isDrawerOpen}
              title={null}
              headerContentId={drawerHeaderContentId}
              ariaLabel={`${workflow.name} 컨트롤 패널`}
              onClose={() => setIsControllerOpen(false)}
              className="border-x-0 border-b-0 bg-transparent shadow-none backdrop-blur-0"
              bodyClassName="p-0 pb-24"
              headerClassName="border-b-0 bg-transparent px-4 py-3"
              headerPortalClassName="mt-0 border-t-0 pt-0"
              footer={null}
              hideHandle
            >
              {drawerHeaderPortalTarget && drawerControllerHeaderContent ? createPortal(drawerControllerHeaderContent, drawerHeaderPortalTarget) : null}
              {controllerPanel}
            </BottomDrawerSheet>
          </>
        )
      ) : null}
    </div>
  )
}
