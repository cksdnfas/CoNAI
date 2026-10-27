import { z } from 'zod'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'

export const characterLibraryId = z.number().int().positive().safe()
// Check controls before trim; library slashes are literal names, not image-group paths.
export const characterLibraryName = z.string().regex(/^[^\u0000-\u001f\u007f]*$/).trim().min(1).max(CHAT_PROFILE_TEXT_LIMITS.name)
export const characterSettingFields = {
  folderId: characterLibraryId.nullable(),
  name: characterLibraryName,
  appearance: z.string().max(CHAT_PROFILE_TEXT_LIMITS.text).optional(),
  referenceHash: z.string().nullable().optional(),
  avatarHash: z.string().nullable().optional(),
  avatarCrop: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }).nullable().optional(),
}
export const characterSettingCreateSchema = z.object(characterSettingFields).strict()
export const characterSettingPatchSchema = characterSettingCreateSchema.partial().extend({ revision: characterLibraryId }).strict()
export const characterFolderCreateSchema = z.object({ parentId: characterLibraryId.nullable(), name: characterLibraryName }).strict()
export const characterFolderPatchSchema = characterFolderCreateSchema.partial().strict()
