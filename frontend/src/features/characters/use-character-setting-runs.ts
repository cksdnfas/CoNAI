import { useQueryClient } from '@tanstack/react-query'
import { useAssetRuns } from '@/features/settings/components/chat-profile-asset-runs'
import { refreshCharacterSettingAssets, type CharacterSetting } from '@/lib/api-character-library'
import type { CharacterSettingEditorState } from './use-character-setting-editor'

/**
 * Character asset generation for the setting an editor holds (the library editor, or a profile synced to it): batches
 * are the setting's, and an applied slot moves the stored setting forward while the draft takes the picked image.
 */
export function useCharacterSettingRuns(editor: CharacterSettingEditorState, generation: boolean) {
  const queryClient = useQueryClient()
  const { base } = editor
  return useAssetRuns<CharacterSetting>({
    open: generation && editor.open,
    owner: base ? { kind: 'setting', id: base.id } : null,
    ensureOwner: async () => ({ kind: 'setting', id: (await editor.ensureSetting()).id }),
    refresh: (target, results, batchId) => refreshCharacterSettingAssets(queryClient, target.id, results, batchId),
    onApplied: (_, slot, updated) => {
      const patch = slot.kind === 'reference' ? { referenceHash: slot.hash } : slot.kind === 'avatar' ? { avatarHash: slot.hash, avatarCrop: null } : {}
      if (updated) editor.rebase(updated, patch)
      else editor.patch(patch)
    },
  })
}
