import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ImagePlus, Layers3, Save } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
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
  selectedServerId: string
  workflowDraft: Record<string, WorkflowFieldDraftValue>
  isGenerating: boolean
  headerPortalTargetId?: string
  onBack: () => void
  onSelectServer: (serverId: string) => void
  onFieldChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, image?: SelectedImageDraft) => Promise<void> | void
  onResetDraft: () => void
  onOpenModuleSave: () => void
  onGenerateSelected: () => void
  onGenerateAll: () => void
}

/** Render the ComfyUI workflow form with compact top actions and simplified server targeting. */
export function ComfyWorkflowControllerPanel({
  workflowName,
  workflowDescription,
  workflowFields,
  servers,
  serverTests,
  selectedServerId,
  workflowDraft,
  isGenerating,
  headerPortalTargetId,
  onBack,
  onSelectServer,
  onFieldChange,
  onImageChange,
  onResetDraft,
  onOpenModuleSave,
  onGenerateSelected,
  onGenerateAll,
}: ComfyWorkflowControllerPanelProps) {
  const connectedServers = servers.filter((server) => serverTests[server.id]?.status?.is_connected === true)
  const selectedServer = servers.find((server) => String(server.id) === selectedServerId) ?? null
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
  const selectedServerBadgeLabel = !selectedServer
    ? '선택 안 됨'
    : selectedServerStatus?.isLoading
      ? '확인 중'
      : selectedServerConnection?.is_connected
        ? '연결됨'
        : selectedServerConnection
          ? '연결 실패'
          : '미확인'

  const actionButtons = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onOpenModuleSave}>
          <Save className="h-4 w-4" />
          모듈 저장
        </Button>
      </div>

      <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1">
        <Button type="button" variant="ghost" size="sm" onClick={onResetDraft} disabled={isGenerating}>
          초기화
        </Button>

        <Select
          variant="detail"
          className="h-9 w-[96px] shrink-0 px-2 text-xs sm:w-[108px]"
          value={selectedServerId}
          onChange={(event) => onSelectServer(event.target.value)}
          disabled={servers.length === 0 || isGenerating}
          aria-label="생성 서버 선택"
        >
          {servers.length === 0 ? <option value="">서버 없음</option> : null}
          {servers.map((server) => {
            const connectionStatus = serverTests[server.id]?.status
            const statusLabel = connectionStatus?.is_connected === true
              ? '연결'
              : connectionStatus
                ? '실패'
                : '미확인'

            return (
              <option key={server.id} value={String(server.id)}>
                {server.name} · {statusLabel}
              </option>
            )
          })}
        </Select>

        <Button type="button" size="sm" variant="outline" onClick={onGenerateSelected} disabled={isGenerating || workflowFields.length === 0 || !selectedServer || serverTests[selectedServer.id]?.status?.is_connected !== true}>
          <ImagePlus className="h-4 w-4" />
          {isGenerating ? '요청 중…' : '생성'}
        </Button>

        <Button type="button" size="sm" onClick={onGenerateAll} disabled={isGenerating || workflowFields.length === 0 || connectedServers.length === 0}>
          <Layers3 className="h-4 w-4" />
          {isGenerating ? '요청 중…' : `모두 생성${connectedServers.length > 0 ? ` (${connectedServers.length})` : ''}`}
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
          {servers.length > 0 ? <Badge variant={selectedServerConnection?.is_connected ? 'secondary' : 'outline'}>{selectedServerBadgeLabel}</Badge> : null}
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
                <div className="grid gap-4">
                  {workflowFields.map((field) => (
                    <WorkflowFieldInput
                      key={field.id}
                      field={field}
                      value={workflowDraft[field.id] ?? ''}
                      onChange={(value) => onFieldChange(field.id, value)}
                      onImageChange={(image) => onImageChange(field.id, image)}
                    />
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
