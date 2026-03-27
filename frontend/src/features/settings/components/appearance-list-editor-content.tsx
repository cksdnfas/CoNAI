import { Select } from '@/components/ui/select'
import type { AppearanceSettings } from '@/types/settings'
import {
  type AppearanceTabEditorSectionProps,
  EditorSectionLead,
  getRelatedImageAspectRatioLabel,
  RelatedImageColumnSlider,
} from './appearance-tab-editor-shared'
import { SettingsField } from './settings-primitives'

/** Render the list-oriented appearance controls for related image cards. */
export function AppearanceListEditorContent({
  appearanceDraft,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title="유사 / 중복 이미지" />
        <div className="grid gap-4 lg:grid-cols-2">
          <RelatedImageColumnSlider
            label="모바일 한 줄 카드 수"
            value={appearanceDraft.detailRelatedImageMobileColumns}
            onChange={(value) => onPatchAppearance({ detailRelatedImageMobileColumns: value })}
          />

          <RelatedImageColumnSlider
            label="데스크톱 한 줄 카드 수"
            value={appearanceDraft.detailRelatedImageColumns}
            onChange={(value) => onPatchAppearance({ detailRelatedImageColumns: value })}
          />

          <SettingsField label="카드 비율">
            <Select
              variant="settings"
              value={appearanceDraft.detailRelatedImageAspectRatio}
              onChange={(event) => onPatchAppearance({ detailRelatedImageAspectRatio: event.target.value as AppearanceSettings['detailRelatedImageAspectRatio'] })}
            >
              {(['original', 'square', 'portrait', 'landscape'] as AppearanceSettings['detailRelatedImageAspectRatio'][]).map((ratio) => (
                <option key={ratio} value={ratio}>
                  {getRelatedImageAspectRatioLabel(ratio)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>
    </div>
  )
}
