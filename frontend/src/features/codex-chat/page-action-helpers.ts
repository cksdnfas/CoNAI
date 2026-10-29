import type { ChatPageAction, ChatPageData, ChatPageSchema, NativeChatPageActionId } from '@conai/shared'

export const pageText = (maxLength = 8000): ChatPageSchema => ({ type: 'string', maxLength })
export const pageNumber = (minimum?: number, maximum?: number, integer = false): ChatPageSchema => ({ type: 'number', ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}), ...(integer ? { integer } : {}) })
export const pageChoice = (values: string[] | number[]): ChatPageSchema => ({ type: typeof values[0] === 'number' ? 'number' : 'string', enum: values })
export const pageObject = (properties: Record<string, ChatPageSchema>, required: string[] = []): ChatPageSchema => ({ type: 'object', properties, required })
export const pageArray = (items: ChatPageSchema, maxItems = 128, minItems = 0): ChatPageSchema => ({ type: 'array', items, maxItems, minItems })
export const pageAction = (id: NativeChatPageActionId, label: string, description: string, schema = pageObject({}), effect: 'draft' | 'save' = 'draft'): ChatPageAction => ({ id, label, description, schema, effect })
export function pageRecord(value: ChatPageData | undefined): Record<string, ChatPageData> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('객체 입력이 필요해.')
  return value
}
/**
 * Page data refuses strings that start like a link (media stays in the native page). Free text that does (a comment
 * that is only a URL, a document that opens with one) gets a zero-width space (U+200B) in front, not part of the text.
 */
export const pageFreeText = (text: string) => (/^(?:data:|https?:\/\/)/i.test(text.trim()) ? String.fromCharCode(0x200b) + text : text)
