import { useSettingsRevision } from './use-settings-revision'
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { updateAppearanceSettings, uploadAppearanceFont } from '@/lib/api-settings-appearance'
import { buildApiUrl } from '@/lib/api-client'
import { APP_ICON_SRC } from '@/lib/app-metadata'
import { DEFAULT_APPEARANCE_SETTINGS, applyAppearanceTheme, extractAppearanceTheme } from '@/lib/appearance'
import { buildAppearancePackage, restoreAppearancePackage } from '@/lib/appearance-package'
import type { AppIconSource, AppearanceTabProps } from './components/appearance-tab.types'
import type { AppearancePresetSlot, AppearanceSettings } from '@conai/shared'
import { useI18n } from '@/i18n'
import { areSettingsDraftsEqual, type SettingsDraftSection } from './settings-draft-sections'

interface UseAppearanceSettingsTabOptions {
  revision?: string
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
  revision,
  isActive,
  currentAppearance,
  savedAppearance,
  syncSettingsCache,
  notifyInfo,
  notifyError,
}: UseAppearanceSettingsTabOptions): { tabProps: AppearanceTabProps; draftSection: SettingsDraftSection } {
  const { t } = useI18n()
  const [appearanceDraft, setAppearanceDraft] = useState<AppearanceSettings | null>(null)
  const [isLoadingAppIcon, setIsLoadingAppIcon] = useState(false)
  const [appIconSource, setAppIconSource] = useState<AppIconSource | null>(null)
  const appIconRequestRef = useRef<AbortController | null>(null)
  const appIconRevisionRef = useRef(0)
  // An imported package is only previewed on the live theme until the user applies or reverts it.
  const [importPreview, setImportPreview] = useState<{ appearance: AppearanceSettings; fileName: string } | null>(null)
  const effectiveAppearanceDraft = appearanceDraft ?? currentAppearance ?? null

  useEffect(() => () => {
    appIconRevisionRef.current += 1
    appIconRequestRef.current?.abort()
  }, [])

  useEffect(() => () => {
    if (appIconSource?.url.startsWith('blob:')) URL.revokeObjectURL(appIconSource.url)
  }, [appIconSource])

  const appIconMutation = useMutation({
    mutationFn: (appIconDataUrl: string) => updateAppearanceSettings({ appIconDataUrl }),
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      // Registering the mark must preserve any other unsaved theme edits.
      setAppearanceDraft((draft) => draft ? { ...draft, appIconDataUrl: settings.appearance.appIconDataUrl } : settings.appearance)
      setAppIconSource(null)
      notifyInfo(settings.appearance.appIconDataUrl
        ? t({ ko: '앱 마크를 등록했어.', en: 'App mark registered.' })
        : t({ ko: '기본 앱 마크로 되돌렸어.', en: 'Restored the default app mark.' }))
    },
  })

  useEffect(() => {
    if (isActive) {
      applyAppearanceTheme(importPreview?.appearance ?? effectiveAppearanceDraft ?? savedAppearance)
      return
    }

    applyAppearanceTheme(savedAppearance)
  }, [effectiveAppearanceDraft, importPreview, isActive, savedAppearance])

  const draftRevision = useSettingsRevision(revision, Boolean(effectiveAppearanceDraft && currentAppearance && !areSettingsDraftsEqual(effectiveAppearanceDraft, currentAppearance)))

  const appearanceMutation = useMutation({
    mutationFn: (patch: Partial<AppearanceSettings>) => updateAppearanceSettings(patch, draftRevision()),
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setAppearanceDraft(settings.appearance)
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

  const isDirty = !areSettingsDraftsEqual(effectiveAppearanceDraft ?? savedAppearance, savedAppearance)

  const handleAppearanceReset = () => {
    setAppearanceDraft((draft) => ({
      ...DEFAULT_APPEARANCE_SETTINGS,
      presetSlots: draft?.presetSlots ?? savedAppearance.presetSlots,
    }))
  }

  const handleAppearanceCancel = () => {
    setAppearanceDraft(savedAppearance)
    setImportPreview(null)
    applyAppearanceTheme(savedAppearance)
  }

  const handleAppearanceSave = async () => {
    if (!effectiveAppearanceDraft) return
    // Slot names are edited in the draft too, so send them along when they changed.
    const presetSlots = normalizeAppearancePresetSlots(effectiveAppearanceDraft.presetSlots)
    await appearanceMutation.mutateAsync({
      ...extractAppearanceTheme(effectiveAppearanceDraft),
      ...(effectiveAppearanceDraft.appIconDataUrl === savedAppearance.appIconDataUrl ? {} : { appIconDataUrl: effectiveAppearanceDraft.appIconDataUrl }),
      ...(areSettingsDraftsEqual(presetSlots, savedAppearance.presetSlots) ? {} : { presetSlots }),
    })
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

      setImportPreview({ appearance: importedAppearance, fileName: file.name })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t({ ko: '화면 설정 파일을 불러오지 못했어.', en: 'Failed to load the appearance settings file.' }))
    }
  }

  const handleApplyImportPreview = () => {
    if (!importPreview) return
    setAppearanceDraft(importPreview.appearance)
    setImportPreview(null)
    notifyInfo(t({ ko: '가져온 테마를 초안에 적용했어. 아래 저장 바에서 저장하면 반영돼.', en: 'Applied the imported theme to the draft. Save from the bar below to keep it.' }))
  }

  const handleRevertImportPreview = () => {
    setImportPreview(null)
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

  const openAppIconFile = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      const message = t({ ko: '20MB 이하의 PNG, JPG, WebP, GIF, AVIF 이미지를 골라줘.', en: 'Choose a PNG, JPG, WebP, GIF, or AVIF image up to 20 MB.' })
      throw new Error(message)
    }
    appIconRequestRef.current?.abort()
    setIsLoadingAppIcon(false)
    setAppIconSource({ id: ++appIconRevisionRef.current, url: URL.createObjectURL(file), name: file.name })
  }

  const handleAppIconUpload = async (file: File) => {
    try {
      openAppIconFile(file)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t({ ko: '이미지를 열지 못했어.', en: 'Could not open the image.' }))
      throw error
    }
  }

  const handleLibraryAppIconSelect = async (compositeHash: string) => {
    appIconRequestRef.current?.abort()
    const controller = new AbortController()
    appIconRequestRef.current = controller
    const revision = ++appIconRevisionRef.current
    setIsLoadingAppIcon(true)
    try {
      // Load this one selected original so cropping and alpha do not inherit thumbnail compression.
      const response = await fetch(buildApiUrl(`/api/images/${encodeURIComponent(compositeHash)}/file`), {
        credentials: 'include',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      })
      if (!response.ok) throw new Error(t({ ko: '내부 이미지를 불러오지 못했어. 이미지가 남아 있는지와 보기 권한을 확인해줘.', en: 'Could not load the app library image. Check that it still exists and you have permission to view it.' }))
      if (Number(response.headers.get('Content-Length')) > 20 * 1024 * 1024) {
        await response.body?.cancel()
        throw new Error(t({ ko: '20MB 이하의 이미지를 골라줘.', en: 'Choose an image up to 20 MB.' }))
      }
      const image = await response.blob()
      if (controller.signal.aborted || revision !== appIconRevisionRef.current) throw new DOMException('Canceled', 'AbortError')
      openAppIconFile(new File([image], 'app-mark', { type: image.type }))
    } catch (error) {
      if (controller.signal.aborted || revision !== appIconRevisionRef.current) throw error
      notifyError(error instanceof Error ? error.message : t({ ko: '내부 이미지를 불러오지 못했어.', en: 'Could not load the app library image.' }))
      throw error
    } finally {
      if (appIconRequestRef.current === controller) {
        appIconRequestRef.current = null
        setIsLoadingAppIcon(false)
      }
    }
  }

  const handleAppIconClose = () => {
    appIconRevisionRef.current += 1
    appIconRequestRef.current?.abort()
    setIsLoadingAppIcon(false)
    setAppIconSource(null)
  }

  const handleAppIconEdit = () => {
    if (appIconMutation.isPending) return
    appIconRequestRef.current?.abort()
    setIsLoadingAppIcon(false)
    setAppIconSource({ id: ++appIconRevisionRef.current, url: effectiveAppearanceDraft?.appIconDataUrl || APP_ICON_SRC, name: 'app-mark' })
  }

  const handleAppIconRegister = async (dataUrl: string) => {
    await appIconMutation.mutateAsync(dataUrl)
  }

  const handleAppIconReset = async () => {
    try {
      await appIconMutation.mutateAsync('')
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t({ ko: '앱 마크를 되돌리지 못했어.', en: 'Could not restore the app mark.' }))
      throw error
    }
  }

  const draftSection: SettingsDraftSection = {
    id: 'appearance',
    label: t({ ko: '테마', en: 'Theme' }),
    tab: 'general',
    isDirty,
    save: handleAppearanceSave,
    discard: handleAppearanceCancel,
  }

  return {
    draftSection,
    tabProps: {
      appearanceDraft: effectiveAppearanceDraft,
      savedAppearance,
      isDirty,
      onPatchAppearance: patchAppearanceDraft,
      onReset: handleAppearanceReset,
      onExport: handleAppearanceExport,
      onImport: handleAppearanceImport,
      importPreviewFileName: importPreview?.fileName ?? null,
      onApplyImportPreview: handleApplyImportPreview,
      onRevertImportPreview: handleRevertImportPreview,
      onSavePresetSlots: handleAppearancePresetSlotsSave,
      onUploadCustomFont: handleAppearanceFontUpload,
      onClearCustomFont: handleAppearanceFontClear,
      onUploadAppIcon: handleAppIconUpload,
      onSelectLibraryAppIcon: handleLibraryAppIconSelect,
      appIconSource,
      onEditAppIcon: handleAppIconEdit,
      onCloseAppIconEditor: handleAppIconClose,
      onRegisterAppIcon: handleAppIconRegister,
      onResetAppIcon: handleAppIconReset,
      isSavingAppIcon: appIconMutation.isPending,
      isLoadingAppIcon,
      isSaving: appearanceMutation.isPending || appearancePresetSlotsMutation.isPending || appIconMutation.isPending,
      isUploadingFont: appearanceFontUploadMutation.isPending,
    },
  }
}
