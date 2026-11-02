import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { CharacterAppearanceEditor, type CharacterAppearanceTab } from '@/features/settings/components/character-appearance-editor'
import type { AssetRuns } from '@/features/settings/components/chat-profile-asset-runs'
import { clearChatProfileExpression, setChatProfileExpression } from '@/lib/api-codex-chat'
import { refreshCharacterSettingAssets } from '@/lib/api-character-library'
import { characterImageUrl } from '../character-library-shared'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'
import { CharacterLookEditor } from './character-look-editor'
import { CharacterReferenceGallery } from './character-reference-gallery'

/**
 * The look of the setting an editor holds (reference, avatar, sectioned tags and outfits, expressions, candidates), bound to the
 * setting: imports, generation and expressions are the setting's. The library editor and a profile synced to the
 * setting both show it. Without `editable` it only shows; `generation` (administrators) adds generation.
 */
export function CharacterSettingAppearanceEditor({ editor, runs, editable, generation, busy, onBusyChange, appearanceWarning = null, tab, tabs, children }: {
  editor: CharacterSettingEditorState
  runs: AssetRuns
  editable: boolean
  generation: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
  /** Why the appearance text needs writing (a synced profile's after-reply pictures read only it); marks it invalid. */
  appearanceWarning?: string | null
  tab?: CharacterAppearanceTab
  /** The tab strip over the tab content (with `tab`). */
  tabs?: ReactNode
  children?: ReactNode
}) {
  const queryClient = useQueryClient()
  const { base, draft } = editor
  const avatarUrl = draft.avatarHash ? characterImageUrl(draft.avatarHash) : null

  const setExpression = async (name: string, hash: string) => {
    if (!generation || !editor.isCurrent()) return
    const current = editor.baseRef.current ?? await editor.ensureSetting()
    if (!editor.isCurrent()) return
    const result = await setChatProfileExpression({ kind: 'setting', id: current.id }, name, hash)
    const latest = await refreshCharacterSettingAssets(queryClient, current.id, [{ expressionGroupId: result.expressionGroupId }])
    if (editor.isCurrent()) editor.rebase(latest)
  }
  const clearExpression = async (name: string) => {
    if (!generation || !base || !editor.isCurrent()) return
    const result = await clearChatProfileExpression({ kind: 'setting', id: base.id }, name)
    const latest = await refreshCharacterSettingAssets(queryClient, base.id, [result])
    if (editor.isCurrent()) editor.rebase(latest)
  }

  return (
    <CharacterAppearanceEditor
      key={editor.session}
      value={draft}
      onChange={editor.patch}
      onAvatarChange={(avatarHash, avatarCrop) => editor.patch({ avatarHash, avatarCrop: avatarHash ? avatarCrop : null })}
      referenceUrl={draft.referenceHash ? characterImageUrl(draft.referenceHash) : null}
      avatar={<ChatProfileAvatar name={draft.name || '?'} imageUrl={avatarUrl} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine="llm" className={tab ? 'size-14' : 'size-[72px]'} size="xl" />}
      hasAvatar={Boolean(draft.avatarHash)}
      // An import only adds an image to a saved setting's draft; a new one is created first so the image has an owner.
      uploadTarget={generation ? (base ? { settingId: base.id } : async () => ({ settingId: (await editor.ensureSetting()).id })) : null}
      groupSource={{ expressionGroupId: base?.expressionGroupId ?? null, candidateGroupId: base?.candidateGroupId ?? null }}
      runs={runs}
      busy={busy}
      onBusyChange={onBusyChange}
      appearanceEditor={<CharacterLookEditor editor={editor} editable={editable} generation={generation} busy={busy} onBusyChange={onBusyChange} warning={appearanceWarning} />}
      onSetExpression={setExpression}
      onClearExpression={clearExpression}
      editable={editable}
      generation={generation}
      tab={tab}
      tabs={tabs}
      gallery={<CharacterReferenceGallery editor={editor} editable={editable} canUpload={generation} imageTabShown={tab === 'images'} busy={busy} onBusyChange={onBusyChange} />}
    >
      {children}
    </CharacterAppearanceEditor>
  )
}
