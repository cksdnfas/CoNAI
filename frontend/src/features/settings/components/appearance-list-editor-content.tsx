import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import type { AppearanceSettings } from '@conai/shared'
import {
  type AppearanceTabEditorSectionProps,
  getGroupExplorerCardStyleLabel,
  getRelatedImageAspectRatioLabel,
  RelatedImageColumnRow,
} from './appearance-tab-editor-shared'
import { ChatFilledLabel } from './settings-filled-label'
import { useI18n, type TranslationDictionary } from '@/i18n'
import { SliderRow } from '@/components/ui/slider-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'

const IMAGE_TILE_RADIUS_OPTIONS: Array<[AppearanceSettings['imageTileRadius'], TranslationDictionary]> = [
  ['theme', { ko: '테마 모서리 따름', en: 'Follow theme corners' }],
  ['none', { ko: '각지게', en: 'Square' }],
  ['small', { ko: '작게 (4px)', en: 'Small (4px)' }],
  ['medium', { ko: '보통 (8px)', en: 'Medium (8px)' }],
  ['large', { ko: '크게 (16px)', en: 'Large (16px)' }],
]

const IMAGE_HOVER_OPTIONS: Array<[AppearanceSettings['imageHoverEffect'], TranslationDictionary]> = [
  ['dim', { ko: '살짝 흐리게', en: 'Dim' }],
  ['zoom', { ko: '살짝 확대', en: 'Zoom' }],
  ['none', { ko: '효과 없음', en: 'None' }],
]

/** Group browser card style, the related-image grid on the detail page, and image tile look. */
export function AppearanceListRows({
  appearanceDraft,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()
  const cardStyleLabel = t({ ko: '그룹 카드 스타일', en: 'Group card style' })
  const ratioLabel = t({ ko: '유사 이미지 카드 비율', en: 'Similar image card ratio' })
  const gapLabel = t({ ko: '이미지 간격 (px)', en: 'Image gap (px)' })
  const radiusLabel = t({ ko: '썸네일 모서리', en: 'Thumbnail corners' })
  const hoverLabel = t({ ko: '썸네일 호버 효과', en: 'Thumbnail hover effect' })
  const blurLabel = t({ ko: '가림 블러 강도 (px)', en: 'Hidden preview blur (px)' })

  return (
    <>
      <SettingRow label={<ChatFilledLabel fieldId="appearance.groupExplorerCardStyle">{cardStyleLabel}</ChatFilledLabel>} controlWidth="standard">
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
        fieldId="appearance.detailRelatedImageMobileColumns"
        label={t({ ko: '유사 이미지 한 줄 카드 수 (모바일)', en: 'Similar images per row (mobile)' })}
        value={appearanceDraft.detailRelatedImageMobileColumns}
        onChange={(value) => onPatchAppearance({ detailRelatedImageMobileColumns: value })}
      />

      <RelatedImageColumnRow
        fieldId="appearance.detailRelatedImageColumns"
        label={t({ ko: '유사 이미지 한 줄 카드 수 (데스크톱)', en: 'Similar images per row (desktop)' })}
        value={appearanceDraft.detailRelatedImageColumns}
        onChange={(value) => onPatchAppearance({ detailRelatedImageColumns: value })}
      />

      <SettingRow label={<ChatFilledLabel fieldId="appearance.detailRelatedImageAspectRatio">{ratioLabel}</ChatFilledLabel>} controlWidth="standard">
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

      <SettingRow
        label={<ChatFilledLabel fieldId="appearance.imageListGap">{gapLabel}</ChatFilledLabel>}
        info={t({ ko: '홈 갤러리 기준이야. 다른 목록도 같은 비율로 넓어지거나 좁아져.', en: 'Measured on the home gallery; other lists scale by the same ratio.' })}
        controlWidth="standard"
      >
        <SliderRow className="w-full" label={null} labelClassName="hidden" ariaLabel={gapLabel} min={0} max={40} editable unit="px"
          value={appearanceDraft.imageListGap} onChange={(value) => onPatchAppearance({ imageListGap: Math.round(value) })} />
      </SettingRow>

      <SettingRow label={<ChatFilledLabel fieldId="appearance.imageTileRadius">{radiusLabel}</ChatFilledLabel>} controlWidth="standard">
        <Select
          variant="settings"
          aria-label={radiusLabel}
          value={appearanceDraft.imageTileRadius}
          onChange={(event) => onPatchAppearance({ imageTileRadius: event.target.value as AppearanceSettings['imageTileRadius'] })}
        >
          {IMAGE_TILE_RADIUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </Select>
      </SettingRow>

      <SettingRow label={<ChatFilledLabel fieldId="appearance.imageHoverEffect">{hoverLabel}</ChatFilledLabel>} controlWidth="standard">
        <Select
          variant="settings"
          aria-label={hoverLabel}
          value={appearanceDraft.imageHoverEffect}
          onChange={(event) => onPatchAppearance({ imageHoverEffect: event.target.value as AppearanceSettings['imageHoverEffect'] })}
        >
          {IMAGE_HOVER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </Select>
      </SettingRow>

      <SettingRow label={<ChatFilledLabel fieldId="appearance.sensitiveBlurPx">{blurLabel}</ChatFilledLabel>} controlWidth="standard">
        <SliderRow className="w-full" label={null} labelClassName="hidden" ariaLabel={blurLabel} min={8} max={64} editable unit="px"
          value={appearanceDraft.sensitiveBlurPx} onChange={(value) => onPatchAppearance({ sensitiveBlurPx: Math.round(value) })} />
      </SettingRow>

      <SettingsSwitchRow
        label={<ChatFilledLabel fieldId="appearance.reduceMotion">{t({ ko: '애니메이션 줄이기', en: 'Reduce motion' })}</ChatFilledLabel>}
        checked={appearanceDraft.reduceMotion}
        onCheckedChange={(reduceMotion) => onPatchAppearance({ reduceMotion })}
      />
    </>
  )
}
