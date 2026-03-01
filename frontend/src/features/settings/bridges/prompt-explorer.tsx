import { PromptExplorerFeature } from '@/features/prompt-explorer'
import type { PromptExplorerType } from '@/features/prompt-explorer'

interface PromptExplorerProps {
  type: PromptExplorerType
}

export function PromptExplorer({ type }: PromptExplorerProps) {
  return <PromptExplorerFeature type={type} />
}
