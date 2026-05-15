import { resolvePromptListProgress, type PromptListProgress, type PromptListProgressInput } from './prompt-list-progress'

export type DanbooruBrowserProgressInput = PromptListProgressInput
export type DanbooruBrowserProgress = PromptListProgress

export function resolveDanbooruBrowserProgress(input: DanbooruBrowserProgressInput): DanbooruBrowserProgress {
  return resolvePromptListProgress(input)
}
