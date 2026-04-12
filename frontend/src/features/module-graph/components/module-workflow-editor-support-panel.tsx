import type { ReactNode } from 'react'

export type EditorSupportSectionKey = 'setup' | 'inspector' | 'inputs' | 'validation' | 'results'

export interface ModuleWorkflowEditorSupportPanelProps {
  setSectionRef: (section: EditorSupportSectionKey, node: HTMLDivElement | null) => void
  resultsPanel: ReactNode
}

/** Render the execution-results-only drawer content for the workflow editor. */
export function ModuleWorkflowEditorSupportPanel({
  setSectionRef,
  resultsPanel,
}: ModuleWorkflowEditorSupportPanelProps) {
  return (
    <div ref={(node) => { setSectionRef('results', node) }} className="scroll-mt-24 md:scroll-mt-28">
      {resultsPanel}
    </div>
  )
}
