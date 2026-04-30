import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  updateAppearanceSettings,
  uploadAppearanceFont,
} from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS, applyAppearanceTheme, extractAppearanceTheme } from '@/lib/appearance'
import { buildAppearancePackage, restoreAppearancePackage } from '@/lib/appearance-package'
import type { AppearanceTabProps } from './components/appearance-tab.types'
import type { AppearancePresetSlot, AppearanceSettings } from '@/types/settings'
import { useI18n } from '@/i18n'

interface UseAppearanceSettingsTabOptions {
  /** Whether the appearance tab is currently active. */
  isActive: boolean
  /** Current saved-or-loaded appearance settings. */
  currentAppearance: AppearanceSettings | null | undefined
  /** Saved appearance settings used as the stable baseline. */
  savedAppearance: AppearanceSettings
  /** Sync the updated app settings into the shared query cache. */
  syncSettingsCache: (nextSettings: Awaited<ReturnType<typeof updateAppearanceSettings>>) => void
  /** Show a success/info snackbar for appearance actions. */
  notifyInfo: (message: string) => void
  /** Show an error snackbar for appearance actions. */
  notifyError: (message: string) => void
}

/** Keep appearance preset labels searchable and backend-safe before save. */
function normalizeAppearancePresetSlots(presetSlots: AppearancePresetSlot[]) {
  return presetSlots.map((slot, index) => ({
    ...slot,
    label: slot.label.trim() || `Slot ${index + 1}`,
  }))
}

