import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import type { AppearanceSettings } from '@conai/shared'
import {
  type AppearanceTabEditorSectionProps,
  getGroupExplorerCardStyleLabel,
  getRelatedImageAspectRatioLabel,
  RelatedImageColumnRow,
} from './appearance-tab-editor-shared'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'
import { useI18n } from '@/i18n'

/** Group browser card style and the related-image grid on the detail page. */
export function AppearanceListRows({
  appearanceDraft,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()
  const cardStyleLabel = t({ ko: '그룹 카드 스타일', en: 'Group card style' })
  const ratioLabel = t({ ko: '유사 이미지 카드 비율', en: 'Similar image card ratio' })

  return (
    <>
      <SettingRow label={cardStyleLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={cardStyleLabel}
          value={appearanceDraft.groupExplorerCardStyle}
          onChange={(event) => onPatchAppearance({ groupExplorerCardStyle: event.target.value as AppearanceSettings['groupExplorerCardStyle'] })}
        >
          {(['compact-row', 'media-tile'] as AppearanceSettings['groupExplorerCardStyle'][]).map((style) => (
            <option key={style} value={style}>
              {getGroupExplorerCardStyleLabel(style, t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      <RelatedImageColumnRow
        label={t({ ko: '유사 이미지 한 줄 카드 수 (모바일)', en: 'Similar images per row (mobile)' })}
        value={appearanceDraft.detailRelatedImageMobileColumns}
        onChange={(value) => onPatchAppearance({ detailRelatedImageMobileColumns: value })}
      />

      <RelatedImageColumnRow
        label={t({ ko: '유사 이미지 한 줄 카드 수 (데스크톱)', en: 'Similar images per row (desktop)' })}
        value={appearanceDraft.detailRelatedImageColumns}
        onChange={(value) => onPatchAppearance({ detailRelatedImageColumns: value })}
      />

      <SettingRow label={ratioLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={ratioLabel}
          value={appearanceDraft.detailRelatedImageAspectRatio}
          onChange={(event) => onPatchAppearance({ detailRelatedImageAspectRatio: event.target.value as AppearanceSettings['detailRelatedImageAspectRatio'] })}
        >
          {(['original', 'square', 'portrait', 'landscape'] as AppearanceSettings['detailRelatedImageAspectRatio'][]).map((ratio) => (
            <option key={ratio} value={ratio}>
              {getRelatedImageAspectRatioLabel(ratio, t)}
            </option>
          ))}
        </Select>
      </SettingRow>
    </>
  )
}
