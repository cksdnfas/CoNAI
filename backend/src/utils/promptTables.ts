export type PromptTableType = 'positive' | 'negative' | 'auto';

/** Resolve the prompt collection table for one prompt domain. */
export function getPromptCollectionTableName(type: PromptTableType): string {
  switch (type) {
    case 'auto': return 'auto_prompt_collection';
    case 'negative': return 'negative_prompt_collection';
    case 'positive':
    default: return 'prompt_collection';
  }
}

/** Resolve the prompt group table for one prompt domain. */
export function getPromptGroupTableName(type: PromptTableType): string {
  switch (type) {
    case 'auto': return 'auto_prompt_groups';
    case 'negative': return 'negative_prompt_groups';
    case 'positive':
    default: return 'prompt_groups';
  }
}
