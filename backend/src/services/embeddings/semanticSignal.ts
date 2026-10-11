/**
 * "Something embeddable changed" signal, apart from the indexer so stores (chat, lore, files, media) can raise it
 * without importing what the indexer imports. The indexer listens once started; before that a signal is dropped (its
 * first pass looks at everything anyway).
 */

export type SemanticSource = 'recall' | 'lore' | 'message' | 'file' | 'image'

let listener: ((source: SemanticSource) => void) | null = null

export function onSemanticChange(handler: ((source: SemanticSource) => void) | null) {
  listener = handler
}

export function notifySemanticChange(source: SemanticSource) {
  try {
    listener?.(source)
  } catch (error) {
    console.warn('[SemanticIndex] change signal failed:', error instanceof Error ? error.message : error)
  }
}
