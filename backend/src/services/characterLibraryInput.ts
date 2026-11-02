import { z } from 'zod'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'

export const characterLibraryId = z.number().int().positive().safe()
// Check controls before trim; library slashes are literal names, not image-group paths.
export const characterLibraryName = z.string().regex(/^[^\u0000-\u001f\u007f]*$/).trim().min(1).max(CHAT_PROFILE_TEXT_LIMITS.name)
const lookText = z.string().max(CHAT_PROFILE_TEXT_LIMITS.text)
export const characterSectionsSchema = z.object({
  identity: lookText.optional(), hair: lookText.optional(), eyes: lookText.optional(), face: lookText.optional(),
  body: lookText.optional(), skin: lookText.optional(), traits: lookText.optional(), other: lookText.optional(),
}).strict()
// Profiles and workflows pick an outfit by name, so names are unique within a setting.
export const characterOutfitsSchema = z.array(z.object({ name: characterLibraryName, tags: lookText }).strict())
  .refine((outfits) => new Set(outfits.map((outfit) => outfit.name.toLowerCase())).size === outfits.length, '의상 이름이 겹쳐. 의상마다 다른 이름을 붙여줘.')
export const characterReferenceCategoriesSchema = z.array(characterLibraryName)
  .refine((names) => new Set(names.map((name) => name.toLowerCase())).size === names.length, '참고 이미지 분류 이름이 겹쳐. 분류마다 다른 이름을 붙여줘.')
export const characterReferencesSchema = z.array(z.object({ hash: z.string().min(1), category: characterLibraryName.nullable() }).strict())
  .refine((references) => new Set(references.map((reference) => reference.hash)).size === references.length, '같은 이미지를 참고 갤러리에 두 번 넣을 수 없어.')
export const characterSettingFields = {
  folderId: characterLibraryId.nullable(),
  name: characterLibraryName,
  appearance: lookText.optional(),
  sections: characterSectionsSchema.optional(),
  outfits: characterOutfitsSchema.optional(),
  referenceHash: z.string().nullable().optional(),
  avatarHash: z.string().nullable().optional(),
  avatarCrop: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }).nullable().optional(),
  references: characterReferencesSchema.optional(),
  referenceCategories: characterReferenceCategoriesSchema.optional(),
}
export const characterSettingCreateSchema = z.object(characterSettingFields).strict()
export const characterSettingPatchSchema = characterSettingCreateSchema.partial().extend({ revision: characterLibraryId }).strict()
export const characterFolderCreateSchema = z.object({ parentId: characterLibraryId.nullable(), name: characterLibraryName }).strict()
export const characterFolderPatchSchema = characterFolderCreateSchema.partial().strict()
