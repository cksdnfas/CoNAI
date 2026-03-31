import { useRef } from 'react'
import { Download, RotateCcw, Save, Upload, X } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AppearanceTabEditorSection } from './appearance-tab-editor-section'
import { AppearanceTabSlotSection } from './appearance-tab-slot-section'
import type { AppearanceTabProps } from './appearance-tab.types'
import { getAppearanceTabColorValues } from './appearance-tab.utils'

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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sansFontInputRef = useRef<HTMLInputElement | null>(null)
  const monoFontInputRef = useRef<HTMLInputElement | null>(null)
  const colorValues = getAppearanceTabColorValues(appearanceDraft)

  return (
    <div className="space-y-8">
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
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading="테마 슬롯"
              actions={
                <>
                  <Button type="button" size="icon-sm" variant="outline" onClick={onExport} disabled={isSaving} aria-label="외형 내보내기" title="외형 내보내기">
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSaving} aria-label="외형 가져오기" title="외형 가져오기">
                    <Upload className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="outline" onClick={onReset} disabled={!appearanceDraft || isSaving} aria-label="기본값으로 되돌리기" title="기본값으로 되돌리기">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="outline" onClick={onCancel} disabled={!isDirty || isSaving} aria-label="변경 취소" title="변경 취소">
                    <X className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" onClick={onSave} disabled={!appearanceDraft || !isDirty || isSaving} aria-label="외형 저장" title="외형 저장">
                    <Save className="h-4 w-4" />
                  </Button>
                </>
              }
            />
            {appearanceDraft ? (
              <AppearanceTabSlotSection
                appearanceDraft={appearanceDraft}
                savedAppearance={savedAppearance}
                isSaving={isSaving}
                onPatchAppearance={onPatchAppearance}
                onSavePresetSlots={onSavePresetSlots}
              />
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading variant="inside" heading="세부 편집" />
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
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
