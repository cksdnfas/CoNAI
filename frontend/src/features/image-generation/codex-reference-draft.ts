import type { SelectedImageDraft } from './image-generation-shared'
import type { CodexFormDraft } from './components/codex-generation-panel'
import type { ChatPageValue } from '@conai/shared'

export const CODEX_REFERENCE_ROLES = ['reference', 'style', 'material', 'scale', 'item'] as const
export type CodexReferenceDraft = { role: typeof CODEX_REFERENCE_ROLES[number]; label: string; image?: SelectedImageDraft }

/** Draft persistence and history reuse intentionally restore empty slots, never unrelated image selections. */
export function codexReferenceSlots(value: unknown): CodexReferenceDraft[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 5).map((entry) => ({
    role: CODEX_REFERENCE_ROLES.includes(entry?.role) ? entry.role : 'reference',
    label: typeof entry?.label === 'string' ? entry.label.slice(0, 128) : '',
  }))
}

export function codexAttachmentUsage(images: Array<SelectedImageDraft | undefined>) {
  const bytes = images.filter((image) => image !== undefined).map((image) => {
    const base64 = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
    return base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  })
  return { count: bytes.length, bytes: bytes.reduce((sum, value) => sum + value, 0), oversized: bytes.some((value) => value > 10 * 1024 * 1024) }
}

export function codexReferencePayload(references: CodexReferenceDraft[], missingImageMessage: string) {
  return references.map((reference) => {
    if (!reference.image) throw new Error(missingImageMessage)
    return { role: reference.role, label: reference.label || undefined, data_url: reference.image.dataUrl }
  })
}

export function codexReferenceCapacity(form: Pick<CodexFormDraft, 'referenceImage' | 'maskImage'>) {
  return 5 - Number(Boolean(form.referenceImage)) - Number(Boolean(form.maskImage))
}

export function canEnableCodexStrict(form: Pick<CodexFormDraft, 'imageMode' | 'referenceImage' | 'maskImage'>) {
  return form.imageMode === 'edit' && Boolean(form.referenceImage && form.maskImage)
}

export function shouldConfirmCodexHistoryLoad(current: CodexFormDraft, next: CodexFormDraft) {
  return Boolean(current.referenceImage || current.maskImage || current.references.some((reference) => reference.image))
    || Boolean((current.prompt.trim() || current.negativePrompt.trim())
      && (current.prompt !== next.prompt || current.negativePrompt !== next.negativePrompt))
}

/** Shared assistant draft mutation: no hidden strict state and no reference slots beyond the attachment budget. */
export function applyCodexDraftPatch(current: CodexFormDraft, patch: Record<string, ChatPageValue>, t: (text: { ko: string; en: string }) => string): CodexFormDraft {
  const next = { ...current, references: current.references.map((reference) => ({ ...reference })) }
  if ('imageMode' in patch) next.imageMode = patch.imageMode === 'edit' ? 'edit' : 'reference'
  if (next.imageMode !== current.imageMode) { next.maskImage = undefined; next.strictPreservation = false }
  for (const [key, value] of Object.entries(patch)) {
    const referenceField = /^reference(\d+)(Role|Label|Order)$/.exec(key)
    if (key === 'referenceCount') {
      const count = Number(value)
      if (!Number.isInteger(count)) throw new Error(t({ ko: '참조 칸 수는 정수여야 해.', en: 'Reference count must be an integer' }))
      next.references = Array.from({ length: Math.max(0, Math.min(codexReferenceCapacity(next), count)) }, (_, index) => next.references[index] ?? { role: 'reference', label: '' })
    } else if (referenceField) {
      const index = Number(referenceField[1])
      const reference = next.references[index]
      if (!reference) throw new Error(t({ ko: '참조 칸을 찾지 못했어.', en: 'Reference slot not found' }))
      if (referenceField[2] === 'Role') {
        if (!CODEX_REFERENCE_ROLES.includes(value as CodexReferenceDraft['role'])) throw new Error(t({ ko: '참조 역할이 올바르지 않아.', en: 'Invalid reference role' }))
        reference.role = value as CodexReferenceDraft['role']
      } else if (referenceField[2] === 'Label') {
        if (String(value).length > 128) throw new Error(t({ ko: '참조 설명은 128자를 넘을 수 없어.', en: 'Reference label exceeds 128 characters' }))
        reference.label = String(value)
      } else {
        const order = Number(value)
        if (!Number.isInteger(order) || order < 1 || order > next.references.length) throw new Error(t({ ko: '참조 순서가 올바르지 않아.', en: 'Invalid reference order' }))
        next.references.splice(index, 1)
        next.references.splice(order - 1, 0, reference)
      }
    } else if (key !== 'imageMode') Object.assign(next, { [key]: value })
  }
  if (patch.strictPreservation === true && !canEnableCodexStrict(next)) {
    throw new Error(t({ ko: '엄격 보존에는 편집 모드와 원본, 마스크가 필요해.', en: 'Strict preservation requires edit mode, source and mask' }))
  }
  if (next.imageMode !== 'edit') next.strictPreservation = false
  return next
}
