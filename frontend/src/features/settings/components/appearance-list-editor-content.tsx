import { Select } from '@/components/ui/select'
import type { AppearanceSettings } from '@conai/shared'
import {
  type AppearanceTabEditorSectionProps,
  EditorSectionLead,
  getGroupExplorerCardStyleLabel,
  getRelatedImageAspectRatioLabel,
  RelatedImageColumnSlider,
} from './appearance-tab-editor-shared'
import { SettingsField } from './settings-primitives'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

/** Render the list-oriented appearance controls for related image cards. */
export function AppearanceListEditorContent({
  appearanceDraft,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '그룹 탐색 목록', en: 'Group browser list' })} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SettingsField label={t({ ko: '그룹 카드 스타일', en: 'Group card style' })}>
            <Select
              variant="settings"
              value={appearanceDraft.groupExplorerCardStyle}
              onChange={(event) => onPatchAppearance({ groupExplorerCardStyle: event.target.value as AppearanceSettings['groupExplorerCardStyle'] })}
            >
              {(['compact-row', 'media-tile'] as AppearanceSettings['groupExplorerCardStyle'][]).map((style) => (
                <option key={style} value={style}>
                  {getGroupExplorerCardStyleLabel(style, t)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '상세페이지 유사 / 중복 이미지', en: 'Detail page similar / duplicate images' })} />
        <div className="grid gap-4 lg:grid-cols-2">
          <RelatedImageColumnSlider
            label={t({ ko: '모바일 한 줄 카드 수', en: 'Cards per row on mobile' })}
            value={appearanceDraft.detailRelatedImageMobileColumns}
            onChange={(value) => onPatchAppearance({ detailRelatedImageMobileColumns: value })}
          />

          <RelatedImageColumnSlider
            label={t({ ko: '데스크톱 한 줄 카드 수', en: 'Cards per row on desktop' })}
            value={appearanceDraft.detailRelatedImageColumns}
            onChange={(value) => onPatchAppearance({ detailRelatedImageColumns: value })}
          />

          <SettingsField label={t({ ko: '카드 비율', en: 'Card ratio' })}>
            <Select
              variant="settings"
              value={appearanceDraft.detailRelatedImageAspectRatio}
              onChange={(event) => onPatchAppearance({ detailRelatedImageAspectRatio: event.target.value as AppearanceSettings['detailRelatedImageAspectRatio'] })}
            >
              {(['original', 'square', 'portrait', 'landscape'] as AppearanceSettings['detailRelatedImageAspectRatio'][]).map((ratio) => (
                <option key={ratio} value={ratio}>
                  {getRelatedImageAspectRatioLabel(ratio, t)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '선택 표시', en: 'Selection indicator' })} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SettingsField label={t({ ko: '선택 테두리 두께 (px)', en: 'Selection border width (px)' })}>
            <NumberStepperInput

              min={1}
              max={8}
              step={1}
              variant="settings"
              value={appearanceDraft.selectionOutlineWidth}
              onValueCommit={(nextValue) => onPatchAppearance({ selectionOutlineWidth: Number.parseInt(nextValue || '3', 10) })}
            />
          </SettingsField>
        </div>
      </section>
    </div>
  )
}
