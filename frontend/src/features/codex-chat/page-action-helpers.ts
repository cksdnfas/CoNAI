import type { ChatPageAction, ChatPageData, ChatPageSchema } from '@conai/shared'

export const pageText = (maxLength = 8000): ChatPageSchema => ({ type: 'string', maxLength })
export const pageNumber = (minimum?: number, maximum?: number, integer = false): ChatPageSchema => ({ type: 'number', ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}), ...(integer ? { integer } : {}) })
export const pageChoice = (values: Array<string | number>): ChatPageSchema => ({ type: typeof values[0] === 'number' ? 'number' : 'string', enum: values })
export const pageObject = (properties: Record<string, ChatPageSchema>, required: string[] = []): ChatPageSchema => ({ type: 'object', properties, required })
export const pageArray = (items: ChatPageSchema, maxItems = 128, minItems = 0): ChatPageSchema => ({ type: 'array', items, maxItems, minItems })
export const pageAction = (id: string, label: string, description: string, schema = pageObject({}), effect: 'draft' | 'save' = 'draft'): ChatPageAction => ({ id, label, description, schema, effect })
export function pageRecord(value: ChatPageData | undefined): Record<string, ChatPageData> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('객체 입력이 필요해.')
  return value
}
/** Native mutations use this server-issued revision to reject concurrent writes at the actual save boundary. */
export function pageEditHeaders(revision?: string) { return { 'Content-Type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) } }
