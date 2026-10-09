import { Fragment } from 'react'
import { Sparkles } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { ChatProfile, ChatSharedBlock, ChatStyle } from '@/lib/api-codex-chat'
import { ChatCastEditor } from './chat-profile-cast'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatProfileLook } from './chat-profile-look'
import { CollapsibleRow } from './chat-profile-sections'
import { BACKGROUND_SLOT, type ProfileAssetRuns } from './chat-profile-asset-runs'
import { AssetCandidateTray, AssetPresetPicker } from './chat-profile-asset-slots'

/**
 * How the profile's chats look: typeface, background (generated here too) and roleplay colours, then the folded
 * extras (cast, display blocks). A fold starts open when it has content, so nothing set is hidden behind a click.
 */
export function ChatProfileLookPanel({ draft, patch, defaults, backgroundUrl, blocks, onBusyChange, busy, profile, runs }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatStyle | undefined
  backgroundUrl: string | null
  /** The shared display blocks (settings › chat); undefined until they load. */
  blocks: ChatSharedBlock[] | undefined
  onBusyChange: (busy: boolean) => void
  busy: boolean
  profile: ChatProfile | null
  runs: ProfileAssetRuns
}) {
  const { t } = useI18n()
  const { style } = draft
  const patchStyle = (next: Partial<ChatStyle>) => patch({ style: { ...style, ...next } })
  const count = (value: number, ko: string, en: string) => (value > 0 ? t({ ko, en }, { count: value }) : null)
  const background = runs.slotState(BACKGROUND_SLOT)
  const generateBlocked = !runs.preset ? t({ ko: '자산을 만들 수 있는 생성 프리셋이 없어', en: 'No generation preset can make assets' }) : !draft.name.trim() ? t({ ko: '이름을 먼저 적어줘', en: 'Enter a name first' }) : null
  const linkedKeys = new Set((blocks ?? []).filter((shared) => draft.blockIds.includes(shared.id)).map((shared) => shared.block.key))

  return (
    <div className="space-y-4">
      <EditorGroup>
        <ChatProfileLook
          style={style}
          defaults={defaults}
          backgroundUrl={backgroundUrl}
          onStyleChange={(next) => patch({ style: next })}
          characterName={draft.name}
          hasBackground={Boolean(draft.backgroundHash || backgroundUrl)}
          onBackgroundHashChange={(backgroundHash) => patch({ backgroundHash, background: backgroundHash === (profile?.backgroundHash ?? draft.backgroundHash) ? undefined : null })}
          onBusyChange={onBusyChange}
          busy={busy}
          onBackgroundChange={(background) => patch({ background, backgroundHash: null })}
          backgroundActions={(
            <IconButton size="icon-sm" variant="ghost" disabled={busy || Boolean(generateBlocked) || background.working || runs.isPending(BACKGROUND_SLOT)} label={generateBlocked ?? t({ ko: '배경 만들기', en: 'Generate background' })} onClick={() => void runs.start({ kind: 'background' }, !draft.backgroundHash && !backgroundUrl)}>
              <Sparkles />
            </IconButton>
          )}
        />
        {background.working || background.failed || background.candidates.length ? (
          <AssetCandidateTray runs={runs} slotKey={BACKGROUND_SLOT} title={t({ ko: '배경', en: 'Background' })} currentHash={draft.backgroundHash ?? null} referenceHash={null} profileId={profile?.id ?? null} actions={<AssetPresetPicker runs={runs} />} wide />
        ) : null}
      </EditorGroup>
      <div className="border-t border-line">
        <CollapsibleRow title={t({ ko: '등장인물', en: 'Characters' })} meta={count(style.cast.length, '{count}명', '{count}')} defaultOpen={style.cast.length > 0}>
          <ChatCastEditor cast={style.cast} onChange={(cast) => patchStyle({ cast })} />
        </CollapsibleRow>
        {/* Shared blocks are made and edited in settings › chat; here the profile only links them, like lorebooks. */}
        <CollapsibleRow title={t({ ko: '표시 블록', en: 'Display blocks' })} meta={count(draft.blockIds.length, '{count}개', '{count}')} defaultOpen={draft.blockIds.length > 0}>
          <div className="flex flex-wrap gap-1.5">
            {(blocks ?? []).map((shared) => {
              const linked = draft.blockIds.includes(shared.id)
              // Two blocks with the same fence name cannot both show; the second stays unlinkable until the first is unlinked.
              const clash = !linked && linkedKeys.has(shared.block.key)
              const chip = (
                <ToggleChip
                  pressed={linked}
                  disabled={clash}
                  onClick={() => patch({ blockIds: linked ? draft.blockIds.filter((id) => id !== shared.id) : [...draft.blockIds, shared.id] })}
                >
                  {shared.name}
                  <span className="font-mono opacity-60">{shared.block.key}</span>
                </ToggleChip>
              )
              // A disabled button never shows a tooltip, so the clash reason sits on a focusable wrapper.
              return clash ? (
                <Tip key={shared.id} content={t({ ko: '같은 이름({key})의 블록이 이미 연결돼 있어.', en: 'A block named {key} is already linked.' }, { key: shared.block.key })}>
                  <span className="inline-flex" tabIndex={0}>{chip}</span>
                </Tip>
              ) : <Fragment key={shared.id}>{chip}</Fragment>
            })}
            {blocks && blocks.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: '아직 없어.', en: 'None yet.' })}</span> : null}
          </div>
        </CollapsibleRow>
      </div>
    </div>
  )
}
