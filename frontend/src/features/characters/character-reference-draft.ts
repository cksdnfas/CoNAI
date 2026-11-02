import type { SettingDraft } from './character-library-shared'

export type ReferenceEdit =
  | { kind: 'add'; hashes: string[]; category: string | null }
  | { kind: 'category'; hash: string; category: string | null }
  | { kind: 'remove'; hash: string }
  | { kind: 'reference'; hash: string }
  | { kind: 'reorder'; hash: string; before: string }
  | { kind: 'add-category'; name: string }
  | { kind: 'rename-category'; name: string; next: string }
  | { kind: 'remove-category'; name: string }

/** Both the gallery and page assistant edit the same revision-checked draft, never the asset store. */
export function editReferenceDraft(draft: SettingDraft, edit: ReferenceEdit): Partial<SettingDraft> {
  const { references, referenceCategories } = draft
  if (edit.kind === 'add' || edit.kind === 'category') {
    if (edit.category !== null && !referenceCategories.includes(edit.category)) throw new Error('Unknown image category')
    if (edit.kind === 'add') {
      const known = new Set(references.map((image) => image.hash))
      const added = edit.hashes.filter((hash) => hash && !known.has(hash) && Boolean(known.add(hash)))
      return { references: [...references, ...added.map((hash) => ({ hash, category: edit.category }))] }
    }
    if (!references.some((image) => image.hash === edit.hash)) throw new Error('Unknown reference image')
    return { references: references.map((image) => image.hash === edit.hash ? { ...image, category: edit.category } : image) }
  }
  if (edit.kind === 'remove') return { references: references.filter((image) => image.hash !== edit.hash) }
  if (edit.kind === 'reference') {
    if (!references.some((image) => image.hash === edit.hash)) throw new Error('Unknown reference image')
    return { referenceHash: edit.hash }
  }
  if (edit.kind === 'reorder') {
    const image = references.find((image) => image.hash === edit.hash)
    if (!image || edit.hash === edit.before || !references.some((image) => image.hash === edit.before)) return {}
    const next = references.filter((image) => image.hash !== edit.hash)
    next.splice(next.findIndex((image) => image.hash === edit.before), 0, image)
    return { references: next }
  }
  if (edit.kind === 'remove-category') return {
    referenceCategories: referenceCategories.filter((name) => name !== edit.name),
    references: references.map((image) => image.category === edit.name ? { ...image, category: null } : image),
  }
  const name = (edit.kind === 'add-category' ? edit.name : edit.next).trim()
  if (!name) throw new Error('Enter an image category name')
  if (referenceCategories.some((category) => category.toLowerCase() === name.toLowerCase() && (edit.kind !== 'rename-category' || category !== edit.name))) throw new Error('That image category already exists')
  if (edit.kind === 'add-category') return { referenceCategories: [...referenceCategories, name] }
  if (!referenceCategories.includes(edit.name)) throw new Error('Unknown image category')
  return {
    referenceCategories: referenceCategories.map((category) => category === edit.name ? name : category),
    references: references.map((image) => image.category === edit.name ? { ...image, category: name } : image),
  }
}
