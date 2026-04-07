import type { ReactNode } from 'react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export type EditorSupportSectionKey = 'setup' | 'inspector' | 'inputs' | 'validation' | 'results'

export interface ModuleWorkflowEditorSupportPanelProps {
  nodesCount: number
  edgesCount: number
  selectedGraphName: string | null
  selectedGraphVersion: number | null
  workflowName: string
  workflowDescription: string
  isDirty: boolean
  selectedNodeLabel: string | null
  selectedExecutionId: number | null
  isSavingGraph: boolean
  hasNodes: boolean
  onWorkflowNameChange: (value: string) => void
  onWorkflowDescriptionChange: (value: string) => void
  onSaveGraph: () => void
  setSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  folderPanel?: ReactNode
  inspectorPanel: ReactNode
  inputsPanel?: ReactNode
  validationPanel: ReactNode
  resultsPanel: ReactNode
}

/** Render the editor support drawer content for workflow setup, validation, and results. */
export function ModuleWorkflowEditorSupportPanel({
  nodesCount,
  edgesCount,
  selectedGraphName,
  selectedGraphVersion,
  workflowName,
  workflowDescription,
  isDirty,
  selectedNodeLabel,
  selectedExecutionId,
  isSavingGraph,
  hasNodes,
  onWorkflowNameChange,
  onWorkflowDescriptionChange,
  onSaveGraph,
  setSectionRef,
  folderPanel,
  inspectorPanel,
  inputsPanel,
  validationPanel,
  resultsPanel,
}: ModuleWorkflowEditorSupportPanelProps) {
  return (
    <div className="space-y-4">
      <div ref={(node) => { setSectionRef('setup', node) }} className="scroll-mt-24 md:scroll-mt-28">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading="Workflow Setup"
              actions={
                <>
                  <Badge variant="outline">N {nodesCount}</Badge>
                  <Badge variant="outline">E {edgesCount}</Badge>
                </>
              }
            />

            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-background/50 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">{selectedGraphName || workflowName || 'Untitled workflow'}</span>
              {selectedGraphVersion !== null ? <Badge variant="outline">v{selectedGraphVersion}</Badge> : <Badge variant="outline">draft</Badge>}
              {isDirty ? <Badge variant="outline">미저장</Badge> : <Badge variant="secondary">저장됨</Badge>}
              {selectedNodeLabel ? <Badge variant="secondary">노드 {selectedNodeLabel}</Badge> : null}
              {selectedExecutionId ? <Badge variant="secondary">실행 #{selectedExecutionId}</Badge> : null}
            </div>

            <div className="grid gap-3">
              <Input value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} placeholder="Workflow name" />
              <Input value={workflowDescription} onChange={(event) => onWorkflowDescriptionChange(event.target.value)} placeholder="설명 (선택)" />
            </div>

            {folderPanel}

            <Button type="button" onClick={onSaveGraph} disabled={isSavingGraph || !hasNodes}>
              {isSavingGraph ? '저장 중…' : selectedGraphVersion !== null ? '워크플로우 업데이트' : '워크플로우 저장'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div ref={(node) => { setSectionRef('inspector', node) }} className="scroll-mt-24 md:scroll-mt-28">
        {inspectorPanel}
      </div>

      {inputsPanel ? (
        <div ref={(node) => { setSectionRef('inputs', node) }} className="scroll-mt-24 md:scroll-mt-28">
          {inputsPanel}
        </div>
      ) : null}

      <div ref={(node) => { setSectionRef('validation', node) }} className="scroll-mt-24 md:scroll-mt-28">
        {validationPanel}
      </div>

      <div ref={(node) => { setSectionRef('results', node) }} className="scroll-mt-24 md:scroll-mt-28">
        {resultsPanel}
      </div>
    </div>
  )
}
