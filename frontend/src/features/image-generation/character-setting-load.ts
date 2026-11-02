import { characterImageUrl } from '@/features/characters/character-library-shared'
import type { CharacterSetting } from '@/lib/api-character-library'
import { buildSelectedImageDraftFromUrl } from './image-generation-drafts'
import type { SelectedImageDraft } from './image-generation-shared'

/**
 * Loading a character library setting into a generation form copies its values at that moment (approved "copy"
 * semantics): later library edits never change the form. The form and the page assistant both build on these.
 */

/** An image a setting offers a form: its reference image, or one of its gallery images. */
export type CharacterSettingImage = { hash: string; category: string | null; isReference: boolean }

/** The setting's images a form can take: the reference image first, then the gallery in its order (each once). */
export function characterSettingImages(setting: Pick<CharacterSetting, 'referenceHash' | 'references'>): CharacterSettingImage[] {
  const images: CharacterSettingImage[] = setting.referenceHash ? [{ hash: setting.referenceHash, category: setting.references.find((image) => image.hash === setting.referenceHash)?.category ?? null, isReference: true }] : []
  for (const image of setting.references) if (image.hash !== setting.referenceHash) images.push({ hash: image.hash, category: image.category, isReference: false })
  return images
}

/** One of the setting's images as a form image: the library file unchanged, so it keeps its composite hash. */
export async function loadCharacterImageDraft(settingName: string, hash: string): Promise<SelectedImageDraft> {
  const draft = await buildSelectedImageDraftFromUrl(characterImageUrl(hash))
  const baseName = settingName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'character-reference'
  const extension = draft.mimeType?.split('/')[1]?.split(/[;+]/)[0]
  return { ...draft, fileName: extension ? `${baseName}.${extension}` : baseName, compositeHash: hash }
}
