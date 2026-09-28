import { useRef } from 'react'
import { Check, Download, Eye, RotateCcw, Undo2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InstantApplyHint, SectionDirtyBadge } from './settings-section-status'
import { AppearanceBadgeColorRows, AppearanceThemeRows } from './appearance-color-editor-content'
import { AppearanceFinishRows, AppearanceFontRows } from './appearance-general-editor-content'
import { AppearanceListRows } from './appearance-list-editor-content'
import { SettingsRowsSkeleton } from './settings-rows'
import { AppearanceTabSlotSection } from './appearance-tab-slot-section'
import type { AppearanceTabProps } from './appearance-tab.types'
import { getAppearanceTabColorValues } from './appearance-tab.utils'
import { RowGroup } from '@/components/ui/row-group'
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
  const editorProps = appearanceDraft ? {
    appearanceDraft,
    colorValues,
    onPatchAppearance,
    onRequestSansFontUpload: () => sansFontInputRef.current?.click(),
    onRequestMonoFontUpload: () => monoFontInputRef.current?.click(),
    onClearCustomFont,
    isUploadingFont,
  } : null

  return (
    <div className="space-y-10">
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
              <div className="truncate text-xs text-muted-foreground">{importPreviewFileName}</div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <IconButton size="icon-sm" variant="secondary" onClick={onRevertImportPreview} label={t({ ko: '되돌리기', en: 'Revert' })}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            <Button type="button" size="sm" onClick={onApplyImportPreview}>
              <Check className="h-4 w-4" />
              {t({ ko: '적용', en: 'Apply' })}
            </Button>
          </div>
        </div>
      ) : null}

      {editorProps ? (
        <>
          <RowGroup
            heading={t({ ko: '테마', en: 'Theme' })}
            actions={(
              <>
                <SectionDirtyBadge dirty={isDirty} />
                <IconButton size="icon-sm" variant="ghost" onClick={onExport} disabled={isSaving} label={t({ ko: '외형 내보내기', en: 'Export appearance' })}>
                  <Download className="h-4 w-4" />
                </IconButton>
                <IconButton size="icon-sm" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={isSaving || importPreviewFileName !== null} label={t({ ko: '외형 가져오기 (미리보기 후 적용)', en: 'Import appearance (preview first)' })}>
                  <Upload className="h-4 w-4" />
                </IconButton>
                <IconButton size="icon-sm" variant="ghost" onClick={onReset} disabled={isSaving} label={t({ ko: '기본값으로 되돌리기', en: 'Restore defaults' })}>
                  <RotateCcw className="h-4 w-4" />
                </IconButton>
              </>
            )}
          >
            <AppearanceThemeRows {...editorProps} />
          </RowGroup>

          <RowGroup heading={t({ ko: '글꼴', en: 'Font' })}>
            <AppearanceFontRows {...editorProps} />
          </RowGroup>

          <RowGroup heading={t({ ko: '레이아웃 및 마감', en: 'Layout and finish' })}>
            <AppearanceFinishRows {...editorProps} />
          </RowGroup>

          <RowGroup heading={t({ ko: '목록 및 카드', en: 'Lists and cards' })}>
            <AppearanceListRows {...editorProps} />
          </RowGroup>

          <RowGroup heading={t({ ko: '배지 색상', en: 'Badge colors' })}>
            <AppearanceBadgeColorRows {...editorProps} />
          </RowGroup>

          <RowGroup heading={t({ ko: '테마 슬롯', en: 'Theme slots' })} actions={<InstantApplyHint />}>
            <AppearanceTabSlotSection
              appearanceDraft={editorProps.appearanceDraft}
              savedAppearance={savedAppearance}
              isSaving={isSaving}
              onPatchAppearance={onPatchAppearance}
              onSavePresetSlots={onSavePresetSlots}
            />
          </RowGroup>
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </div>
  )
}
