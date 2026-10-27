import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { CharacterAppearanceEditor } from '@/features/settings/components/character-appearance-editor'
import type { AssetRuns } from '@/features/settings/components/chat-profile-asset-runs'
import { clearChatProfileExpression, setChatProfileExpression } from '@/lib/api-codex-chat'
import { draftCharacterAppearance, refreshCharacterSettingAssets } from '@/lib/api-character-library'
import { characterImageUrl } from '../character-library-shared'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'

/**
 * The look of the setting an editor holds (reference, avatar, appearance tags, expressions, candidates), bound to the
 * setting: imports, generation and expressions are the setting's. The library editor and a profile synced to the
 * setting both show it. Without `editable` it only shows; `generation` (administrators) adds imports and generation.
 */
export function CharacterSettingAppearanceEditor({ editor, runs, editable, generation, busy, onBusyChange, appearanceWarning = null, children }: {
  editor: CharacterSettingEditorState
  runs: AssetRuns
  editable: boolean
  generation: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
  /** Why the appearance text needs writing (a synced profile's after-reply pictures read only it); marks it invalid. */
  appearanceWarning?: string | null
  children?: ReactNode
}) {
  const queryClient = useQueryClient()
  const { base, draft } = editor
  const avatarUrl = draft.avatarHash ? characterImageUrl(draft.avatarHash) : null

  const setExpression = async (name: string, hash: string) => {
    const current = await editor.ensureSetting()
    const result = await setChatProfileExpression({ kind: 'setting', id: current.id }, name, hash)
    editor.rebase(await refreshCharacterSettingAssets(queryClient, current.id, [{ expressionGroupId: result.expressionGroupId }]))
  }
  const clearExpression = async (name: string) => {
    if (!base) return
    const result = await clearChatProfileExpression({ kind: 'setting', id: base.id }, name)
    editor.rebase(await refreshCharacterSettingAssets(queryClient, base.id, [result]))
  }

  return (
    <CharacterAppearanceEditor
      value={draft}
      onChange={editor.patch}
      onAvatarChange={(avatarHash, avatarCrop) => editor.patch({ avatarHash, avatarCrop: avatarHash ? avatarCrop : null })}
      referenceUrl={draft.referenceHash ? characterImageUrl(draft.referenceHash) : null}
      avatar={<ChatProfileAvatar name={draft.name || '?'} imageUrl={avatarUrl} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine="llm" className="size-[72px]" size="xl" />}
      hasAvatar={Boolean(draft.avatarHash)}
      // An import only adds an image to a saved setting's draft; a new one is created first so the image has an owner.
      uploadTarget={generation ? (base ? { settingId: base.id } : async () => ({ settingId: (await editor.ensureSetting()).id })) : null}
      groupSource={{ expressionGroupId: base?.expressionGroupId ?? null, candidateGroupId: base?.candidateGroupId ?? null }}
      runs={runs}
      busy={busy}
      onBusyChange={onBusyChange}
      draftAppearance={generation ? (signal) => draftCharacterAppearance({ settingId: base?.id ?? null, name: draft.name.trim(), appearance: draft.appearance, referenceHash: draft.referenceHash }, signal) : undefined}
      draftNeedsName
      appearanceWarning={appearanceWarning}
      appearanceInvalid={Boolean(appearanceWarning)}
      onSetExpression={setExpression}
      onClearExpression={clearExpression}
      editable={editable}
      generation={generation}
    >
      {children}
    </CharacterAppearanceEditor>
  )
}
