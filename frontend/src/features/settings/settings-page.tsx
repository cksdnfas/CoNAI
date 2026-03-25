import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  checkTaggerDependencies,
  getAppSettings,
  getImage,
  getKaloscopeStatus,
  getRandomAutoTestMedia,
  getTaggerModels,
  getTaggerStatus,
  resolveAutoTestMedia,
  runKaloscopeAutoTest,
  runTaggerAutoTest,
  updateAppearanceSettings,
  uploadAppearanceFont,
  updateKaloscopeSettings,
  updateMetadataSettings,
  updateTaggerSettings,
} from '@/lib/api'
import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import type {
  AppearancePresetSlot,
  AppearanceSettings,
  KaloscopeSettings,
  MetadataExtractionSettings,
  TaggerDependencyCheckResult,
  TaggerSettings,
} from '@/types/settings'
import { AutoTab } from './components/auto-tab'
import { AppearanceTab } from './components/appearance-tab'
import { FoldersTab } from './components/folders-tab'
import { MetadataTab } from './components/metadata-tab'
import { SettingsTabNav } from './components/settings-tab-nav'
import type { SettingsTab } from './settings-tabs'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { applyAppearanceTheme } from '@/lib/appearance'
import { buildAppearancePackage, restoreAppearancePackage } from '@/lib/appearance-package'
import { useFolderSettingsTab } from './use-folder-settings-tab'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [activeTab, setActiveTab] = useState<SettingsTab>('folders')
  const [appearanceDraft, setAppearanceDraft] = useState<AppearanceSettings | null>(null)
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [taggerDraft, setTaggerDraft] = useState<TaggerSettings | null>(null)
  const [kaloscopeDraft, setKaloscopeDraft] = useState<KaloscopeSettings | null>(null)
  const [taggerDependencyResult, setTaggerDependencyResult] = useState<TaggerDependencyCheckResult | null>(null)
  const hasAutoCheckedTaggerDependenciesRef = useRef(false)
  const [autoTestHashInput, setAutoTestHashInput] = useState('')
  const [autoTestMedia, setAutoTestMedia] = useState<AutoTestMediaRecord | null>(null)
  const [taggerTestResult, setTaggerTestResult] = useState<AutoTestTaggerResult | null>(null)
  const [kaloscopeTestResult, setKaloscopeTestResult] = useState<AutoTestKaloscopeResult | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })
  const taggerModelsQuery = useQuery({
    queryKey: ['tagger-models'],
    queryFn: getTaggerModels,
  })
  const taggerStatusQuery = useQuery({
    queryKey: ['tagger-status'],
    queryFn: getTaggerStatus,
  })
  const kaloscopeStatusQuery = useQuery({
    queryKey: ['kaloscope-status'],
    queryFn: getKaloscopeStatus,
  })
  const autoTestImageQuery = useQuery({
    queryKey: ['auto-test-image-detail', autoTestMedia?.compositeHash],
    queryFn: () => getImage(autoTestMedia!.compositeHash),
    enabled: Boolean(autoTestMedia?.compositeHash),
  })

  const effectiveAppearanceDraft = appearanceDraft ?? settingsQuery.data?.appearance ?? null
  const savedAppearance = settingsQuery.data?.appearance ?? DEFAULT_APPEARANCE_SETTINGS
  const effectiveMetadataDraft = metadataDraft ?? settingsQuery.data?.metadataExtraction ?? null
  const effectiveTaggerDraft = taggerDraft ?? settingsQuery.data?.tagger ?? null
  const effectiveKaloscopeDraft = kaloscopeDraft ?? settingsQuery.data?.kaloscope ?? null

  const notifyInfo = (message: string) => {
    showSnackbar({ message, tone: 'info' })
  }

  const notifyError = (message: string) => {
    showSnackbar({ message, tone: 'error' })
  }

  const syncSettingsCache = (nextSettings: Awaited<ReturnType<typeof getAppSettings>>) => {
    queryClient.setQueryData(['app-settings'], nextSettings)
  }

  const refreshAutoQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-models'] }),
      queryClient.invalidateQueries({ queryKey: ['tagger-status'] }),
      queryClient.invalidateQueries({ queryKey: ['kaloscope-status'] }),
    ])
  }

  const applyAutoTestMedia = (media: AutoTestMediaRecord) => {
    setAutoTestHashInput(media.compositeHash)
    setAutoTestMedia(media)
    setTaggerTestResult(null)
    setKaloscopeTestResult(null)
  }

  const { tabProps: foldersTabProps } = useFolderSettingsTab({ notifyInfo, notifyError })

  const metadataMutation = useMutation({
    mutationFn: updateMetadataSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setMetadataDraft(settings.metadataExtraction)
      notifyInfo('메타데이터 추출 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '메타데이터 설정 저장에 실패했어.')
    },
  })

  const appearanceMutation = useMutation({
    mutationFn: updateAppearanceSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setAppearanceDraft(settings.appearance)
      notifyInfo('화면 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '화면 설정 저장에 실패했어.')
    },
  })

  const appearancePresetSlotsMutation = useMutation({
    mutationFn: (presetSlots: AppearancePresetSlot[]) => updateAppearanceSettings({ presetSlots }),
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setAppearanceDraft((current) =>
        current
          ? { ...current, presetSlots: settings.appearance.presetSlots }
          : settings.appearance,
      )
      notifyInfo('테마 슬롯을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '테마 슬롯 저장에 실패했어.')
    },
  })

  const appearanceFontUploadMutation = useMutation({
    mutationFn: ({ file, target }: { file: File; target: 'sans' | 'mono' }) => uploadAppearanceFont(file, target),
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '커스텀 폰트 업로드에 실패했어.')
    },
  })

  const taggerMutation = useMutation({
    mutationFn: updateTaggerSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setTaggerDraft(settings.tagger)
      setTaggerDependencyResult(null)
      hasAutoCheckedTaggerDependenciesRef.current = false
      await queryClient.invalidateQueries({ queryKey: ['tagger-status'] })
      notifyInfo('프롬프트 추출 태거 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '태거 설정 저장에 실패했어.')
    },
  })

  const kaloscopeMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      setKaloscopeDraft(settings.kaloscope)
      await refreshAutoQueries()
      notifyInfo('자동 프롬프트 추출 설정을 저장했어.')
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : 'Kaloscope 설정 저장에 실패했어.')
    },
  })

  const taggerDependencyMutation = useMutation({
    mutationFn: checkTaggerDependencies,
    onSuccess: (result) => {
      setTaggerDependencyResult(result)
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '태거 의존성 확인에 실패했어.')
    },
  })

  useEffect(() => {
    if (activeTab !== 'auto') return
    if (hasAutoCheckedTaggerDependenciesRef.current || taggerDependencyMutation.isPending) return

    hasAutoCheckedTaggerDependenciesRef.current = true
    void taggerDependencyMutation.mutateAsync()
  }, [activeTab, taggerDependencyMutation])

  useEffect(() => {
    if (activeTab === 'appearance') {
      applyAppearanceTheme(effectiveAppearanceDraft ?? savedAppearance)
      return
    }

    applyAppearanceTheme(savedAppearance)
  }, [activeTab, effectiveAppearanceDraft, savedAppearance])

  const autoTestResolveMutation = useMutation({
    mutationFn: resolveAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      if (media.existsOnDisk) {
        notifyInfo('테스트 대상을 확인했어.')
      } else {
        notifyError('대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
      }
    },
    onError: (error) => {
      setAutoTestMedia(null)
      setTaggerTestResult(null)
      setKaloscopeTestResult(null)
      notifyError(error instanceof Error ? error.message : '테스트 대상을 찾지 못했어.')
    },
  })

  const autoTestRandomMutation = useMutation({
    mutationFn: getRandomAutoTestMedia,
    onSuccess: (media) => {
      applyAutoTestMedia(media)
      if (media.existsOnDisk) {
        notifyInfo('랜덤 테스트 대상을 골랐어.')
      } else {
        notifyError('랜덤 대상은 찾았지만 디스크에서 파일을 확인하지 못했어.')
      }
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '랜덤 테스트 대상을 고르지 못했어.')
    },
  })

  const taggerAutoTestMutation = useMutation({
    mutationFn: runTaggerAutoTest,
    onSuccess: (result) => {
      setTaggerTestResult(result)
      notifyInfo('태거 테스트가 끝났어.')
    },
    onError: (error) => {
      setTaggerTestResult(null)
      notifyError(error instanceof Error ? error.message : '태거 테스트에 실패했어.')
    },
  })

  const kaloscopeAutoTestMutation = useMutation({
    mutationFn: runKaloscopeAutoTest,
    onSuccess: (result) => {
      setKaloscopeTestResult(result)
      notifyInfo('Kaloscope 테스트가 끝났어.')
    },
    onError: (error) => {
      setKaloscopeTestResult(null)
      notifyError(error instanceof Error ? error.message : 'Kaloscope 테스트에 실패했어.')
    },
  })

  const patchMetadataDraft = (patch: Partial<MetadataExtractionSettings>) => {
    if (!effectiveMetadataDraft) return
    setMetadataDraft({ ...effectiveMetadataDraft, ...patch })
  }

  const patchAppearanceDraft = (patch: Partial<AppearanceSettings>) => {
    if (!effectiveAppearanceDraft) return
    setAppearanceDraft({ ...effectiveAppearanceDraft, ...patch })
  }

  const normalizePresetSlotsForSave = (presetSlots: AppearancePresetSlot[]) =>
    presetSlots.map((slot, index) => ({
      ...slot,
      label: slot.label.trim() || `Slot ${index + 1}`,
    }))

  const isAppearanceDirty =
    JSON.stringify(effectiveAppearanceDraft ?? savedAppearance) !== JSON.stringify(savedAppearance)

  const handleAppearanceReset = () => {
    setAppearanceDraft((current) => ({
      ...DEFAULT_APPEARANCE_SETTINGS,
      presetSlots: current?.presetSlots ?? savedAppearance.presetSlots,
    }))
  }

  const handleAppearanceCancel = () => {
    setAppearanceDraft(savedAppearance)
    applyAppearanceTheme(savedAppearance)
  }

  const handleAppearanceSave = () => {
    if (!effectiveAppearanceDraft) return
    void appearanceMutation.mutateAsync({
      ...effectiveAppearanceDraft,
      presetSlots: normalizePresetSlotsForSave(effectiveAppearanceDraft.presetSlots),
    })
  }

  const handleAppearanceExport = async () => {
    try {
      const appearanceToExport = {
        ...(effectiveAppearanceDraft ?? savedAppearance),
        presetSlots: normalizePresetSlotsForSave((effectiveAppearanceDraft ?? savedAppearance).presetSlots),
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
      notifyInfo('현재 테마와 연결된 폰트 자산까지 패키지로 내보냈어.')
    } catch (error) {
      notifyError(error instanceof Error ? error.message : '화면 설정 패키지를 내보내지 못했어.')
    }
  }

  const handleAppearanceImport = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const importedAppearance = await restoreAppearancePackage(raw, savedAppearance, uploadAppearanceFont)

      if (!importedAppearance) {
        throw new Error('Appearance JSON 구조를 확인하지 못했어.')
      }

      await appearanceMutation.mutateAsync(importedAppearance)
      notifyInfo('화면 설정 패키지를 불러와 저장했어.')
    } catch (error) {
      notifyError(error instanceof Error ? error.message : '화면 설정 파일을 불러오지 못했어.')
    }
  }

  const handleAppearancePresetSlotsSave = (presetSlots: AppearancePresetSlot[]) => {
    const normalizedPresetSlots = normalizePresetSlotsForSave(presetSlots)
    setAppearanceDraft((current) => (current ? { ...current, presetSlots: normalizedPresetSlots } : current))
    void appearancePresetSlotsMutation.mutateAsync(normalizedPresetSlots)
  }

  const handleAppearanceFontUpload = async (target: 'sans' | 'mono', file: File) => {
    const uploaded = await appearanceFontUploadMutation.mutateAsync({ file, target })

    setAppearanceDraft((current) => {
      const base = current ?? savedAppearance
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

    notifyInfo(`${target === 'sans' ? '본문' : '모노'} 커스텀 폰트를 업로드했어. 저장하면 기본 테마에 반영돼.`)
  }

  const handleAppearanceFontClear = (target: 'sans' | 'mono') => {
    setAppearanceDraft((current) => {
      const base = current ?? savedAppearance
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

    notifyInfo(`${target === 'sans' ? '본문' : '모노'} 업로드 폰트를 draft에서 해제했어. 저장하면 반영돼.`)
  }

  const patchTaggerDraft = (patch: Partial<TaggerSettings>) => {
    if (!effectiveTaggerDraft) return
    setTaggerDraft({ ...effectiveTaggerDraft, ...patch })
  }

  const patchKaloscopeDraft = (patch: Partial<KaloscopeSettings>) => {
    if (!effectiveKaloscopeDraft) return
    setKaloscopeDraft({ ...effectiveKaloscopeDraft, ...patch })
  }

  const handleResolveAutoTestMedia = () => {
    const nextHash = autoTestHashInput.trim()
    if (!nextHash) return
    void autoTestResolveMutation.mutateAsync(nextHash)
  }

  const handleRunTaggerAutoTest = () => {
    if (!autoTestMedia?.existsOnDisk) return
    setTaggerTestResult(null)
    void taggerAutoTestMutation.mutateAsync(autoTestMedia.compositeHash)
  }

  const handleRunKaloscopeAutoTest = () => {
    if (!autoTestMedia?.existsOnDisk) return
    setKaloscopeTestResult(null)
    void kaloscopeAutoTestMutation.mutateAsync(autoTestMedia.compositeHash)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <div className="grid gap-8 min-[800px]:grid-cols-[260px_minmax(0,1fr)]">
        <SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />

        <section className="space-y-8">
          {activeTab === 'folders' ? <FoldersTab {...foldersTabProps} /> : null}

          {activeTab === 'appearance' ? (
            <AppearanceTab
              appearanceDraft={effectiveAppearanceDraft}
              savedAppearance={savedAppearance}
              isDirty={isAppearanceDirty}
              onPatchAppearance={patchAppearanceDraft}
              onReset={handleAppearanceReset}
              onCancel={handleAppearanceCancel}
              onSave={handleAppearanceSave}
              onExport={handleAppearanceExport}
              onImport={handleAppearanceImport}
              onSavePresetSlots={handleAppearancePresetSlotsSave}
              onUploadCustomFont={handleAppearanceFontUpload}
              onClearCustomFont={handleAppearanceFontClear}
              isSaving={appearanceMutation.isPending || appearancePresetSlotsMutation.isPending}
              isUploadingFont={appearanceFontUploadMutation.isPending}
            />
          ) : null}

          {activeTab === 'auto' ? (
            <AutoTab
              taggerDraft={effectiveTaggerDraft}
              kaloscopeDraft={effectiveKaloscopeDraft}
              taggerModels={taggerModelsQuery.data ?? []}
              taggerStatus={taggerStatusQuery.data}
              kaloscopeStatus={kaloscopeStatusQuery.data}
              taggerDependencyResult={taggerDependencyResult}
              onPatchTagger={patchTaggerDraft}
              onPatchKaloscope={patchKaloscopeDraft}
              onSaveTagger={() => effectiveTaggerDraft && void taggerMutation.mutateAsync(effectiveTaggerDraft)}
              onSaveKaloscope={() => effectiveKaloscopeDraft && void kaloscopeMutation.mutateAsync(effectiveKaloscopeDraft)}
              isSavingTagger={taggerMutation.isPending}
              isSavingKaloscope={kaloscopeMutation.isPending}
              isCheckingTaggerDependencies={taggerDependencyMutation.isPending}
              autoTestHashInput={autoTestHashInput}
              onAutoTestHashInputChange={(value) => {
                setAutoTestHashInput(value)
                setAutoTestMedia(null)
                setTaggerTestResult(null)
                setKaloscopeTestResult(null)
              }}
              autoTestMedia={autoTestMedia}
              autoTestImage={(autoTestImageQuery.data as ImageRecord | undefined) ?? null}
              isLoadingAutoTestImage={autoTestImageQuery.isLoading}
              taggerTestResult={taggerTestResult}
              kaloscopeTestResult={kaloscopeTestResult}
              onResolveAutoTestMedia={handleResolveAutoTestMedia}
              onRandomAutoTestMedia={() => void autoTestRandomMutation.mutateAsync()}
              onRunTaggerAutoTest={handleRunTaggerAutoTest}
              onRunKaloscopeAutoTest={handleRunKaloscopeAutoTest}
              isResolvingAutoTestMedia={autoTestResolveMutation.isPending}
              isPickingRandomAutoTestMedia={autoTestRandomMutation.isPending}
              isRunningTaggerAutoTest={taggerAutoTestMutation.isPending}
              isRunningKaloscopeAutoTest={kaloscopeAutoTestMutation.isPending}
            />
          ) : null}

          {activeTab === 'metadata' ? (
            <MetadataTab
              metadataDraft={effectiveMetadataDraft}
              onPatchMetadata={patchMetadataDraft}
              onSave={() => effectiveMetadataDraft && void metadataMutation.mutateAsync(effectiveMetadataDraft)}
              isSaving={metadataMutation.isPending}
            />
          ) : null}
        </section>
      </div>
    </div>
  )
}

