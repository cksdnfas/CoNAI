import { useRef } from 'react'
import { Download, RotateCcw, Save, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppearanceTabEditorSection } from './appearance-tab-editor-section'
import { AppearanceTabSlotSection } from './appearance-tab-slot-section'
import type { AppearanceTabProps } from './appearance-tab.types'
import { getAppearanceTabColorValues } from './appearance-tab.utils'
import { SettingsSection } from './settings-primitives'
import { useI18n } from '@/i18n'

export function AppearanceTab({
  appearanceDraft,
  savedAppearance,
  isDirty,
  onPatchAppearance,
  onReset,
  onCancel,
  onSave,
  onExport,
  onImport,
  onSavePresetSlots,
  onUploadCustomFont,
  onClearCustomFont,
  isSaving,
  isUploadingFont,
}: AppearanceTabProps) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sansFontInputRef = useRef<HTMLInputElement | null>(null)
  const monoFontInputRef = useRef<HTMLInputElement | null>(null)
  const colorValues = getAppearanceTabColorValues(appearanceDraft)

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void onImport(file)
          }
          event.target.value = ''
        }}
      />
      <input
        ref={sansFontInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void onUploadCustomFont('sans', file)
          }
          event.target.value = ''
        }}
      />
      <input
        ref={monoFontInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void onUploadCustomFont('mono', file)
          }
          event.target.value = ''
        }}
      />

      <section>
        <SettingsSection
          heading={t({ ko: '테마 슬롯', en: 'Theme slots' })}
          actions={
            <>
              <Button type="button" size="icon-sm" variant="outline" onClick={onExport} disabled={isSaving} aria-label={t({ ko: '외형 내보내기', en: 'Export appearance' })} title={t({ ko: '외형 내보내기', en: 'Export appearance' })}>
                <Download className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSaving} aria-label={t({ ko: '외형 가져오기', en: 'Import appearance' })} title={t({ ko: '외형 가져오기', en: 'Import appearance' })}>
                <Upload className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" onClick={onReset} disabled={!appearanceDraft || isSaving} aria-label={t({ ko: '기본값으로 되돌리기', en: 'Restore defaults' })} title={t({ ko: '기본값으로 되돌리기', en: 'Restore defaults' })}>
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" onClick={onCancel} disabled={!isDirty || isSaving} aria-label={t({ ko: '변경 취소', en: 'Cancel changes' })} title={t({ ko: '변경 취소', en: 'Cancel changes' })}>
                <X className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" onClick={onSave} disabled={!appearanceDraft || !isDirty || isSaving} aria-label={t({ ko: '외형 저장', en: 'Save appearance' })} title={t({ ko: '외형 저장', en: 'Save appearance' })}>
                <Save className="h-4 w-4" />
              </Button>
            </>
          }
        >
          {appearanceDraft ? (
            <AppearanceTabSlotSection
              appearanceDraft={appearanceDraft}
              savedAppearance={savedAppearance}
              isSaving={isSaving}
              onPatchAppearance={onPatchAppearance}
              onSavePresetSlots={onSavePresetSlots}
            />
          ) : null}
        </SettingsSection>
      </section>

      <section>
        <SettingsSection heading={t({ ko: '세부 편집', en: 'Detailed editor' })}>
          {appearanceDraft ? (
            <AppearanceTabEditorSection
              appearanceDraft={appearanceDraft}
              colorValues={colorValues}
              onPatchAppearance={onPatchAppearance}
              onRequestSansFontUpload={() => sansFontInputRef.current?.click()}
              onRequestMonoFontUpload={() => monoFontInputRef.current?.click()}
              onClearCustomFont={onClearCustomFont}
              isUploadingFont={isUploadingFont}
            />
          ) : null}
        </SettingsSection>
      </section>
    </div>
  )
}
