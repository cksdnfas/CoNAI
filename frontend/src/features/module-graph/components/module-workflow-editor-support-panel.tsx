import type { ReactNode } from 'react'

export type EditorSupportSectionKey = 'setup' | 'inspector' | 'inputs' | 'validation' | 'results'

export interface ModuleWorkflowEditorSupportPanelProps {
  setSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  inspectorPanel?: ReactNode
  resultsPanel: ReactNode
}

/** Render the inspector/results drawer content for the workflow editor. */
export function ModuleWorkflowEditorSupportPanel({
  setSectionRef,
  inspectorPanel,
  resultsPanel,
}: ModuleWorkflowEditorSupportPanelProps) {
  return (
    <div className="space-y-4">
      {inspectorPanel ? (
        <div ref={(node) => { setSectionRef('inspector', node) }} className="scroll-mt-24 md:scroll-mt-28">
          {inspectorPanel}
        </div>
      ) : null}
      <div ref={(node) => { setSectionRef('results', node) }} className="scroll-mt-24 md:scroll-mt-28">
        {resultsPanel}
      </div>
    </div>
  )
}
