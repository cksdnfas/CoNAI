import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphExecutionRecord, GraphWorkflowExposedInput, GraphWorkflowRecord } from '@/lib/api'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './workflow-validation-panel'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution?: GraphExecutionRecord | null
  latestExecutionArtifacts?: GraphExecutionArtifactRecord[] | null
  latestExecutionFinalResults?: GraphExecutionFinalResultRecord[] | null
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, image?: SelectedImageDraft) => Promise<void> | void
  onExecute: () => void
  onEdit: () => void
  canExecute?: boolean
  validationIssues?: WorkflowValidationIssue[]
  onValidationIssueSelect?: (issue: WorkflowValidationIssue) => void
  showHeader?: boolean
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
  latestExecutionArtifacts,
  latestExecutionFinalResults,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
  onExecute,
  onEdit,
  canExecute = true,
  validationIssues = [],
  onValidationIssueSelect,
  showHeader = true,
}: WorkflowRunnerPanelProps) {
  const renderInputField = (inputDefinition: GraphWorkflowExposedInput) => {
    const rawValue = inputValues[inputDefinition.id]
    const explicitValue = hasExplicitValue(rawValue)

    if (isNaiCharacterPromptPort(inputDefinition.port_key, inputDefinition.data_type)) {
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
          <NaiCharacterPromptsInput value={rawValue} onChange={(value) => onInputValueChange(inputDefinition.id, value)} />
        </div>
      )
    }

    if (isNaiVibePort(inputDefinition.port_key, inputDefinition.data_type)) {
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
          <NaiReusableAssetInput kind="vibes" value={rawValue} onChange={(value) => onInputValueChange(inputDefinition.id, value)} />
        </div>
      )
    }

    if (isNaiCharacterReferencePort(inputDefinition.port_key, inputDefinition.data_type)) {
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
          <NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={(value) => onInputValueChange(inputDefinition.id, value)} />
        </div>
      )
    }

    if (inputDefinition.ui_data_type === 'select' && Array.isArray(inputDefinition.options) && inputDefinition.options.length > 0) {
      return (
        <div key={inputDefinition.id} className="space-y-2 rounded-sm bg-surface-low p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">{inputDefinition.label}</div>
                {inputDefinition.required ? <Badge variant="outline">required</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{inputDefinition.module_name || inputDefinition.node_id} · select</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onInputValueClear(inputDefinition.id)} disabled={!explicitValue}>
              값 지우기
            </Button>
          </div>
          {inputDefinition.description ? <div className="text-xs text-muted-foreground">{inputDefinition.description}</div> : null}
          <Select
            value={typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue)}
            onChange={(event) => onInputValueChange(inputDefinition.id, event.target.value)}
          >
            <option value="">기본값 사용</option>
            {inputDefinition.options.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
      )
    }

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
          <ImageAttachmentPickerButton label={explicitValue ? '이미지 변경' : '이미지 선택'} modalTitle={inputDefinition.label} allowSaveDialog={false} onSelect={(image) => void onInputImageChange(inputDefinition.id, image)} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:') ? (
            <InlineMediaPreview src={rawValue} alt={inputDefinition.label} frameClassName="p-3" />
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
    <Card>
      <CardContent className="space-y-3.5">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="Workflow Runner"
            actions={
              <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={!selectedGraph}>
                구조 수정
              </Button>
            }
          />
        ) : null}

        {!showHeader ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={!selectedGraph}>
              구조 수정
            </Button>
          </div>
        ) : null}

        {selectedGraph ? (
          <div className="space-y-3.5">
            <div className="space-y-2">
              <div className="text-base font-semibold text-foreground">{selectedGraph.name}</div>
              {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
              {latestExecution ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>{latestExecution.status}</Badge>
                </div>
              ) : null}
            </div>

            {latestExecution ? (
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>최근 결과</span>
                  <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>#{latestExecution.id}</Badge>
                  <Badge variant="outline">{latestExecution.status}</Badge>
                </AlertTitle>
                <AlertDescription className="pt-3">
                  {latestExecutionArtifacts && latestExecutionFinalResults ? (
                    <WorkflowFinalResultsSection
                      finalResults={latestExecutionFinalResults}
                      artifacts={latestExecutionArtifacts}
                      selectedGraph={selectedGraph}
                      emptyLabel="아직 선언된 최종 결과가 없어. Final Result 노드를 추가하고 원하는 출력에 연결해줘."
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground">최종 결과를 불러오는 중…</div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <WorkflowValidationPanel
              issues={validationIssues}
              title="실행 검증"
              description="실행 전 확인"
              showHeader={false}
              onIssueSelect={onValidationIssueSelect}
            />

            {inputDefinitions.length > 0 ? <div className="space-y-2.5">{inputDefinitions.map((inputDefinition) => renderInputField(inputDefinition))}</div> : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" onClick={onExecute} disabled={isExecuting || !canExecute}>
                {isExecuting ? '실행 요청 중…' : canExecute ? '실행' : '실행 불가'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
