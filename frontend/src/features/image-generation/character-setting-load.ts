import { characterImageUrl } from '@/features/characters/character-library-shared'
import type { CharacterSetting } from '@/lib/api-character-library'
import { buildSelectedImageDraftFromUrl } from './image-generation-drafts'
import type { SelectedImageDraft } from './image-generation-shared'

/**
 * Loading a character library setting into a generation form copies its values at that moment (approved "copy"
 * semantics): later library edits never change the form. The form and the page assistant both build on these.
 */

/** The setting's reference image as a form image: the library file unchanged, so it keeps its composite hash. */
export async function loadCharacterReferenceDraft(setting: Pick<CharacterSetting, 'name' | 'referenceHash'>): Promise<SelectedImageDraft> {
  const hash = setting.referenceHash
  if (!hash) throw new Error('This setting has no reference image.')
  const draft = await buildSelectedImageDraftFromUrl(characterImageUrl(hash))
  const baseName = setting.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'character-reference'
  const extension = draft.mimeType?.split('/')[1]?.split(/[;+]/)[0]
  return { ...draft, fileName: extension ? `${baseName}.${extension}` : baseName, compositeHash: hash }
}