/** Collect appearance-tab draft state, preview behavior, and save flows. */
export function useAppearanceSettingsTab({
  isActive,
  currentAppearance,
  savedAppearance,
  syncSettingsCache,
  notifyInfo,
  notifyError,
}: UseAppearanceSettingsTabOptions): { tabProps: AppearanceTabProps } {
  const { t } = useI18n()
  const [appearanceDraft, setAppearanceDraft] = useState<AppearanceSettings | null>(null)
  const effectiveAppearanceDraft = appearanceDraft ?? currentAppearance ?? null

  useEffect(() => {
    if (isActive) {
      applyAppearanceTheme(effectiveAppearanceDraft ?? savedAppearance)
      return
    }

    applyAppearanceTheme(savedAppearance)
  }, [effectiveAppearanceDraft, isActive, savedAppearance])

  const appearanceMutation = useMutation({
    mutationFn: updateAppearanceSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setAppearanceDraft(settings.appearance)
      notifyInfo(t({ ko: '화면 설정을 저장했어.', en: 'Appearance settings saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '화면 설정 저장에 실패했어.', en: 'Failed to save appearance settings.' }))
    },
  })

  const appearancePresetSlotsMutation = useMutation({
    mutationFn: (presetSlots: AppearancePresetSlot[]) => updateAppearanceSettings({ presetSlots }),
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setAppearanceDraft((draft) =>
        draft
          ? { ...draft, presetSlots: settings.appearance.presetSlots }
          : settings.appearance,
      )
      notifyInfo(t({ ko: '테마 슬롯을 저장했어.', en: 'Theme slots saved.' }))
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '테마 슬롯 저장에 실패했어.', en: 'Failed to save theme slots.' }))
    },
  })

  const appearanceFontUploadMutation = useMutation({
    mutationFn: ({ file, target }: { file: File; target: 'sans' | 'mono' }) => uploadAppearanceFont(file, target),
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : t({ ko: '커스텀 폰트 업로드에 실패했어.', en: 'Failed to upload custom font.' }))
    },
  })

  const patchAppearanceDraft = (patch: Partial<AppearanceSettings>) => {
    if (!effectiveAppearanceDraft) return
    setAppearanceDraft({ ...effectiveAppearanceDraft, ...patch })
  }

  const isDirty =
    JSON.stringify(effectiveAppearanceDraft ?? savedAppearance) !== JSON.stringify(savedAppearance)

  const handleAppearanceReset = () => {
    setAppearanceDraft((draft) => ({
      ...DEFAULT_APPEARANCE_SETTINGS,
      presetSlots: draft?.presetSlots ?? savedAppearance.presetSlots,
    }))
  }

  const handleAppearanceCancel = () => {
    setAppearanceDraft(savedAppearance)
    applyAppearanceTheme(savedAppearance)
  }

  const handleAppearanceSave = () => {
    if (!effectiveAppearanceDraft) return
    void appearanceMutation.mutateAsync(extractAppearanceTheme(effectiveAppearanceDraft))
  }

  const handleAppearanceExport = async () => {
    try {
      const appearanceToExport = {
        ...(effectiveAppearanceDraft ?? savedAppearance),
        presetSlots: normalizeAppearancePresetSlots((effectiveAppearanceDraft ?? savedAppearance).presetSlots),
      }
      const packageDocument = await buildAppearancePackage(appearanceToExport)
      const blob = new Blob([JSON.stringify(packageDocument, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `conai-appearance-package-${appearanceToExport.accentPreset}-${appearanceToExport.themeMode}.json`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      notifyInfo(t({ ko: '현재 테마와 연결된 폰트 자산까지 패키지로 내보냈어.', en: 'Exported a package including the current theme and linked font assets.' }))
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t({ ko: '화면 설정 패키지를 내보내지 못했어.', en: 'Failed to export the appearance package.' }))
    }
  }

  const handleAppearanceImport = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const importedAppearance = await restoreAppearancePackage(raw, savedAppearance, uploadAppearanceFont)

      if (!importedAppearance) {
        throw new Error(t({ ko: 'Appearance JSON 구조를 확인하지 못했어.', en: 'Could not verify the Appearance JSON structure.' }))
      }

      await appearanceMutation.mutateAsync(importedAppearance)
      notifyInfo(t({ ko: '화면 설정 패키지를 불러와 저장했어.', en: 'Imported and saved the appearance package.' }))
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t({ ko: '화면 설정 파일을 불러오지 못했어.', en: 'Failed to load the appearance settings file.' }))
    }
  }

  const handleAppearancePresetSlotsSave = (presetSlots: AppearancePresetSlot[]) => {
    const normalizedPresetSlots = normalizeAppearancePresetSlots(presetSlots)
    setAppearanceDraft((draft) => (draft ? { ...draft, presetSlots: normalizedPresetSlots } : draft))
    void appearancePresetSlotsMutation.mutateAsync(normalizedPresetSlots)
  }

  const handleAppearanceFontUpload = async (target: 'sans' | 'mono', file: File) => {
    const uploaded = await appearanceFontUploadMutation.mutateAsync({ file, target })

    setAppearanceDraft((draft) => {
      const base = draft ?? savedAppearance
      const next = { ...base, fontPreset: 'custom' as const }

      if (target === 'sans') {
        next.customFontUrl = uploaded.url
        next.customFontFileName = uploaded.originalName
      } else {
        next.customMonoFontUrl = uploaded.url
        next.customMonoFontFileName = uploaded.originalName
      }

      return next
    })

    notifyInfo(t({ ko: '{targetLabel} 커스텀 폰트를 업로드했어. 저장하면 기본 테마에 반영돼.', en: 'Uploaded the {targetLabel} custom font. Save to apply it to the default theme.' }, { targetLabel: target === 'sans' ? t({ ko: '본문', en: 'body' }) : t({ ko: '모노', en: 'mono' }) }))
  }

  const handleAppearanceFontClear = (target: 'sans' | 'mono') => {
    setAppearanceDraft((draft) => {
      const base = draft ?? savedAppearance
      const next = { ...base }

      if (target === 'sans') {
        next.customFontUrl = ''
        next.customFontFileName = ''
      } else {
        next.customMonoFontUrl = ''
        next.customMonoFontFileName = ''
      }

      return next
    })

    notifyInfo(t({ ko: '{targetLabel} 업로드 폰트를 draft에서 해제했어. 저장하면 반영돼.', en: 'Cleared the {targetLabel} uploaded font from the draft. Save to apply.' }, { targetLabel: target === 'sans' ? t({ ko: '본문', en: 'body' }) : t({ ko: '모노', en: 'mono' }) }))
  }

  return {
    tabProps: {
      appearanceDraft: effectiveAppearanceDraft,
      savedAppearance,
      isDirty,
      onPatchAppearance: patchAppearanceDraft,
      onReset: handleAppearanceReset,
      onCancel: handleAppearanceCancel,
      onSave: handleAppearanceSave,
      onExport: handleAppearanceExport,
      onImport: handleAppearanceImport,
      onSavePresetSlots: handleAppearancePresetSlotsSave,
      onUploadCustomFont: handleAppearanceFontUpload,
      onClearCustomFont: handleAppearanceFontClear,
      isSaving: appearanceMutation.isPending || appearancePresetSlotsMutation.isPending,
      isUploadingFont: appearanceFontUploadMutation.isPending,
    },
  }
}
