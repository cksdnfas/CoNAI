import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { ArtStyleLoadButton, type ArtStyleLoad } from './art-style-load-button'
import { CharacterSettingLoadButton, type CharacterSettingLoad, type CharacterSettingLoadTarget } from './character-setting-load-button'

/**
 * "캐릭터 불러오기" and "스타일 불러오기" of a generation form (NAI, Codex, ComfyUI), in one place: on the file name's
 * line (`leading`) when the layout shows it, otherwise right-aligned above the form's fields. Every form gives the
 * same kinds of targets; it writes what was loaded with its own setters.
 */
export function LibraryLoadRow({ leading, textTargets, stylePositiveTargets = textTargets, styleNegativeTargets = [], defaultStyleNegativeTargetId, referenceTargets, onCharacterLoad, onStyleLoad }: {
  /** The file name field, sharing the line. */
  leading?: ReactNode
  /** Where a character's appearance tags can go. */
  textTargets: CharacterSettingLoadTarget[]
  /** Where a style's positive prompt can go (default: `textTargets`). */
  stylePositiveTargets?: CharacterSettingLoadTarget[]
  /** Where a style's negative prompt can go; empty: the form has none. */
  styleNegativeTargets?: CharacterSettingLoadTarget[]
  defaultStyleNegativeTargetId?: string | null
  /** Where the images can go; a `multiple` target takes several. */
  referenceTargets: CharacterSettingLoadTarget[]
  onCharacterLoad: (load: CharacterSettingLoad) => void
  onStyleLoad: (load: ArtStyleLoad) => void
}) {
  const { t } = useI18n()
  const hasTargets = textTargets.length > 0 || referenceTargets.length > 0
  if (!hasTargets && !leading) return null
  return (
    <div className="flex items-center gap-1">
      {leading ? <div className="min-w-0 flex-1">{leading}</div> : null}
      {hasTargets ? (
        <div className="ml-auto flex shrink-0 gap-1">
          <CharacterSettingLoadButton label={t({ ko: '캐릭터 불러오기', en: 'Load character' })} textTargets={textTargets} referenceTargets={referenceTargets} onLoad={onCharacterLoad} />
          <ArtStyleLoadButton positiveTargets={stylePositiveTargets} negativeTargets={styleNegativeTargets} defaultNegativeTargetId={defaultStyleNegativeTargetId} referenceTargets={referenceTargets} onLoad={onStyleLoad} />
        </div>
      ) : null}
    </div>
  )
}
