import type { PromptTypeFilter } from '@/types/prompt'

/** What /prompts shows, kept in `?tab=` (`wildcards` is redirected to /wildcards). */
export type PromptPageView = PromptTypeFilter | 'danbooru' | 'presets'

export const PROMPT_PAGE_VIEWS: readonly PromptPageView[] = ['positive', 'negative', 'auto', 'danbooru', 'presets']

/** Read the `?tab=` value of /prompts; unknown values fall back to the positive list. */
export function parsePromptPageView(value: string | null): PromptPageView {
  return PROMPT_PAGE_VIEWS.includes(value as PromptPageView) ? (value as PromptPageView) : 'positive'
}

export function isPromptTypeView(view: PromptPageView): view is PromptTypeFilter {
  return view === 'positive' || view === 'negative' || view === 'auto'
}
