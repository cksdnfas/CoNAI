import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { GraphExecutionRecord, GraphWorkflowExposedInput, GraphWorkflowRecord } from '@/lib/api'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution?: GraphExecutionRecord | null
  latestPreviewUrl?: string | null
  latestPreviewLabel?: string | null
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, file?: File) => Promise<void>
  onExecute: () => void
  onEdit: () => void
}

function hasExplicitValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Render workflow-level runtime inputs so users can run saved workflows without opening the graph editor. */
export function WorkflowRunnerPanel({
  selectedGraph,
  inputDefinitions,
  inputValues,
  isExecuting,
  latestExecution,
  latestPreviewUrl,
  latestPreviewLabel,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
  onExecute,
  onEdit,
}: WorkflowRunnerPanelProps) {
  const renderInputField = (inputDefinition: GraphWorkflowExposedInput) => {
    const rawValue = inputValues[inputDefinition.id]
    const explicitValue = hasExplicitValue(rawValue)

    if (inputDefinition.data_type === 'prompt' || inputDefinition.data_type === 'json') {
      return (
        <div key={inputDefinition.id} className="space-y-2 rounded-sm bg-surface-low p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onInputValueClear(inputDefinition.id)} disabled={!explicitValue}>
              값 지우기
            </Button>
          </div>
          {inputDefinition.description ? <div className="text-xs text-muted-foreground">{inputDefinition.description}</div> : null}
          <Textarea
            rows={inputDefinition.data_type === 'json' ? 6 : 4}
            value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value)}
            placeholder={inputDefinition.placeholder || inputDefinition.label}
          />
        </div>
      )
    }

    if (inputDefinition.data_type === 'number') {
      return (
        <div key={inputDefinition.id} className="space-y-2 rounded-sm bg-surface-low p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · number</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onInputValueClear(inputDefinition.id)} disabled={!explicitValue}>
              값 지우기
            </Button>
          </div>
          {inputDefinition.description ? <div className="text-xs text-muted-foreground">{inputDefinition.description}</div> : null}
          <Input
            type="number"
            value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value === '' ? '' : Number(event.target.value))}
            placeholder={inputDefinition.placeholder || inputDefinition.label}
          />
        </div>
      )
    }

    if (inputDefinition.data_type === 'boolean') {
      return (
        <div key={inputDefinition.id} className="space-y-2 rounded-sm bg-surface-low p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · boolean</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onInputValueClear(inputDefinition.id)} disabled={!explicitValue}>
              값 지우기
            </Button>
          </div>
          {inputDefinition.description ? <div className="text-xs text-muted-foreground">{inputDefinition.description}</div> : null}
          <Select
            value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value === '' ? '' : event.target.value === 'true')}
          >
            <option value="">기본값 사용</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        </div>
      )
    }

    if (inputDefinition.data_type === 'image' || inputDefinition.data_type === 'mask') {
      return (
        <div key={inputDefinition.id} className="space-y-2 rounded-sm bg-surface-low p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onInputValueClear(inputDefinition.id)} disabled={!explicitValue}>
              값 지우기
            </Button>
          </div>
          {inputDefinition.description ? <div className="text-xs text-muted-foreground">{inputDefinition.description}</div> : null}
          <Input type="file" accept="image/*" onChange={(event) => void onInputImageChange(inputDefinition.id, event.target.files?.[0])} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:image/') ? (
            <img src={rawValue} alt={inputDefinition.label} className="max-h-40 rounded-sm border border-border object-contain" />
          ) : null}
        </div>
      )
    }

    return (
      <div key={inputDefinition.id} className="space-y-2 rounded-sm bg-surface-low p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
              {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · {inputDefinition.data_type}</div>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => onInputValueClear(inputDefinition.id)} disabled={!explicitValue}>
            값 지우기
          </Button>
        </div>
        {inputDefinition.description ? <div className="text-xs text-muted-foreground">{inputDefinition.description}</div> : null}
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value)}
          placeholder={inputDefinition.placeholder || inputDefinition.label}
        />
      </div>
    )
  }

  return (
    <Card className="bg-surface-container">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Workflow Runner</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={!selectedGraph}>
            구조 수정
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {selectedGraph ? (
          <div className="space-y-3.5">
            <div className="space-y-2">
              <div className="text-base font-semibold text-foreground">{selectedGraph.name}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <Badge variant="outline">v{selectedGraph.version}</Badge>
                <Badge variant="outline">N {selectedGraph.graph.nodes.length}</Badge>
                <Badge variant="outline">E {selectedGraph.graph.edges.length}</Badge>
                <Badge variant="outline">I {inputDefinitions.length}</Badge>
                {latestExecution ? <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>{latestExecution.status}</Badge> : null}
              </div>
              {selectedGraph.description?.trim() ? <div className="text-xs text-muted-foreground">{selectedGraph.description.trim()}</div> : null}
            </div>

            {latestExecution || latestPreviewUrl ? (
              <div className="grid gap-3 rounded-sm bg-surface-low p-3 md:grid-cols-[minmax(0,1fr)_168px]">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">최근 결과</span>
                    {latestExecution ? (
                      <>
                        <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>#{latestExecution.id}</Badge>
                        <Badge variant="outline">{latestExecution.status}</Badge>
                      </>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {latestPreviewUrl
                      ? `미리보기${latestPreviewLabel ? ` · ${latestPreviewLabel}` : ''}`
                      : latestExecution
                        ? '이미지 결과 없음'
                        : '실행 결과 없음'}
                  </div>
                </div>

                {latestPreviewUrl ? (
                  <img src={latestPreviewUrl} alt={latestPreviewLabel || selectedGraph.name} className="max-h-40 w-full rounded-sm border border-border object-contain" />
                ) : null}
              </div>
            ) : null}

            {inputDefinitions.length > 0 ? (
              <div className="space-y-2.5">{inputDefinitions.map((inputDefinition) => renderInputField(inputDefinition))}</div>
            ) : (
              <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">
                아직 노출된 실행 입력이 없어. 지금은 저장된 기본값만으로 바로 실행돼.
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" onClick={onExecute} disabled={isExecuting}>
                {isExecuting ? '실행 요청 중…' : '실행'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-sm bg-surface-low px-4 py-8 text-sm text-muted-foreground">
            왼쪽에서 워크플로우를 선택해줘. 선택한 워크플로우의 실행 입력만 여기서 보여줄 거야.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
