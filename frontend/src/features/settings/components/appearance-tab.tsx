import { useRef, useState } from 'react'
import { Check, Download, Eye, Images, Pencil, RotateCcw, Undo2, Upload } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { SettingRow } from '@/components/ui/setting-row'
import { APP_ICON_SRC } from '@/lib/app-metadata'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { AppIconEditor } from './app-icon-editor'
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
  onUploadAppIcon,
  onSelectLibraryAppIcon,
  appIconSource,
  onEditAppIcon,
  onCloseAppIconEditor,
  onRegisterAppIcon,
  onResetAppIcon,
  isSavingAppIcon,
  isLoadingAppIcon,
  isSaving,
  isUploadingFont,
}: AppearanceTabProps) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const [appIconPickerOpen, setAppIconPickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sansFontInputRef = useRef<HTMLInputElement | null>(null)
  const monoFontInputRef = useRef<HTMLInputElement | null>(null)
  const appIconInputRef = useRef<HTMLInputElement | null>(null)
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
    <div className="space-y-8">
      <input
        ref={appIconInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onUploadAppIcon(file).catch(() => {})
          event.target.value = ''
        }}
      />
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
        <div
          role="status"
          aria-label={t({ ko: '가져온 테마 미리보기 중', en: 'Previewing an imported theme' })}
          className="flex items-center justify-between gap-3 rounded-sm bg-primary/12 py-2 pr-2 pl-4"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Eye className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 truncate text-sm text-foreground">{importPreviewFileName}</div>
          </div>
          <div className="flex shrink-0 gap-1">
            <IconButton size="icon-sm" variant="secondary" onClick={onRevertImportPreview} label={t({ ko: '미리보기 되돌리기', en: 'Revert the preview' })}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            <IconButton size="icon-sm" onClick={onApplyImportPreview} label={t({ ko: '가져온 테마 적용', en: 'Apply the imported theme' })}>
              <Check className="h-4 w-4" />
            </IconButton>
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
            <SettingRow
              label={t({ ko: '앱 마크', en: 'App mark' })}
              info={t({ ko: 'PC 파일이나 내부 이미지를 골라 편집한 뒤 등록해줘. 20MB 이하의 PNG, JPG, WebP, GIF, AVIF를 지원하고 투명 배경을 유지해. 등록하면 모든 사용자의 상단 마크에 바로 적용돼. 움직이는 이미지는 한 장으로 저장돼.', en: 'Choose a local file or an app library image, edit it, and register it. PNG, JPG, WebP, GIF, and AVIF up to 20 MB are supported, with transparency preserved. Registration applies the mark to everyone immediately. Animated images are saved as a still image.' })}
            >
              <img
                src={editorProps.appearanceDraft.appIconDataUrl || APP_ICON_SRC}
                alt={t({ ko: '앱 마크 미리보기', en: 'App mark preview' })}
                className="bg-checker size-12 shrink-0 rounded-sm object-contain"
                draggable={false}
              />
              <Button type="button" size="sm" variant="secondary" onClick={() => appIconInputRef.current?.click()} disabled={isSaving || isLoadingAppIcon}>
                <Upload className="size-4" aria-hidden />
                {isLoadingAppIcon ? t({ ko: '불러오는 중', en: 'Loading' }) : t({ ko: 'PC에서 선택', en: 'Choose local file' })}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setAppIconPickerOpen(true)} disabled={isSaving || isLoadingAppIcon || !canViewImages}>
                <Images className="size-4" aria-hidden />
                {t({ ko: '내부 이미지', en: 'App library' })}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onEditAppIcon} disabled={isSaving || isLoadingAppIcon}>
                <Pencil className="size-4" aria-hidden />
                {t({ ko: '편집', en: 'Edit' })}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void onResetAppIcon().catch(() => {})} disabled={isSaving || isLoadingAppIcon || !editorProps.appearanceDraft.appIconDataUrl}>
                <RotateCcw className="size-4" aria-hidden />
                {t({ ko: '기본 마크', en: 'Default mark' })}
              </Button>
            </SettingRow>
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
      {appIconPickerOpen ? (
        <ChatMediaPicker
          initial={[]}
          maxCount={1}
          imagesOnly
          title={t({ ko: '앱 마크로 쓸 내부 이미지', en: 'Choose an app library image for the mark' })}
          applyLabel={t({ ko: '선택', en: 'Select' })}
          note={null}
          onClose={() => setAppIconPickerOpen(false)}
          onPick={(items) => {
            if (isSaving || isLoadingAppIcon || !canViewImages) return
            setAppIconPickerOpen(false)
            if (items[0]) void onSelectLibraryAppIcon(items[0].compositeHash).catch(() => {})
          }}
        />
      ) : null}
      {appIconSource ? <AppIconEditor key={appIconSource.id} source={appIconSource} isSaving={isSavingAppIcon} onRegister={onRegisterAppIcon} onClose={onCloseAppIconEditor} /> : null}
    </div>
  )
}
