import type { PromptRandomPick } from '@conai/shared';

// Token parsing lives in @conai/shared (promptRandomToken) so the editor chips and generation read the same syntax.

export function resolvePromptGroupPickCount(range: PromptRandomPick): number {
  if (range.max <= range.min) {
    return range.min;
  }
  return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}
