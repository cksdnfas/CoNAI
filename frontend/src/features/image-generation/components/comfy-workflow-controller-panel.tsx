import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Play, RotateCcw, Save, Settings2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import type { ComfyUIServer, WorkflowMarkedField } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type ComfyUIServerTestState, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { WorkflowFieldInput } from './workflow-field-input'

type ComfyWorkflowControllerPanelProps = {
  workflowName: string
  workflowDescription?: string
  workflowFields: WorkflowMarkedField[]
  servers: ComfyUIServer[]
  serverTests: Record<number, ComfyUIServerTestState>
  selectedTarget: string
  workflowDraft: Record<string, WorkflowFieldDraftValue>
  queueRegistrationCount: string
  isGenerating: boolean
  headerPortalTargetId?: string
  onBack: () => void
  onSelectTarget: (target: string) => void
  onQueueRegistrationCountChange: (value: string) => void
  onFieldChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, image?: SelectedImageDraft) => Promise<void> | void
  onResetDraft: () => void
  onOpenModuleSave: () => void
  onOpenSaveOptions: () => void
  onGenerateSelected: () => void
}

/** Render the ComfyUI workflow form with compact top actions and simplified server targeting. */
export function ComfyWorkflowControllerPanel({
  workflowName,
  workflowDescription,
  workflowFields,
  servers,
  serverTests,
  selectedTarget,
  workflowDraft,
  queueRegistrationCount,
  isGenerating,
  headerPortalTargetId,
  onBack,
  onSelectTarget,
  onQueueRegistrationCountChange,
  onFieldChange,
  onImageChange,
  onResetDraft,
  onOpenModuleSave,
  onOpenSaveOptions,
  onGenerateSelected,
}: ComfyWorkflowControllerPanelProps) {
  const connectedServers = servers.filter((server) => serverTests[server.id]?.status?.is_connected === true)
  const routingTags = Array.from(new Set(servers.flatMap((server) => server.routing_tags ?? []))).sort((left, right) => left.localeCompare(right))
  const selectedServer = selectedTarget.startsWith('server:')
    ? servers.find((server) => server.id === Number(selectedTarget.slice('server:'.length))) ?? null
    : null
  const [, setHeaderPortalRevision] = useState(0)
  const useDrawerCompactChrome = Boolean(headerPortalTargetId)

  useEffect(() => {
    if (!headerPortalTargetId || typeof document === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setHeaderPortalRevision((current) => current + 1)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [headerPortalTargetId])

  const headerPortalTarget = headerPortalTargetId && typeof document !== 'undefined'
    ? document.getElementById(headerPortalTargetId)
    : null

  const selectedServerStatus = selectedServer ? serverTests[selectedServer.id] : undefined
  const selectedServerConnection = selectedServerStatus?.status
  const selectedTag = selectedTarget.startsWith('tag:') ? selectedTarget.slice('tag:'.length) : null
  const selectedTagConnectedServers = selectedTag
    ? connectedServers.filter((server) => (server.routing_tags ?? []).includes(selectedTag))
    : []
  const canGenerateSelected = selectedTarget === 'auto'
    ? connectedServers.length > 0
    : selectedTag !== null
      ? selectedTagConnectedServers.length > 0
      : selectedServer
        ? serverTests[selectedServer.id]?.status?.is_connected === true
        : false
  const selectedServerBadgeLabel = selectedTarget === 'auto'
    ? connectedServers.length > 0
      ? `auto · ${connectedServers.length}`
      : 'auto · 연결 없음'
    : selectedTag !== null
      ? selectedTagConnectedServers.length > 0
        ? `#${selectedTag} · ${selectedTagConnectedServers.length}`
        : `#${selectedTag} · 연결 없음`
      : !selectedServer
        ? '선택 안 됨'
        : selectedServerStatus?.isLoading
          ? '확인 중'
          : selectedServerConnection?.is_connected
            ? selectedServerConnection.is_idle === true
              ? 'idle'
              : 'busy'
            : selectedServerConnection
              ? '연결 실패'
              : '미확인'

  const actionButtons = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={onOpenModuleSave}
          disabled={isGenerating}
          aria-label="모듈 저장"
          title="모듈 저장"
        >
          <Save className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onResetDraft}
          disabled={isGenerating}
          aria-label="초기화"
          title="초기화"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <Select
          variant="detail"
          className="h-9 w-[168px] shrink-0 px-2 text-xs sm:w-[220px]"
          value={selectedTarget}
          onChange={(event) => onSelectTarget(event.target.value)}
          disabled={servers.length === 0 || isGenerating}
          aria-label="생성 타겟 선택"
        >
          {servers.length === 0 ? <option value="auto">서버 없음</option> : null}
          <option value="auto">자동 분산</option>
          {routingTags.map((tag) => {
            const connectedCount = connectedServers.filter((server) => (server.routing_tags ?? []).includes(tag)).length
            return (
              <option key={`tag:${tag}`} value={`tag:${tag}`}>
                #{tag} · 연결 {connectedCount}
              </option>
            )
          })}
          {servers.map((server) => {
            const connectionStatus = serverTests[server.id]?.status
            const statusLabel = connectionStatus?.is_connected === true
              ? connectionStatus.is_idle
                ? 'idle'
                : `실행 ${connectionStatus.running_count ?? 0} · 대기 ${connectionStatus.pending_count ?? 0}`
              : connectionStatus
                ? '실패'
                : '미확인'

            return (
              <option key={server.id} value={`server:${server.id}`}>
                {server.name} · {statusLabel}
              </option>
            )
          })}
        </Select>

        <ScrubbableNumberInput
          min={1}
          max={32}
          step={1}
          scrubRatio={1}
          variant="detail"
          className="h-9 w-[72px] shrink-0 px-2 text-center text-xs"
          value={queueRegistrationCount}
          onChange={onQueueRegistrationCountChange}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="큐 등록 개수"
          inputMode="numeric"
        />

        <Button
          type="button"
          size="icon-sm"
          onClick={onGenerateSelected}
          disabled={isGenerating || workflowFields.length === 0 || !canGenerateSelected}
          aria-label={isGenerating ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
          title={isGenerating ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
          className="shadow-[0_0_20px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
        >
          <Play className="h-4 w-4 fill-current" />
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={onOpenSaveOptions}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="생성 결과 저장 옵션"
          title="생성 결과 저장 옵션"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  const compactHeaderContent = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            처음으로
          </Button>

          <div>
            <div className="text-base font-semibold text-foreground">{workflowName}</div>
            {workflowDescription ? <div className="mt-1 text-sm text-muted-foreground">{workflowDescription}</div> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">필드 {workflowFields.length}</Badge>
          <Badge variant="outline">활성 서버 {servers.length}</Badge>
          <Badge variant="outline">연결 서버 {connectedServers.length}</Badge>
          {servers.length > 0 ? <Badge variant={canGenerateSelected ? (selectedServerConnection?.is_connected && selectedServerConnection.is_idle === false ? 'secondary' : 'outline') : 'outline'}>{selectedServerBadgeLabel}</Badge> : null}
        </div>
      </div>

      {actionButtons}

    </div>
  )

  return (
    <section className="space-y-6">
      {useDrawerCompactChrome
        ? (headerPortalTarget ? createPortal(compactHeaderContent, headerPortalTarget) : null)
        : (
          <div className="space-y-3 border-b border-border/70 pb-4">
            {compactHeaderContent}
          </div>
        )}

      <div className={cn('space-y-6', useDrawerCompactChrome && 'px-5 pt-4 pb-5')}>
        {servers.length === 0 ? (
          <Alert>
            <AlertTitle>서버 필요</AlertTitle>
            <AlertDescription>서버를 먼저 등록해줘.</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3">
          <Card>
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                className="border-b border-border/70 pb-4"
                heading="입력 필드"
                actions={<Badge variant="outline">{workflowFields.length}</Badge>}
              />

              {workflowFields.length > 0 ? (
                <div className="overflow-hidden rounded-sm border border-border/70 divide-y divide-border/70">
                  {workflowFields.map((field) => (
                    <div key={field.id} className="bg-background/20 px-4 py-4">
                      <WorkflowFieldInput
                        field={field}
                        value={workflowDraft[field.id] ?? ''}
                        onChange={(value) => onFieldChange(field.id, value)}
                        onImageChange={(image) => onImageChange(field.id, image)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Alert>
                  <AlertTitle>입력 필드 없음</AlertTitle>
                  <AlertDescription>노출된 필드가 없어.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </section>
  )
}
