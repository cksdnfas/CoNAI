import { Copy, Pencil, Plus, Server, Trash2, ListTree } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ComfyUIServer, CustomDropdownList, GenerationWorkflow } from '@/lib/api'
import type { ComfyUIServerTestState } from '../image-generation-shared'

type WorkflowListSectionProps = {
  workflows: GenerationWorkflow[]
  selectedWorkflowId: string
  onSelectWorkflow: (workflowId: number) => void
  onCreateWorkflow: () => void
  onEditWorkflow: (workflowId: number) => void
  onCopyWorkflow: (workflowId: number) => void
  onDeleteWorkflow: (workflowId: number) => void
}

export function ComfyWorkflowListSection({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onCreateWorkflow,
  onEditWorkflow,
  onCopyWorkflow,
  onDeleteWorkflow,
}: WorkflowListSectionProps) {
  return (
    <section className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ListTree className="h-4 w-4 text-primary" />
          워크플로우 목록
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onCreateWorkflow}>
          <Plus className="h-4 w-4" />
          등록
        </Button>
      </div>

      {workflows.length > 0 ? (
        <div className="space-y-2">
          {workflows.map((workflow) => {
            const isSelected = String(workflow.id) === selectedWorkflowId
            return (
              <div
                key={workflow.id}
                className="rounded-sm border px-3 py-3 transition-colors hover:bg-surface-container"
                style={{
                  borderColor: isSelected ? workflow.color || 'var(--color-border)' : 'var(--color-border)',
                  backgroundColor: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectWorkflow(workflow.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm font-medium text-foreground">{workflow.name}</div>
                    {workflow.description ? <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{workflow.description}</div> : null}
                  </button>

                  <div className="flex shrink-0 items-start gap-2">
                    <Badge variant="outline">필드 {(workflow.marked_fields ?? []).length}</Badge>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onEditWorkflow(workflow.id)
                        }}
                        aria-label={`${workflow.name} 수정`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onCopyWorkflow(workflow.id)
                        }}
                        aria-label={`${workflow.name} 복사`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onDeleteWorkflow(workflow.id)
                        }}
                        aria-label={`${workflow.name} 삭제`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-sm bg-surface-container px-3 py-6 text-sm text-muted-foreground">등록된 ComfyUI 워크플로우가 아직 없어.</div>
      )}
    </section>
  )
}

type ServerListSectionProps = {
  servers: ComfyUIServer[]
  serverTests: Record<number, ComfyUIServerTestState>
  onOpenCreateServer: () => void
  onEditServer: (serverId: number) => void
  onDeleteServer: (serverId: number) => void
  onTestServer: (serverId: number) => void
}

export function ComfyServerListSection({ servers, serverTests, onOpenCreateServer, onEditServer, onDeleteServer, onTestServer }: ServerListSectionProps) {
  return (
    <section className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Server className="h-4 w-4 text-primary" />
          서버 목록
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onOpenCreateServer}>
          <Plus className="h-4 w-4" />
          서버 등록
        </Button>
      </div>

      {servers.length > 0 ? (
        <div className="space-y-2">
          {servers.map((server) => {
            const testState = serverTests[server.id]
            const connectionStatus = testState?.status

            return (
              <div key={server.id} className="rounded-sm bg-surface-container px-3 py-3 text-sm text-muted-foreground">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{server.name}</span>
                      {connectionStatus ? (
                        <Badge variant={connectionStatus.is_connected ? 'secondary' : 'outline'}>
                          {connectionStatus.is_connected ? '연결됨' : '실패'}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 break-all text-[11px]">{server.endpoint}</div>
                    {server.description ? <div className="mt-1 text-[11px]">{server.description}</div> : null}
                    {connectionStatus?.response_time !== undefined ? <div className="mt-1 text-[11px]">{connectionStatus.response_time}ms</div> : null}
                    {connectionStatus?.error_message ? <div className="mt-1 text-[11px] text-[#ffb4ab]">{connectionStatus.error_message}</div> : null}
                    {testState?.error ? <div className="mt-1 text-[11px] text-[#ffb4ab]">{testState.error}</div> : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => onTestServer(server.id)} disabled={testState?.isLoading === true}>
                      {testState?.isLoading ? '확인 중…' : '테스트'}
                    </Button>
                    <div className="flex gap-1">
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => onEditServer(server.id)} aria-label={`${server.name} 수정`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => onDeleteServer(server.id)} aria-label={`${server.name} 삭제`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-sm bg-surface-container px-3 py-4 text-sm text-muted-foreground">연결된 서버가 아직 없어.</div>
      )}
    </section>
  )
}

type DropdownListsSectionProps = {
  dropdownLists: CustomDropdownList[]
}

export function ComfyDropdownListsSection({ dropdownLists }: DropdownListsSectionProps) {
  return (
    <section className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-base font-semibold text-foreground">커스텀 드롭다운 목록</div>
        <Badge variant="outline">{dropdownLists.length}</Badge>
      </div>

      {dropdownLists.length > 0 ? (
        <div className="space-y-2">
          {dropdownLists.map((list) => (
            <div key={list.id} className="rounded-sm bg-surface-container px-3 py-2.5 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-foreground">{list.name}</span>
                <Badge variant={list.is_auto_collected ? 'secondary' : 'outline'}>{list.is_auto_collected ? 'auto' : 'manual'}</Badge>
                <Badge variant="outline">items {list.items.length}</Badge>
              </div>
              {list.description ? <div className="mt-1 line-clamp-1 text-[11px]">{list.description}</div> : null}
              {list.items.length > 0 ? <div className="mt-1 line-clamp-1 text-[11px]">{list.items.slice(0, 4).join(', ')}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-sm bg-surface-container px-3 py-4 text-sm text-muted-foreground">등록된 드롭다운 목록이 아직 없어.</div>
      )}
    </section>
  )
}
