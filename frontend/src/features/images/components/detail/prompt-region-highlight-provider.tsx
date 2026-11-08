import { useEffect, useState, type ReactNode } from 'react'
import { ActivePromptRegionContext, SetActivePromptRegionContext } from './prompt-region-highlight-context'

/** Holds the hovered layout-prompt region in its own state so a hover re-renders only its consumers, not the whole detail view. */
export function PromptRegionHighlightProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [activeRegion, setActiveRegion] = useState<number | null>(null)

  useEffect(() => {
    setActiveRegion(null)
  }, [resetKey])

  return (
    <SetActivePromptRegionContext.Provider value={setActiveRegion}>
      <ActivePromptRegionContext.Provider value={activeRegion}>{children}</ActivePromptRegionContext.Provider>
    </SetActivePromptRegionContext.Provider>
  )
}
