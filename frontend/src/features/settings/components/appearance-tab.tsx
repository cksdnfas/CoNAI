import { useRef } from 'react'
import { Download, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAppearanceContrastIssues, resolveAppearanceColors, resolveSurfacePalette } from '@/lib/appearance'
import { AppearanceTabEditorSection } from './appearance-tab-editor-section'
import { AppearanceTabPreviewSection } from './appearance-tab-preview-section'
import { AppearanceTabSlotSection } from './appearance-tab-slot-section'
import type { AppearanceTabProps } from './appearance-tab.types'
import { areThemesEqual, getAppearanceTabColorValues } from './appearance-tab.utils'

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
  isSaving,
  isUploadingFont,
}: AppearanceTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sansFontInputRef = useRef<HTMLInputElement | null>(null)
  const monoFontInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedColors = appearanceDraft ? resolveAppearanceColors(appearanceDraft) : null
  const resolvedSurface = appearanceDraft ? resolveSurfacePalette(appearanceDraft) : null
  const contrastIssues = appearanceDraft ? getAppearanceContrastIssues(appearanceDraft) : []
  const colorValues = getAppearanceTabColorValues(appearanceDraft)
  const savedThemeMatchesDraft = areThemesEqual(appearanceDraft, savedAppearance)

  return (
    <div className="space-y-8">
      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Appearance</CardTitle>
              <CardDescription>앱 전체 테마의 색감, 표면 무드, 밀도, 마감값을 조정하고 JSON으로 가져오거나 내보낼 수 있어.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onExport} disabled={isSaving}>
                <Download className="h-4 w-4" />
                내보내기
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSaving}>
                <Upload className="h-4 w-4" />
                가져오기
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onReset} disabled={!appearanceDraft || isSaving}>
                <RotateCcw className="h-4 w-4" />
                기본값
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={!isDirty || isSaving}>
                <X className="h-4 w-4" />
                취소
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={!appearanceDraft || !isDirty || isSaving}>
                <Sparkles className="h-4 w-4" />
                저장
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
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

          {appearanceDraft && resolvedColors && resolvedSurface ? (
            <>
              <AppearanceTabPreviewSection
                appearanceDraft={appearanceDraft}
                savedAppearance={savedAppearance}
                isDirty={isDirty}
                contrastIssues={contrastIssues}
                resolvedColors={resolvedColors}
                resolvedSurface={resolvedSurface}
              />

              <AppearanceTabSlotSection
                appearanceDraft={appearanceDraft}
                savedAppearance={savedAppearance}
                savedThemeMatchesDraft={savedThemeMatchesDraft}
                isSaving={isSaving}
                onPatchAppearance={onPatchAppearance}
                onSavePresetSlots={onSavePresetSlots}
              />

              <AppearanceTabEditorSection
                appearanceDraft={appearanceDraft}
                colorValues={colorValues}
                onPatchAppearance={onPatchAppearance}
                onRequestSansFontUpload={() => sansFontInputRef.current?.click()}
                onRequestMonoFontUpload={() => monoFontInputRef.current?.click()}
                isUploadingFont={isUploadingFont}
              />
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
