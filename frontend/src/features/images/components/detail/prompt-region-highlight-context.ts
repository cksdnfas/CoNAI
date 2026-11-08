import { createContext, useContext } from 'react'

/** The layout-prompt region the pointer is on: the prompt cards set it, the viewer image and the thumbnail map show it. */
export const ActivePromptRegionContext = createContext<number | null>(null)
export const SetActivePromptRegionContext = createContext<(index: number | null) => void>(() => undefined)

export function useActivePromptRegion() {
  return useContext(ActivePromptRegionContext)
}

export function useSetActivePromptRegion() {
  return useContext(SetActivePromptRegionContext)
}
