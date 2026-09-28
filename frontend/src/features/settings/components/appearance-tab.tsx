import { useRef } from 'react'
import { Check, Download, Eye, RotateCcw, Undo2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InstantApplyHint, SectionDirtyBadge } from './settings-section-status'
import { AppearanceTabEditorSection } from './appearance-tab-editor-section'
import { AppearanceTabSlotSection } from './appearance-tab-slot-section'
import type { AppearanceTabProps } from './appearance-tab.types'
import { getAppearanceTabColorValues } from './appearance-tab.utils'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'

export function AppearanceTab({
  appearanceDraft,
  savedAppearance,
  isDirty,
  onPatchAppearance,
  onReset,
  onExport,
  onImport,
  importPreviewFileName,
  onApplyImportPreview,
  onRevertImportPreview,
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

      {importPreviewFileName ? (
        <div role="status" className="flex flex-col gap-3 rounded-sm bg-primary/12 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 space-y-0.5">
              <div className="text-sm font-semibold text-foreground">{t({ ko: '가져온 테마 미리보기 중', en: 'Previewing an imported theme' })}</div>
              <div className="truncate text-xs text-muted-foreground">
                {t({ ko: '{file} — 지금 화면은 미리보기야. 적용하면 초안에 들어가고, 되돌리면 원래대로 돌아가.', en: '{file} — this is a preview. Apply puts it into the draft; Revert restores the previous look.' }, { file: importPreviewFileName })}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onRevertImportPreview}>
              <Undo2 className="h-4 w-4" />
              {t({ ko: '되돌리기', en: 'Revert' })}
            </Button>
            <Button type="button" size="sm" onClick={onApplyImportPreview}>
              <Check className="h-4 w-4" />
              {t({ ko: '적용', en: 'Apply' })}
            </Button>
          </div>
        </div>
      ) : null}

      <section>
        <Section
          variant="settings"
          heading={t({ ko: '테마 슬롯', en: 'Theme slots' })}
          description={(
            <span className="inline-flex flex-wrap items-center gap-2">
              {t({ ko: '슬롯 저장·덮어쓰기는 바로 반영돼. 불러오기와 슬롯 이름은 아래 저장 바로 저장해.', en: 'Saving or overwriting a slot is immediate. Loading a slot and renaming go through the save bar.' })}
              <InstantApplyHint />
            </span>
          )}
          actions={
            <>
              <SectionDirtyBadge dirty={isDirty} />
              <IconButton size="icon-sm" variant="outline" onClick={onExport} disabled={isSaving} label={t({ ko: '외형 내보내기', en: 'Export appearance' })}>
                <Download className="h-4 w-4" />
              </IconButton>
              <IconButton size="icon-sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSaving || importPreviewFileName !== null} label={t({ ko: '외형 가져오기 (미리보기 후 적용)', en: 'Import appearance (preview first)' })}>
                <Upload className="h-4 w-4" />
              </IconButton>
              <IconButton size="icon-sm" variant="outline" onClick={onReset} disabled={!appearanceDraft || isSaving} label={t({ ko: '기본값으로 되돌리기', en: 'Restore defaults' })}>
                <RotateCcw className="h-4 w-4" />
              </IconButton>
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
        </Section>
      </section>

      <section>
        <Section variant="settings" heading={t({ ko: '세부 편집', en: 'Detailed editor' })}>
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
        </Section>
      </section>
    </div>
  )
}
