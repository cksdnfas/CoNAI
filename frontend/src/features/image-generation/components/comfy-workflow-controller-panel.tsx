import { ArrowLeft, ImagePlus, Layers3 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ComfyUIServer, WorkflowMarkedField } from '@/lib/api'
import type { ComfyUIServerTestState, WorkflowFieldDraftValue } from '../image-generation-shared'
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
  onBack: () => void
  onSelectServer: (serverId: string) => void
  onFieldChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, file?: File) => Promise<void>
  onResetDraft: () => void
  onGenerateSelected: () => void
  onGenerateAll: () => void
}

/** Render the ComfyUI workflow form with compact server targeting near the generation actions. */
export function ComfyWorkflowControllerPanel({
  workflowName,
  workflowDescription,
  workflowFields,
  servers,
  serverTests,
  selectedServerId,
  workflowDraft,
  isGenerating,
  onBack,
  onSelectServer,
  onFieldChange,
  onImageChange,
  onResetDraft,
  onGenerateSelected,
  onGenerateAll,
}: ComfyWorkflowControllerPanelProps) {
  const connectedServers = servers.filter((server) => serverTests[server.id]?.status?.is_connected === true)
  const selectedServer = servers.find((server) => String(server.id) === selectedServerId) ?? null

  return (
    <section className="space-y-6">
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
        </div>
      </div>

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
                    onImageChange={(file) => onImageChange(field.id, file)}
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

      <section className="space-y-3">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              className="border-b border-border/70 pb-4"
              heading="대상 서버"
              actions={selectedServer ? <Badge variant="secondary">{selectedServer.name}</Badge> : <Badge variant="outline">선택 안 됨</Badge>}
            />

            <div className="space-y-4">
              {servers.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {servers.map((server) => {
                    const testState = serverTests[server.id]
                    const connectionStatus = testState?.status
                    const isSelected = String(server.id) === selectedServerId
                    const isConnected = connectionStatus?.is_connected === true

                    return (
                      <button
                        key={server.id}
                        type="button"
                        onClick={() => onSelectServer(String(server.id))}
                        className="block w-full rounded-sm border border-border bg-surface-container px-3 py-2.5 text-left transition-colors hover:bg-surface-high"
                        style={isSelected ? { borderColor: 'var(--color-primary)' } : undefined}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">{server.name}</div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">{server.endpoint}</div>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-1">
                            {isSelected ? <Badge variant="secondary">선택</Badge> : null}
                            {testState?.isLoading ? <Badge variant="outline">확인 중</Badge> : null}
                            {!testState?.isLoading && connectionStatus ? (
                              <Badge variant={isConnected ? 'secondary' : 'outline'}>{isConnected ? '연결' : '실패'}</Badge>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <Alert>
                  <AlertTitle>서버 필요</AlertTitle>
                  <AlertDescription>서버를 먼저 등록해줘.</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
                <Button type="button" variant="ghost" onClick={onResetDraft} disabled={isGenerating}>
                  초기화
                </Button>
                <Button type="button" variant="outline" onClick={onGenerateAll} disabled={isGenerating || workflowFields.length === 0 || connectedServers.length === 0}>
                  <Layers3 className="h-4 w-4" />
                  {isGenerating ? '요청 중…' : `모든 연결 서버에 생성${connectedServers.length > 0 ? ` (${connectedServers.length})` : ''}`}
                </Button>
                <Button type="button" onClick={onGenerateSelected} disabled={isGenerating || workflowFields.length === 0 || !selectedServer || serverTests[selectedServer.id]?.status?.is_connected !== true}>
                  <ImagePlus className="h-4 w-4" />
                  {isGenerating ? '요청 중…' : selectedServer ? `${selectedServer.name}에 생성` : '서버 선택'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </section>
  )
}
