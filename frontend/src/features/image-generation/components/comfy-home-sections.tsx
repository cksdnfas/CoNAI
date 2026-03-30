import { Copy, ListTree, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading={(
              <span className="flex items-center gap-2">
                <ListTree className="h-4 w-4 text-primary" />
                워크플로우
              </span>
            )}
            actions={(
              <>
                <Badge variant="outline">{workflows.length}</Badge>
                <Button type="button" size="sm" variant="outline" onClick={onCreateWorkflow}>
                  <Plus className="h-4 w-4" />
                  등록
                </Button>
              </>
            )}
          />

          {workflows.length > 0 ? (
            <div className="space-y-2">
              {workflows.map((workflow) => {
                const isSelected = String(workflow.id) === selectedWorkflowId
                return (
                  <div
                    key={workflow.id}
                    className="rounded-sm border border-border bg-surface-container px-3 py-3 transition-colors hover:bg-surface-high"
                    style={isSelected ? { borderColor: workflow.color || 'var(--color-primary)' } : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onSelectWorkflow(workflow.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-medium text-foreground">{workflow.name}</div>
                          {isSelected ? <Badge variant="secondary">선택됨</Badge> : null}
                        </div>
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
            <div className="text-sm text-muted-foreground">등록된 워크플로우가 없어.</div>
          )}
        </CardContent>
      </Card>
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
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading={(
              <span className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                서버
              </span>
            )}
            actions={(
              <>
                <Badge variant="outline">{servers.length}</Badge>
                <Button type="button" size="sm" variant="outline" onClick={onOpenCreateServer}>
                  <Plus className="h-4 w-4" />
                  서버 등록
                </Button>
              </>
            )}
          />

          {servers.length > 0 ? (
            <div className="space-y-2">
              {servers.map((server) => {
                const testState = serverTests[server.id]
                const connectionStatus = testState?.status

                return (
                  <div key={server.id} className="rounded-sm border border-border bg-surface-container px-3 py-3 text-sm text-muted-foreground">
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
            <div className="text-sm text-muted-foreground">연결된 서버가 없어.</div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

type DropdownListsSectionProps = {
  dropdownLists: CustomDropdownList[]
}

export function ComfyDropdownListsSection({ dropdownLists }: DropdownListsSectionProps) {
  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading="커스텀 드롭다운 목록"
            actions={<Badge variant="outline">{dropdownLists.length}</Badge>}
          />

          {dropdownLists.length > 0 ? (
            <div className="space-y-2">
              {dropdownLists.map((list) => (
                <div key={list.id} className="rounded-sm border border-border bg-surface-container px-3 py-2.5 text-sm text-muted-foreground">
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
            <div className="text-sm text-muted-foreground">등록된 드롭다운 목록이 없어.</div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
