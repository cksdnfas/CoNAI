import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy, ClipboardList, Download, FileUp, History, RotateCcw, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { triggerBlobDownload } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  buildGenerationBriefComfyCompatibilityCards,
  buildGenerationBriefComfyCompatibilityText,
  buildGenerationBriefHandoffFilename,
  buildGenerationBriefHistoryEvolutionSummary,
  buildGenerationBriefHistoryInsightCards,
  buildGenerationBriefHistoryQueryResult,
  buildGenerationBriefHistoryRestoreComparison,
  buildGenerationBriefHistorySnapshotComparison,
  buildGenerationBriefImportDiff,
  buildGenerationBriefSelectiveImportDraft,
  countGenerationBriefSelectedImportChanges,
  buildGenerationBriefIterationHandoffCards,
  buildGenerationBriefIterationHandoffText,
  buildGenerationBriefNaiReusableAssetsText,
  buildGenerationBriefNaiReuseCards,
  buildGenerationBriefReadinessGate,
  buildGenerationBriefReviewCopy,
  buildGenerationBriefReviewSummary,
  clearGenerationBriefDraft,
  clearGenerationBriefHistorySnapshots,
  clearGenerationBriefRecoveryCheckpoint,
  deleteGenerationBriefHistorySnapshot,
  GENERATION_BRIEF_FIELDS,
  parseGenerationBriefHandoffPayload,
  readGenerationBriefDraft,
  readGenerationBriefHistorySnapshots,
  readGenerationBriefRecoveryCheckpoint,
  readGenerationBriefSaveMetadata,
  saveGenerationBriefDraft,
  saveGenerationBriefHistorySnapshot,
  saveGenerationBriefRecoveryCheckpoint,
  serializeGenerationBriefHandoffPayload,
  type GenerationBriefComfyCompatibilityCardStatus,
  type GenerationBriefComfyCompatibilitySnapshot,
  type GenerationBriefDraft,
  type GenerationBriefHistoryDiscoveryLabel,
  type GenerationBriefHistoryInsightCardStatus,
  type GenerationBriefHistorySnapshot,
  type GenerationBriefImportDiffFieldStatus,
  type GenerationBriefIterationHandoffCardStatus,
  type GenerationBriefIterationHandoffSnapshot,
  type GenerationBriefNaiReuseCardStatus,
  type GenerationBriefNaiReuseSnapshot,
  type GenerationBriefReadinessGateItemStatus,
  type GenerationBriefReadinessGateStatus,
  type GenerationBriefRecoveryCheckpoint,
  type GenerationBriefSaveMetadata,
  type GenerationBriefTarget,
} from '../generation-brief-workspace'

const TARGET_OPTIONS: Array<{ value: GenerationBriefTarget; label: { ko: string; en: string }; description: { ko: string; en: string } }> = [
  {
    value: 'undecided',
    label: { ko: '미정', en: 'Undecided' },
    description: { ko: '먼저 의도와 자료를 모아.', en: 'Collect intent and materials first.' },
  },
  {
    value: 'novelai',
    label: { ko: 'NovelAI', en: 'NovelAI' },
    description: { ko: '프롬프트, 캐릭터, Vibe 중심.', en: 'Prompt, character, and Vibe focused.' },
  },
  {
    value: 'comfyui',
    label: { ko: 'ComfyUI', en: 'ComfyUI' },
    description: { ko: '워크플로우 입력과 서버 준비 중심.', en: 'Workflow input and server-readiness focused.' },
  },
  {
    value: 'codex',
    label: { ko: 'Codex', en: 'Codex' },
    description: { ko: '이미지 지시문과 첨부 자료 중심.', en: 'Instruction and attachment focused.' },
  },
]

function getTargetFromActiveTab(activeTab: string): GenerationBriefTarget {
  if (activeTab === 'nai') return 'novelai'
  if (activeTab === 'comfyui') return 'comfyui'
  if (activeTab === 'codex') return 'codex'
  return 'undecided'
}

function getSummaryStatusTone(status: ReturnType<typeof buildGenerationBriefReviewSummary>['status']) {
  if (status === 'review-ready') return 'default'
  if (status === 'drafting') return 'secondary'
  return 'outline'
}

function getNaiReuseCardStatusLabel(status: GenerationBriefNaiReuseCardStatus) {
  if (status === 'ready') return { ko: '준비됨', en: 'Ready' }
  if (status === 'warning') return { ko: '확인 필요', en: 'Review' }
  return { ko: '비어 있음', en: 'Missing' }
}

function getNaiReuseCardStatusTone(status: GenerationBriefNaiReuseCardStatus) {
  if (status === 'ready') return 'secondary'
  return 'outline'
}

function getComfyCompatibilityCardStatusLabel(status: GenerationBriefComfyCompatibilityCardStatus) {
  if (status === 'ready') return { ko: '준비됨', en: 'Ready' }
  if (status === 'warning') return { ko: '확인 필요', en: 'Review' }
  return { ko: '비어 있음', en: 'Missing' }
}

function getComfyCompatibilityCardStatusTone(status: GenerationBriefComfyCompatibilityCardStatus) {
  if (status === 'ready') return 'secondary'
  return 'outline'
}

function getIterationHandoffCardStatusLabel(status: GenerationBriefIterationHandoffCardStatus) {
  if (status === 'ready') return { ko: '준비됨', en: 'Ready' }
  return { ko: '확인 필요', en: 'Review' }
}

function getIterationHandoffCardStatusTone(status: GenerationBriefIterationHandoffCardStatus) {
  if (status === 'ready') return 'secondary'
  return 'outline'
}

function getHistoryInsightCardStatusLabel(status: GenerationBriefHistoryInsightCardStatus) {
  if (status === 'ready') return { ko: '준비됨', en: 'Ready' }
  return { ko: '확인 필요', en: 'Review' }
}

function getHistoryInsightCardStatusTone(status: GenerationBriefHistoryInsightCardStatus) {
  if (status === 'ready') return 'secondary'
  return 'outline'
}

function getReadinessGateStatusLabel(status: GenerationBriefReadinessGateStatus) {
  if (status === 'ready') return { ko: '실행 전 검토 준비', en: 'Ready for pre-run review' }
  if (status === 'review-needed') return { ko: '경고 검토 필요', en: 'Review warnings' }
  return { ko: '아직 부족함', en: 'Not ready' }
}

function getReadinessGateStatusTone(status: GenerationBriefReadinessGateStatus) {
  if (status === 'ready') return 'secondary'
  if (status === 'review-needed') return 'outline'
  return 'outline'
}

function getReadinessGateItemStatusLabel(status: GenerationBriefReadinessGateItemStatus) {
  if (status === 'ready') return { ko: '준비됨', en: 'Ready' }
  if (status === 'review') return { ko: '검토 필요', en: 'Review' }
  return { ko: '누락', en: 'Missing' }
}

function getReadinessGateItemStatusTone(status: GenerationBriefReadinessGateItemStatus) {
  if (status === 'ready') return 'secondary'
  return 'outline'
}

function getImportRejectionLabel(reason: 'empty' | 'invalid-json' | 'invalid-schema' | 'unsafe-boundary') {
  if (reason === 'invalid-json') return { ko: 'JSON 형식 오류', en: 'Invalid JSON' }
  if (reason === 'invalid-schema') return { ko: '지원하지 않는 스키마', en: 'Unsupported schema' }
  if (reason === 'unsafe-boundary') return { ko: 'local-only 경계 불일치', en: 'Unsafe boundary' }
  return { ko: '비어 있음', en: 'Empty' }
}

function getImportDiffStatusLabel(status: GenerationBriefImportDiffFieldStatus) {
  if (status === 'filled') return { ko: '추가', en: 'Fills empty' }
  if (status === 'cleared') return { ko: '비움', en: 'Clears current' }
  if (status === 'changed') return { ko: '변경', en: 'Changes' }
  return { ko: '유지', en: 'Unchanged' }
}

function getImportDiffStatusTone(status: GenerationBriefImportDiffFieldStatus) {
  if (status === 'unchanged') return 'outline'
  if (status === 'cleared') return 'outline'
  return 'secondary'
}

function getRecoveryCheckpointReasonLabel(reason: GenerationBriefRecoveryCheckpoint['reason']) {
  if (reason === 'history-restore') return { ko: '히스토리 복원 전 초안', en: 'Before history restore' }
  if (reason === 'import-restore') return { ko: '가져오기 전 초안', en: 'Before import restore' }
  return { ko: '초기화 전 초안', en: 'Before reset' }
}

function getSaveMetadataStatusLabel(status: GenerationBriefSaveMetadata['summary']['status']) {
  if (status === 'review-ready') return { ko: '검토 준비', en: 'Review ready' }
  if (status === 'drafting') return { ko: '작성 중', en: 'Drafting' }
  return { ko: '빈 브리프', en: 'Empty brief' }
}

function appendGenerationBriefNote(current: string, next: string) {
  const currentText = current.trim()
  const nextText = next.trim()

  if (!nextText) return currentText
  if (!currentText) return nextText
  if (currentText.includes(nextText)) return currentText
  return `${currentText}\n\n${nextText}`
}

function groupHistoryDiscoveryLabelsBySnapshot(discoveryLabels: GenerationBriefHistoryDiscoveryLabel[]) {
  const labelsBySnapshot = new Map<string, GenerationBriefHistoryDiscoveryLabel[]>()
  discoveryLabels.forEach((label) => {
    labelsBySnapshot.set(label.snapshotId, [...(labelsBySnapshot.get(label.snapshotId) ?? []), label])
  })
  return labelsBySnapshot
}

interface GenerationBriefWorkspaceProps {
  activeTab: string
  naiReuseSnapshot?: GenerationBriefNaiReuseSnapshot | null
  comfyCompatibilitySnapshot?: GenerationBriefComfyCompatibilitySnapshot | null
  iterationHandoffSnapshot?: GenerationBriefIterationHandoffSnapshot | null
}

export function GenerationBriefWorkspace({ activeTab, naiReuseSnapshot = null, comfyCompatibilitySnapshot = null, iterationHandoffSnapshot = null }: GenerationBriefWorkspaceProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const activeTarget = getTargetFromActiveTab(activeTab)
  const [draft, setDraft] = useState<GenerationBriefDraft>(() => {
    const storedDraft = readGenerationBriefDraft()
    return storedDraft.target === 'undecided' && activeTarget !== 'undecided'
      ? { ...storedDraft, target: activeTarget }
      : storedDraft
  })
  const [recoveryCheckpoint, setRecoveryCheckpoint] = useState<GenerationBriefRecoveryCheckpoint | null>(() => readGenerationBriefRecoveryCheckpoint())
  const [saveMetadata, setSaveMetadata] = useState<GenerationBriefSaveMetadata | null>(() => readGenerationBriefSaveMetadata())
  const [historySnapshots, setHistorySnapshots] = useState<GenerationBriefHistorySnapshot[]>(() => readGenerationBriefHistorySnapshots())
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyComparisonBaseSnapshotId, setHistoryComparisonBaseSnapshotId] = useState('')
  const [importPayload, setImportPayload] = useState('')
  const [selectedImportFields, setSelectedImportFields] = useState<Array<keyof GenerationBriefDraft>>([])
  const importPreview = useMemo(() => {
    const trimmedPayload = importPayload.trim()
    return trimmedPayload ? parseGenerationBriefHandoffPayload(trimmedPayload) : null
  }, [importPayload])
  useEffect(() => {
    setSelectedImportFields(importPreview?.status === 'imported' ? [...GENERATION_BRIEF_FIELDS] : [])
  }, [importPreview])
  const importPreviewHistoryInsights = importPreview?.status === 'imported' ? importPreview.historyInsights : []
  const importPreviewReadinessGate = useMemo(() => (
    importPreview?.status === 'imported'
      ? buildGenerationBriefReadinessGate(importPreview.draft, { historyInsightCards: importPreview.historyInsights })
      : null
  ), [importPreview])
  const importPreviewTargetLabel = importPreview?.status === 'imported'
    ? TARGET_OPTIONS.find((option) => option.value === importPreview.draft.target)?.label ?? { ko: importPreview.draft.target, en: importPreview.draft.target }
    : null
  const importPreviewDiff = useMemo(() => (
    importPreview?.status === 'imported'
      ? buildGenerationBriefImportDiff(draft, importPreview.draft)
      : null
  ), [draft, importPreview])
  const selectedImportFieldSet = useMemo(() => new Set(selectedImportFields), [selectedImportFields])
  const selectedImportFieldCount = importPreviewDiff
    ? importPreviewDiff.fields.filter((field) => selectedImportFieldSet.has(field.field)).length
    : 0
  const selectedChangedImportFieldCount = importPreviewDiff
    ? countGenerationBriefSelectedImportChanges(importPreviewDiff, selectedImportFields)
    : 0
  const canApplyImport = importPreview?.status === 'imported' && selectedChangedImportFieldCount > 0
  const summary = useMemo(() => buildGenerationBriefReviewSummary(draft), [draft])
  const naiReuseCards = useMemo(() => (naiReuseSnapshot ? buildGenerationBriefNaiReuseCards(naiReuseSnapshot) : []), [naiReuseSnapshot])
  const naiReuseText = useMemo(() => (naiReuseSnapshot ? buildGenerationBriefNaiReusableAssetsText(naiReuseSnapshot) : ''), [naiReuseSnapshot])
  const comfyCompatibilityCards = useMemo(() => (comfyCompatibilitySnapshot ? buildGenerationBriefComfyCompatibilityCards(comfyCompatibilitySnapshot) : []), [comfyCompatibilitySnapshot])
  const comfyCompatibilityText = useMemo(() => (comfyCompatibilitySnapshot ? buildGenerationBriefComfyCompatibilityText(comfyCompatibilitySnapshot) : ''), [comfyCompatibilitySnapshot])
  const iterationHandoffCards = useMemo(() => (iterationHandoffSnapshot ? buildGenerationBriefIterationHandoffCards(iterationHandoffSnapshot) : []), [iterationHandoffSnapshot])
  const iterationHandoffText = useMemo(() => (iterationHandoffSnapshot ? buildGenerationBriefIterationHandoffText(iterationHandoffSnapshot) : ''), [iterationHandoffSnapshot])
  const historyQueryResult = useMemo(() => buildGenerationBriefHistoryQueryResult(historySnapshots, historyQuery), [historyQuery, historySnapshots])
  const historyEvolutionSummary = useMemo(() => buildGenerationBriefHistoryEvolutionSummary(historySnapshots), [historySnapshots])
  const historyComparisonBaseSnapshot = useMemo(
    () => historySnapshots.find((snapshot) => snapshot.id === historyComparisonBaseSnapshotId) ?? null,
    [historyComparisonBaseSnapshotId, historySnapshots],
  )
  const historyInsightCards = useMemo(() => buildGenerationBriefHistoryInsightCards(
    historyQueryResult,
    historyEvolutionSummary,
    historyComparisonBaseSnapshot,
  ), [historyComparisonBaseSnapshot, historyEvolutionSummary, historyQueryResult])
  const readinessGate = useMemo(() => buildGenerationBriefReadinessGate(draft, {
    naiReuseCards,
    comfyCompatibilityCards,
    iterationHandoffCards,
    historyInsightCards,
  }), [comfyCompatibilityCards, draft, historyInsightCards, iterationHandoffCards, naiReuseCards])
  const reviewCopy = useMemo(() => buildGenerationBriefReviewCopy(draft, {
    naiReuseCards,
    comfyCompatibilityCards,
    iterationHandoffCards,
    historyInsightCards,
  }), [comfyCompatibilityCards, draft, historyInsightCards, iterationHandoffCards, naiReuseCards])
  const showNaiReuseCards = activeTarget === 'novelai' || draft.target === 'novelai'
  const showComfyCompatibilityCards = activeTarget === 'comfyui' || draft.target === 'comfyui'
  const historyDiscoveryLabelsBySnapshot = useMemo(
    () => groupHistoryDiscoveryLabelsBySnapshot(historyQueryResult.discoveryLabels),
    [historyQueryResult.discoveryLabels],
  )
  const historyEvolutionChangedFields = historyEvolutionSummary.fields.filter((field) => field.changedCount > 0)
  const recentHistoryEvolutionTransitions = historyEvolutionSummary.transitions.slice(-3).reverse()
  const filteredHistorySnapshots = historyQueryResult.snapshots
  useEffect(() => {
    if (historyComparisonBaseSnapshotId && !historyComparisonBaseSnapshot) {
      setHistoryComparisonBaseSnapshotId('')
    }
  }, [historyComparisonBaseSnapshot, historyComparisonBaseSnapshotId])

  const persistGenerationBriefDraft = (nextDraft: GenerationBriefDraft) => {
    const savedDraft = saveGenerationBriefDraft(nextDraft)
    setSaveMetadata(readGenerationBriefSaveMetadata())
    return savedDraft
  }

  const updateDraft = (patch: Partial<GenerationBriefDraft>) => {
    setDraft(persistGenerationBriefDraft({ ...draft, ...patch }))
  }

  const saveCurrentDraft = () => {
    const savedDraft = persistGenerationBriefDraft(draft)
    const nextHistorySnapshots = saveGenerationBriefHistorySnapshot(savedDraft, 'manual-save')
    const savedSummary = buildGenerationBriefReviewSummary(savedDraft)
    setDraft(savedDraft)
    setHistorySnapshots(nextHistorySnapshots)
    showSnackbar({
      message: t(savedSummary.status === 'empty'
        ? { ko: '로컬 저장 상태만 갱신했어. 빈 브리프는 히스토리에 추가하지 않아.', en: 'Updated the local save status only. Empty briefs are not added to history.' }
        : { ko: '로컬 저장 상태와 히스토리 스냅샷을 갱신했어.', en: 'Updated the local save status and history snapshot.' }),
      tone: 'info',
    })
  }

  const resetDraft = () => {
    setRecoveryCheckpoint(saveGenerationBriefRecoveryCheckpoint(draft, 'reset'))
    setDraft(clearGenerationBriefDraft())
    setSaveMetadata(readGenerationBriefSaveMetadata())
    showSnackbar({ message: t({ ko: '이전 초안을 복구 체크포인트로 남기고 브리프를 초기화했어.', en: 'Reset the brief after saving the previous draft as a recovery checkpoint.' }), tone: 'info' })
  }

  const restoreRecoveryCheckpoint = () => {
    if (!recoveryCheckpoint) {
      return
    }

    const restoredDraft = persistGenerationBriefDraft(recoveryCheckpoint.draft)
    clearGenerationBriefRecoveryCheckpoint()
    setRecoveryCheckpoint(null)
    setDraft(restoredDraft)
    showSnackbar({ message: t({ ko: '복구 체크포인트를 로컬 초안으로 되돌렸어.', en: 'Restored the recovery checkpoint into the local draft.' }), tone: 'info' })
  }

  const restoreHistorySnapshot = (snapshot: GenerationBriefHistorySnapshot) => {
    setRecoveryCheckpoint(saveGenerationBriefRecoveryCheckpoint(draft, 'history-restore'))
    const restoredDraft = persistGenerationBriefDraft(snapshot.draft)
    setDraft(restoredDraft)
    showSnackbar({ message: t({ ko: '히스토리 스냅샷을 로컬 초안으로 복원했어.', en: 'Restored the history snapshot into the local draft.' }), tone: 'info' })
  }

  const removeHistorySnapshot = (snapshot: GenerationBriefHistorySnapshot) => {
    setHistorySnapshots(deleteGenerationBriefHistorySnapshot(snapshot.id))
    showSnackbar({ message: t({ ko: '선택한 로컬 히스토리 스냅샷을 지웠어.', en: 'Removed the selected local history snapshot.' }), tone: 'info' })
  }

  const clearHistorySnapshots = () => {
    setHistorySnapshots(clearGenerationBriefHistorySnapshots())
    showSnackbar({ message: t({ ko: '로컬 저장 히스토리만 비웠어. 현재 초안과 복구 체크포인트는 유지했어.', en: 'Cleared only the local save history. The current draft and recovery checkpoint were kept.' }), tone: 'info' })
  }

  const applyNaiReuseCards = () => {
    if (!naiReuseText.trim()) {
      return
    }

    setDraft(persistGenerationBriefDraft({
      ...draft,
      target: 'novelai',
      reusableAssets: appendGenerationBriefNote(draft.reusableAssets, naiReuseText),
    }))
    showSnackbar({ message: t({ ko: 'NAI 재사용 카드를 브리프에 추가했어.', en: 'Added NAI reuse cards to the brief.' }), tone: 'info' })
  }

  const applyComfyCompatibilitySummary = () => {
    if (!comfyCompatibilityText.trim()) {
      return
    }

    setDraft(persistGenerationBriefDraft({
      ...draft,
      target: 'comfyui',
      reusableAssets: appendGenerationBriefNote(draft.reusableAssets, comfyCompatibilityText),
    }))
    showSnackbar({ message: t({ ko: 'Comfy 호환성 요약을 브리프에 추가했어.', en: 'Added the Comfy compatibility summary to the brief.' }), tone: 'info' })
  }

  const applyIterationHandoffPacket = () => {
    if (!iterationHandoffSnapshot || !iterationHandoffText.trim()) {
      return
    }

    setDraft(persistGenerationBriefDraft({
      ...draft,
      target: iterationHandoffSnapshot.target,
      sourceReferences: appendGenerationBriefNote(draft.sourceReferences, iterationHandoffText),
    }))
    showSnackbar({ message: t({ ko: '반복 핸드오프 패킷을 브리프에 추가했어.', en: 'Added the iteration handoff packet to the brief.' }), tone: 'info' })
  }

  const copyReviewPacket = async () => {
    try {
      await copyTextToClipboard(reviewCopy)
      showSnackbar({ message: t({ ko: '브리프 검토문을 복사했어.', en: 'Copied the brief review packet.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '브리프 검토문 복사에 실패했어.', en: 'Failed to copy the brief review packet.' }), tone: 'error' })
    }
  }

  const downloadHandoffPayload = () => {
    const exportedAt = new Date()
    const payload = serializeGenerationBriefHandoffPayload(draft, exportedAt.toISOString(), {
      naiReuseCards,
      comfyCompatibilityCards,
      iterationHandoffCards,
      historyInsightCards,
    })
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    triggerBlobDownload(blob, buildGenerationBriefHandoffFilename(exportedAt))
    showSnackbar({ message: t({ ko: '로컬 브리프 JSON을 내려받았어.', en: 'Downloaded the local brief JSON.' }), tone: 'info' })
  }

  const toggleImportFieldSelection = (field: keyof GenerationBriefDraft, selected: boolean) => {
    setSelectedImportFields((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(field)
      } else {
        next.delete(field)
      }
      return GENERATION_BRIEF_FIELDS.filter((candidate) => next.has(candidate))
    })
  }

  const importHandoffPayload = () => {
    if (importPreview?.status !== 'imported' || !importPreviewDiff) {
      showSnackbar({
        message: t({ ko: '브리프 JSON을 가져오지 못했어. 스키마와 local-only 경계를 확인해줘.', en: 'Could not import the brief JSON. Check its schema and local-only boundary.' }),
        tone: 'error',
      })
      return
    }

    if (selectedChangedImportFieldCount === 0) {
      showSnackbar({
        message: t({ ko: '선택한 변경 필드가 없어 로컬 초안을 바꾸지 않았어.', en: 'No selected changed fields, so the local draft was not changed.' }),
        tone: 'info',
      })
      return
    }

    const nextDraft = buildGenerationBriefSelectiveImportDraft(draft, importPreview.draft, selectedImportFields)
    setRecoveryCheckpoint(saveGenerationBriefRecoveryCheckpoint(draft, 'import-restore'))
    const importedDraft = persistGenerationBriefDraft(nextDraft)
    setDraft(importedDraft)
    setImportPayload('')
    showSnackbar({ message: t({ ko: '선택한 필드만 로컬 초안으로 복원했어.', en: 'Restored the selected fields into the local draft.' }), tone: 'info' })
  }

  const statusLabel = summary.status === 'review-ready'
    ? t({ ko: '검토 준비', en: 'Review ready' })
    : summary.status === 'drafting'
      ? t({ ko: '작성 중', en: 'Drafting' })
      : t({ ko: '빈 브리프', en: 'Empty brief' })

  return (
    <PageSection
      data-generation-brief-workspace="true"
      data-generation-brief-boundary="local-only"
      title={t({ ko: '생성 브리프', en: 'Generation brief' })}
      description={t({
        ko: '생성 버튼을 누르기 전에 의도, 참고 자료, 재사용할 자산, 검토 메모를 로컬로 모아. provider 호출이나 queue 등록은 하지 않아.',
        en: 'Collect intent, references, reusable assets, and review notes locally before pressing generate. This does not call providers or enqueue work.',
      })}
      actions={(
        <>
          <Badge variant={getSummaryStatusTone(summary.status)}>{statusLabel}</Badge>
          <Badge variant="outline">{t({ ko: 'local draft only', en: 'local draft only' })}</Badge>
          <Button type="button" size="sm" variant="secondary" onClick={saveCurrentDraft}>
            <Save className="h-4 w-4" />
            {t({ ko: '로컬 저장', en: 'Save local' })}
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={resetDraft} aria-label={t({ ko: '브리프 초기화', en: 'Reset brief' })} title={t({ ko: '브리프 초기화', en: 'Reset brief' })}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </>
      )}
    >
      <div className="grid gap-3 min-[1000px]:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="space-y-3">
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t({ ko: '생성 의도', en: 'Generation intent' })}</span>
            <Input
              data-generation-brief-field="intent"
              value={draft.intent}
              onChange={(event) => updateDraft({ intent: event.target.value })}
              placeholder={t({ ko: '예: 검은 배경의 세로형 캐릭터 컷, 강한 림라이트', en: 'Example: vertical character cut on a dark background with strong rim light' })}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t({ ko: '참고 자료', en: 'Source references' })}</span>
            <Textarea
              data-generation-brief-field="sourceReferences"
              className="min-h-20 resize-y"
              value={draft.sourceReferences}
              onChange={(event) => updateDraft({ sourceReferences: event.target.value })}
              placeholder={t({ ko: '이미지 URL, 기존 결과 ID, 프롬프트 조각, 분위기 참고를 적어둬.', en: 'Save image URLs, prior result IDs, prompt fragments, or mood references.' })}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t({ ko: '검토 메모', en: 'Review notes' })}</span>
            <Textarea
              data-generation-brief-field="reviewNotes"
              className="min-h-20 resize-y"
              value={draft.reviewNotes}
              onChange={(event) => updateDraft({ reviewNotes: event.target.value })}
              placeholder={t({ ko: '다음 실행 전 확인할 금지 요소, 구도, 스타일, 실패 조건을 적어.', en: 'Note exclusions, composition, style, or failure conditions to review before the next run.' })}
            />
          </label>
        </div>

        <div className="space-y-3">
          <PageInset data-generation-brief-target="true" className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ClipboardList className="h-4 w-4 text-primary" />
              {t({ ko: '대상 흐름', en: 'Target flow' })}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 min-[1000px]:grid-cols-1">
              {TARGET_OPTIONS.map((option) => {
                const selected = draft.target === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-generation-brief-target-option={option.value}
                    className={cn(
                      'rounded-sm border border-border/70 bg-surface-container/35 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10',
                      selected && 'border-primary/60 bg-primary/10',
                    )}
                    onClick={() => updateDraft({ target: option.value })}
                  >
                    <span className="block text-sm font-semibold text-foreground">{t(option.label)}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(option.description)}</span>
                  </button>
                )
              })}
            </div>
          </PageInset>

          {showNaiReuseCards ? (
            <PageInset data-generation-brief-nai-reuse-cards="true" className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  {t({ ko: 'NAI 재사용 카드', en: 'NAI reuse cards' })}
                </div>
                <Badge variant="outline">{t({ ko: 'local evidence', en: 'local evidence' })}</Badge>
              </div>
              {naiReuseCards.length > 0 ? (
                <>
                  <div className="grid gap-2">
                    {naiReuseCards.map((card) => (
                      <div key={card.kind} data-generation-brief-nai-reuse-card={card.kind} className="rounded-sm border border-border/70 bg-surface-container/35 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-foreground">{card.title}</div>
                          <Badge variant={getNaiReuseCardStatusTone(card.status)}>{t(getNaiReuseCardStatusLabel(card.status))}</Badge>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.summary}</p>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                          {card.evidence.slice(0, 3).map((item) => (
                            <li key={item} className="break-words">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <Button type="button" size="sm" variant="outline" data-generation-brief-nai-reuse-apply="true" onClick={applyNaiReuseCards}>
                    {t({ ko: '브리프에 추가', en: 'Add to brief' })}
                  </Button>
                </>
              ) : (
                <p data-generation-brief-nai-reuse-empty="true" className="text-xs leading-5 text-muted-foreground">
                  {t({ ko: 'NAI 편집기에서 현재 초안을 읽으면 프롬프트, 캐릭터 Reference, Vibe, 소스 이미지, 모델, 비용/상태 카드가 여기에 나타나.', en: 'When the NAI editor provides its current draft, prompt, character reference, Vibe, source image, model, and cost/status cards appear here.' })}
                </p>
              )}
            </PageInset>
          ) : null}

          {showComfyCompatibilityCards ? (
            <PageInset data-generation-brief-comfy-compatibility-summary="true" className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  {t({ ko: 'Comfy 호환성 요약', en: 'Comfy compatibility summary' })}
                </div>
                <Badge variant="outline">{t({ ko: 'no execution', en: 'no execution' })}</Badge>
              </div>
              {comfyCompatibilityCards.length > 0 ? (
                <>
                  <div className="grid gap-2">
                    {comfyCompatibilityCards.map((card) => (
                      <div key={card.kind} data-generation-brief-comfy-compatibility-card={card.kind} className="rounded-sm border border-border/70 bg-surface-container/35 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-foreground">{card.title}</div>
                          <Badge variant={getComfyCompatibilityCardStatusTone(card.status)}>{t(getComfyCompatibilityCardStatusLabel(card.status))}</Badge>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.summary}</p>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                          {card.evidence.slice(0, 3).map((item) => (
                            <li key={item} className="break-words">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <Button type="button" size="sm" variant="outline" data-generation-brief-comfy-compatibility-apply="true" onClick={applyComfyCompatibilitySummary}>
                    {t({ ko: '브리프에 추가', en: 'Add to brief' })}
                  </Button>
                </>
              ) : (
                <p data-generation-brief-comfy-compatibility-empty="true" className="text-xs leading-5 text-muted-foreground">
                  {t({ ko: 'Comfy 워크플로우를 선택하면 저장된 marked field, 선택 타겟, 서버 준비 상태, 누락 입력 경고가 provider 실행 없이 여기에 나타나.', en: 'Select a Comfy workflow to show saved marked fields, target choice, server readiness, and missing-input warnings here without executing a provider.' })}
                </p>
              )}
            </PageInset>
          ) : null}

          {iterationHandoffSnapshot ? (
            <PageInset data-generation-brief-iteration-handoff="true" className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  {t({ ko: '반복 핸드오프 패킷', en: 'Iteration handoff packet' })}
                </div>
                <Badge variant="outline">{t({ ko: 'local packet', en: 'local packet' })}</Badge>
              </div>
              <div className="grid gap-2">
                {iterationHandoffCards.map((card) => (
                  <div key={card.kind} data-generation-brief-iteration-handoff-card={card.kind} className="rounded-sm border border-border/70 bg-surface-container/35 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-foreground">{card.title}</div>
                      <Badge variant={getIterationHandoffCardStatusTone(card.status)}>{t(getIterationHandoffCardStatusLabel(card.status))}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.summary}</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      {card.evidence.slice(0, 3).map((item) => (
                        <li key={item} className="break-words">• {item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" data-generation-brief-iteration-handoff-apply="true" onClick={applyIterationHandoffPacket}>
                {t({ ko: '브리프에 추가', en: 'Add to brief' })}
              </Button>
            </PageInset>
          ) : null}

          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t({ ko: '재사용 자산', en: 'Reusable assets' })}</span>
            <Textarea
              data-generation-brief-field="reusableAssets"
              className="min-h-24 resize-y"
              value={draft.reusableAssets}
              onChange={(event) => updateDraft({ reusableAssets: event.target.value })}
              placeholder={t({ ko: 'NAI 캐릭터/Vibe, Comfy workflow, LoRA, seed, 서버/모델 후보를 로컬 메모로 남겨.', en: 'List NAI characters/Vibes, Comfy workflows, LoRAs, seeds, server/model candidates as local notes.' })}
            />
          </label>

          <PageInset data-generation-brief-summary="true" className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{t({ ko: '검토 상태', en: 'Review state' })}</span>
              <Badge variant="secondary">
                {t({ ko: '외부 실행 0', en: '0 external actions' })}
              </Badge>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              {t(
                { ko: '작성 {count}/5 · 누락 {missing} · 경계 {boundary}', en: 'Filled {count}/5 · missing {missing} · boundary {boundary}' },
                { count: summary.filledFieldCount, missing: summary.missingFields.length, boundary: summary.sideEffectBoundary },
              )}
            </div>
          </PageInset>

          <PageInset data-generation-brief-save-status="true" className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{t({ ko: '로컬 저장 상태', en: 'Local save status' })}</span>
              <Badge variant="outline">{t({ ko: 'browser storage', en: 'browser storage' })}</Badge>
            </div>
            {saveMetadata ? (
              <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
                <span data-generation-brief-saved-at="true">{t({ ko: '저장 시각', en: 'Saved at' })}: {saveMetadata.savedAt}</span>
                <span>
                  {t(
                    { ko: '저장된 상태 {status} · 작성 {count}/5', en: 'Saved status {status} · filled {count}/5' },
                    { status: t(getSaveMetadataStatusLabel(saveMetadata.summary.status)), count: saveMetadata.filledFieldCount },
                  )}
                </span>
                <span data-generation-brief-save-boundary="true">
                  {t({ ko: '경계', en: 'Boundary' })}: {saveMetadata.sideEffectBoundary} · {t({ ko: '외부 실행', en: 'External actions' })}: {String(saveMetadata.externalActionsExecuted)}
                </span>
              </div>
            ) : (
              <p data-generation-brief-save-empty="true" className="text-xs leading-5 text-muted-foreground">
                {t({ ko: '아직 로컬 저장 증거가 없어. 입력하거나 로컬 저장을 누르면 브라우저 안에 저장 시각과 local-only 경계를 남겨.', en: 'No local save evidence yet. Editing or pressing Save local records the saved time and local-only boundary in the browser.' })}
              </p>
            )}
          </PageInset>

          <PageInset data-generation-brief-history="true" className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <History className="h-4 w-4 text-primary" />
                {t({ ko: '로컬 저장 히스토리', en: 'Local save history' })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {t({ ko: '최근 {count}개', en: '{count} recent' }, { count: historySnapshots.length })}
                </Badge>
                <Badge variant="outline" data-generation-brief-history-filter-count="true">
                  {t({ ko: '일치 {matched}/{total}', en: 'Matches {matched}/{total}' }, { matched: historyQueryResult.matchedCount, total: historyQueryResult.totalCount })}
                </Badge>
                <Badge variant="outline" data-generation-brief-history-label-count="true">
                  {t({ ko: '라벨 {count}개', en: '{count} label cue(s)' }, { count: historyQueryResult.matchedLabelCount })}
                </Badge>
                {historySnapshots.length > 0 ? (
                  <Button type="button" size="sm" variant="ghost" data-generation-brief-history-clear="true" onClick={clearHistorySnapshots}>
                    <Trash2 className="h-4 w-4" />
                    {t({ ko: '히스토리 비우기', en: 'Clear history' })}
                  </Button>
                ) : null}
              </div>
            </div>
            {historyComparisonBaseSnapshot ? (
              <div data-generation-brief-history-comparison-base="true" className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border/70 bg-surface-container/35 p-2 text-xs leading-5 text-muted-foreground">
                <span>
                  {t({ ko: '비교 기준', en: 'Comparison baseline' })}: {historyComparisonBaseSnapshot.savedAt} · {historyComparisonBaseSnapshot.draft.target} · {historyComparisonBaseSnapshot.filledFieldCount}/5
                </span>
                <Button type="button" size="sm" variant="ghost" data-generation-brief-history-comparison-clear="true" onClick={() => setHistoryComparisonBaseSnapshotId('')}>
                  {t({ ko: '기준 해제', en: 'Clear baseline' })}
                </Button>
              </div>
            ) : null}
            {historyEvolutionSummary.transitionCount > 0 ? (
              <div data-generation-brief-history-evolution-summary="true" className="space-y-2 rounded-sm border border-border/70 bg-surface-container/35 p-2 text-xs leading-5 text-muted-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{t({ ko: '히스토리 흐름 요약', en: 'History evolution summary' })}</span>
                  <Badge variant="outline">
                    {t({ ko: '전환 {count}회', en: '{count} transition(s)' }, { count: historyEvolutionSummary.transitionCount })}
                  </Badge>
                </div>
                <div>
                  {t(
                    { ko: '스냅샷 {snapshots}개 · 필드 변경 {changes}건 · 바뀐 필드 {fields}개 · 대상 변경 {targets}회', en: '{snapshots} snapshots · {changes} field change(s) · {fields} changed field(s) · {targets} target change(s)' },
                    {
                      snapshots: historyEvolutionSummary.snapshotCount,
                      changes: historyEvolutionSummary.totalChangedFieldCount,
                      fields: historyEvolutionSummary.changedFieldCount,
                      targets: historyEvolutionSummary.targetChangeCount,
                    },
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {historyEvolutionChangedFields.slice(0, 5).map((field) => (
                    <Badge key={field.field} variant="secondary" data-generation-brief-history-evolution-field={field.field}>
                      {field.label}: {field.changedCount}
                    </Badge>
                  ))}
                </div>
                <div className="grid gap-1">
                  {recentHistoryEvolutionTransitions.map((transition) => (
                    <div key={`${transition.fromSnapshotId}:${transition.toSnapshotId}`} data-generation-brief-history-evolution-transition={transition.toSnapshotId} className="rounded-sm border border-border/50 bg-background/60 px-2 py-1">
                      <div>
                        {transition.fromSavedAt} → {transition.toSavedAt}: {t({ ko: '변경', en: 'changes' })} {transition.changedCount} · {t({ ko: '대상 변경', en: 'target changed' })} {String(transition.targetChanged)}
                      </div>
                      {transition.labels.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {transition.labels.slice(0, 4).map((label) => (
                            <Badge key={`${transition.toSnapshotId}:${label.kind}`} variant="secondary" data-generation-brief-history-evolution-transition-label={label.kind} title={label.summary}>
                              {label.label}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {historySnapshots.length > 0 ? (
              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t({ ko: '히스토리 찾기', en: 'Find history' })}</span>
                <Input
                  data-generation-brief-history-filter="true"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder={t({ ko: '의도, 대상, 상태, 메모, 전환 라벨(target-pivot, Filled gaps)로 찾아.', en: 'Search intent, target, status, notes, or transition labels like target-pivot and Filled gaps.' })}
                />
                <span data-generation-brief-history-filter-help="true" className="block text-xs leading-5 text-muted-foreground">
                  {t({ ko: '전환 라벨과 decision category도 검색에 포함돼. 예: Target pivot, Filled gaps, multi-field revision.', en: 'Transition labels and decision categories are searchable too: Target pivot, Filled gaps, multi-field revision.' })}
                </span>
              </label>
            ) : null}
            {historySnapshots.length > 0 ? (
              filteredHistorySnapshots.length > 0 ? (
                <div className="grid gap-2">
                  {filteredHistorySnapshots.map((snapshot) => {
                    const restoreComparison = buildGenerationBriefHistoryRestoreComparison(draft, snapshot)
                    const changedFields = restoreComparison.fields.filter((field) => field.status !== 'unchanged')
                    const snapshotComparison = historyComparisonBaseSnapshot && historyComparisonBaseSnapshot.id !== snapshot.id
                      ? buildGenerationBriefHistorySnapshotComparison(historyComparisonBaseSnapshot, snapshot)
                      : null
                    const snapshotComparisonChangedFields = snapshotComparison?.fields.filter((field) => field.status !== 'unchanged') ?? []
                    const discoveryLabels = historyDiscoveryLabelsBySnapshot.get(snapshot.id) ?? []
                    const isComparisonBaseSnapshot = historyComparisonBaseSnapshot?.id === snapshot.id
                    return (
                      <div key={snapshot.id} data-generation-brief-history-snapshot={snapshot.id} className="rounded-sm border border-border/70 bg-surface-container/35 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
                            <span className="font-medium text-foreground">{t({ ko: '저장 시각', en: 'Saved at' })}: {snapshot.savedAt}</span>
                            <span>
                              {t(
                                { ko: '상태 {status} · 작성 {count}/5', en: 'Status {status} · filled {count}/5' },
                                { status: t(getSaveMetadataStatusLabel(snapshot.summary.status)), count: snapshot.filledFieldCount },
                              )}
                            </span>
                            <span>{t({ ko: '대상', en: 'Target' })}: {snapshot.draft.target}</span>
                            <span>{t({ ko: '경계', en: 'Boundary' })}: {snapshot.sideEffectBoundary} · {t({ ko: '외부 실행', en: 'External actions' })}: {String(snapshot.externalActionsExecuted)}</span>
                            <span data-generation-brief-history-restore-comparison-summary={snapshot.id}>
                              {t(
                                { ko: '복원 변경 {changed}/{total} · 추가 {filled} · 비움 {cleared}', en: 'Restore changes {changed}/{total} · fills {filled} · clears {cleared}' },
                                {
                                  changed: restoreComparison.changedCount,
                                  total: restoreComparison.fieldCount,
                                  filled: restoreComparison.filledCount,
                                  cleared: restoreComparison.clearedCount,
                                },
                              )}
                            </span>
                            {snapshotComparison ? (
                              <span data-generation-brief-history-snapshot-comparison-summary={snapshot.id}>
                                {t(
                                  { ko: '기준 대비 변경 {changed}/{total} · 추가 {filled} · 비움 {cleared}', en: 'Baseline changes {changed}/{total} · fills {filled} · clears {cleared}' },
                                  {
                                    changed: snapshotComparison.changedCount,
                                    total: snapshotComparison.fieldCount,
                                    filled: snapshotComparison.filledCount,
                                    cleared: snapshotComparison.clearedCount,
                                  },
                                )}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant={isComparisonBaseSnapshot ? 'secondary' : 'outline'} data-generation-brief-history-comparison-select={snapshot.id} onClick={() => setHistoryComparisonBaseSnapshotId(isComparisonBaseSnapshot ? '' : snapshot.id)}>
                              {isComparisonBaseSnapshot ? t({ ko: '기준 해제', en: 'Clear base' }) : t({ ko: '비교 기준', en: 'Compare base' })}
                            </Button>
                            <Button type="button" size="sm" variant="outline" data-generation-brief-history-restore={snapshot.id} onClick={() => restoreHistorySnapshot(snapshot)}>
                              {t({ ko: '복원', en: 'Restore' })}
                            </Button>
                            <Button type="button" size="icon-sm" variant="ghost" data-generation-brief-history-remove={snapshot.id} onClick={() => removeHistorySnapshot(snapshot)} aria-label={t({ ko: '히스토리 스냅샷 삭제', en: 'Remove history snapshot' })} title={t({ ko: '히스토리 스냅샷 삭제', en: 'Remove history snapshot' })}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {discoveryLabels.length > 0 ? (
                          <div data-generation-brief-history-discovery-labels={snapshot.id} className="mt-3 flex flex-wrap gap-1 text-xs">
                            {discoveryLabels.slice(0, 5).map((label) => (
                              <Badge key={`${snapshot.id}:${label.fromSnapshotId}:${label.kind}`} variant="secondary" data-generation-brief-history-discovery-label={label.kind} title={label.summary}>
                                {label.label}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        <div data-generation-brief-history-restore-comparison={snapshot.id} className="mt-3 space-y-2 rounded-sm border border-border/60 bg-background/60 p-2 text-xs leading-5 text-muted-foreground">
                          {restoreComparison.wouldChange ? (
                            <>
                              <div className="font-medium text-foreground">{t({ ko: '복원 영향 미리보기', en: 'Restore impact preview' })}</div>
                              <div className="grid gap-1">
                                {changedFields.slice(0, 3).map((field) => (
                                  <div key={field.field} data-generation-brief-history-restore-field={field.field} className="rounded-sm border border-border/50 bg-surface-container/25 p-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-medium text-foreground">{field.label}</span>
                                      <Badge variant={getImportDiffStatusTone(field.status)}>{t(getImportDiffStatusLabel(field.status))}</Badge>
                                    </div>
                                    <div className="mt-1 grid gap-1">
                                      <span>{t({ ko: '현재', en: 'Current' })}: {field.currentPreview}</span>
                                      <span>{t({ ko: '스냅샷', en: 'Snapshot' })}: {field.snapshotPreview}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {changedFields.length > 3 ? (
                                <div>{t({ ko: '추가 변경 필드 {count}개', en: '{count} more changed field(s)' }, { count: changedFields.length - 3 })}</div>
                              ) : null}
                            </>
                          ) : (
                            <div data-generation-brief-history-restore-noop="true">
                              {t({ ko: '현재 초안과 같은 스냅샷이야. 복원해도 필드 값은 바뀌지 않아.', en: 'This snapshot matches the current draft. Restoring it will not change field values.' })}
                            </div>
                          )}
                        </div>
                        {isComparisonBaseSnapshot ? (
                          <div data-generation-brief-history-snapshot-comparison-base-marker="true" className="mt-3 rounded-sm border border-border/60 bg-background/60 p-2 text-xs leading-5 text-muted-foreground">
                            {t({ ko: '이 스냅샷이 기준이야. 다른 스냅샷에서 기준 대비 변경점을 볼 수 있어.', en: 'This snapshot is the comparison baseline. Other snapshots show differences against it.' })}
                          </div>
                        ) : snapshotComparison ? (
                          <div data-generation-brief-history-snapshot-comparison={snapshot.id} className="mt-3 space-y-2 rounded-sm border border-border/60 bg-background/60 p-2 text-xs leading-5 text-muted-foreground">
                            {snapshotComparison.wouldChange ? (
                              <>
                                <div className="font-medium text-foreground">{t({ ko: '기준 대비 변경 미리보기', en: 'Baseline difference preview' })}</div>
                                <div className="grid gap-1">
                                  {snapshotComparisonChangedFields.slice(0, 3).map((field) => (
                                    <div key={field.field} data-generation-brief-history-snapshot-comparison-field={field.field} className="rounded-sm border border-border/50 bg-surface-container/25 p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium text-foreground">{field.label}</span>
                                        <Badge variant={getImportDiffStatusTone(field.status)}>{t(getImportDiffStatusLabel(field.status))}</Badge>
                                      </div>
                                      <div className="mt-1 grid gap-1">
                                        <span>{t({ ko: '기준', en: 'Baseline' })}: {field.basePreview}</span>
                                        <span>{t({ ko: '스냅샷', en: 'Snapshot' })}: {field.snapshotPreview}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {snapshotComparisonChangedFields.length > 3 ? (
                                  <div>{t({ ko: '추가 기준 대비 변경 필드 {count}개', en: '{count} more baseline difference field(s)' }, { count: snapshotComparisonChangedFields.length - 3 })}</div>
                                ) : null}
                              </>
                            ) : (
                              <div data-generation-brief-history-snapshot-comparison-noop="true">
                                {t({ ko: '비교 기준과 같은 스냅샷이야. 저장된 필드 값 차이는 없어.', en: 'This snapshot matches the comparison baseline. Saved field values do not differ.' })}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p data-generation-brief-history-filter-empty="true" className="text-xs leading-5 text-muted-foreground">
                  {t({ ko: '일치하는 로컬 히스토리 스냅샷이 없어. 검색어를 줄이면 다시 보여.', en: 'No local history snapshots match. Shorten the query to show them again.' })}
                </p>
              )
            ) : (
              <p data-generation-brief-history-empty="true" className="text-xs leading-5 text-muted-foreground">
                {t({ ko: '아직 수동 저장 스냅샷이 없어. 로컬 저장을 누르면 최근 브리프를 브라우저 안에 보관해.', en: 'No manual save snapshots yet. Press Save local to keep recent briefs inside the browser.' })}
              </p>
            )}
          </PageInset>

          <PageInset data-generation-brief-recovery-checkpoint="true" className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{t({ ko: '복구 체크포인트', en: 'Recovery checkpoint' })}</span>
              <Badge variant="outline">{t({ ko: 'local only', en: 'local only' })}</Badge>
            </div>
            {recoveryCheckpoint ? (
              <>
                <div data-generation-brief-recovery-checkpoint-summary="true" className="grid gap-1 text-xs leading-5 text-muted-foreground">
                  <span>{t({ ko: '저장 사유', en: 'Saved reason' })}: {t(getRecoveryCheckpointReasonLabel(recoveryCheckpoint.reason))}</span>
                  <span>{t({ ko: '저장 시각', en: 'Saved at' })}: {recoveryCheckpoint.createdAt}</span>
                  <span>
                    {t(
                      { ko: '작성 {count}/5 · 상태 {status} · 경계 {boundary}', en: 'Filled {count}/5 · status {status} · boundary {boundary}' },
                      {
                        count: recoveryCheckpoint.summary.filledFieldCount,
                        status: recoveryCheckpoint.summary.status,
                        boundary: recoveryCheckpoint.sideEffectBoundary,
                      },
                    )}
                  </span>
                  <span>{t({ ko: '외부 실행', en: 'External actions' })}: {String(recoveryCheckpoint.externalActionsExecuted)}</span>
                </div>
                <Button type="button" size="sm" variant="outline" data-generation-brief-recovery-restore="true" onClick={restoreRecoveryCheckpoint}>
                  {t({ ko: '체크포인트 복원', en: 'Restore checkpoint' })}
                </Button>
              </>
            ) : (
              <p data-generation-brief-recovery-empty="true" className="text-xs leading-5 text-muted-foreground">
                {t({ ko: '초기화나 JSON 가져오기 전에 이전 로컬 초안이 있으면 여기에 한 번만 보관해. provider 호출이나 queue 등록은 없어.', en: 'When reset or JSON import replaces a non-empty local draft, the previous draft is kept here once. No provider calls or queue enqueueing.' })}
              </p>
            )}
          </PageInset>

          <PageInset data-generation-brief-readiness-gate="true" className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{t({ ko: '준비 게이트', en: 'Readiness gate' })}</span>
              <Badge variant={getReadinessGateStatusTone(readinessGate.status)}>{t(getReadinessGateStatusLabel(readinessGate.status))}</Badge>
            </div>
            <div data-generation-brief-readiness-gate-summary="true" className="text-xs leading-5 text-muted-foreground">
              {t(
                { ko: '준비 {ready}/{total} · 누락 {missing} · 검토 {review} · 경계 {boundary}', en: 'Ready {ready}/{total} · missing {missing} · review {review} · boundary {boundary}' },
                {
                  ready: readinessGate.readyCount,
                  total: readinessGate.itemCount,
                  missing: readinessGate.missingCount,
                  review: readinessGate.warningCount,
                  boundary: readinessGate.sideEffectBoundary,
                },
              )}
            </div>
            <div className="grid gap-2">
              {readinessGate.items.map((item) => (
                <div key={item.kind} data-generation-brief-readiness-gate-item={item.kind} className="rounded-sm border border-border/70 bg-surface-container/35 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-foreground">{item.title}</div>
                    <Badge variant={getReadinessGateItemStatusTone(item.status)}>{t(getReadinessGateItemStatusLabel(item.status))}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {item.evidence.slice(0, 2).map((evidence) => (
                      <li key={evidence} className="break-words">• {evidence}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </PageInset>

          <PageInset data-generation-brief-handoff="true" className="space-y-3 text-sm">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <FileUp className="h-4 w-4 text-primary" />
              {t({ ko: '검토 핸드오프', en: 'Review handoff' })}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t({
                ko: '검토문 복사와 JSON 내려받기/가져오기는 브라우저 안에서만 처리해. provider 호출, queue 등록, 업로드는 없어.',
                en: 'Copying review text and downloading/importing JSON happen in the browser only. No provider calls, queue enqueueing, or uploads.',
              })}
            </p>
            {historyInsightCards.length > 0 ? (
              <div data-generation-brief-history-review-handoff="true" className="space-y-2 rounded-sm border border-border/70 bg-surface-container/35 p-3 text-xs leading-5 text-muted-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{t({ ko: '히스토리 인사이트 포함', en: 'History insights included' })}</span>
                  <Badge variant="outline" data-generation-brief-history-review-handoff-count="true">
                    {t({ ko: '{count}개 카드', en: '{count} card(s)' }, { count: historyInsightCards.length })}
                  </Badge>
                </div>
                <div className="grid gap-2">
                  {historyInsightCards.map((card) => (
                    <div key={card.kind} data-generation-brief-history-review-handoff-card={card.kind} className="rounded-sm border border-border/50 bg-background/60 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{card.title}</span>
                        <Badge variant={getHistoryInsightCardStatusTone(card.status)}>{t(getHistoryInsightCardStatusLabel(card.status))}</Badge>
                      </div>
                      <p className="mt-1">{card.summary}</p>
                      <ul className="mt-2 space-y-1">
                        {card.evidence.slice(0, 3).map((item) => (
                          <li key={item} className="break-words">• {item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" data-generation-brief-copy-review="true" onClick={() => void copyReviewPacket()}>
                <ClipboardCopy className="h-4 w-4" />
                {t({ ko: '검토문 복사', en: 'Copy review' })}
              </Button>
              <Button type="button" size="sm" variant="outline" data-generation-brief-export-json="true" onClick={downloadHandoffPayload}>
                <Download className="h-4 w-4" />
                {t({ ko: 'JSON 내려받기', en: 'Download JSON' })}
              </Button>
            </div>
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t({ ko: 'JSON 가져오기', en: 'Import JSON' })}</span>
              <Textarea
                data-generation-brief-import-payload="true"
                className="min-h-20 resize-y font-mono text-xs"
                value={importPayload}
                onChange={(event) => setImportPayload(event.target.value)}
                placeholder={t({ ko: '내려받은 conai-generation-brief-*.json 내용을 붙여넣어.', en: 'Paste the downloaded conai-generation-brief-*.json contents.' })}
              />
            </label>
            {importPayload.trim() ? (
              <PageInset data-generation-brief-import-preview="true" className="space-y-2 border-dashed text-xs">
                {importPreview?.status === 'imported' && importPreviewReadinessGate && importPreviewTargetLabel && importPreviewDiff ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{t({ ko: '가져오기 미리보기', en: 'Import preview' })}</span>
                      <Badge variant={getSummaryStatusTone(importPreview.summary.status)}>
                        {importPreview.summary.status === 'review-ready'
                          ? t({ ko: '검토 준비', en: 'Review ready' })
                          : importPreview.summary.status === 'drafting'
                            ? t({ ko: '작성 중', en: 'Drafting' })
                            : t({ ko: '빈 브리프', en: 'Empty brief' })}
                      </Badge>
                    </div>
                    <div data-generation-brief-import-preview-summary="true" className="grid gap-1 leading-5 text-muted-foreground">
                      <span>{t({ ko: '대상', en: 'Target' })}: {t(importPreviewTargetLabel)}</span>
                      <span>{t({ ko: '준비 게이트', en: 'Readiness gate' })}: {t(getReadinessGateStatusLabel(importPreviewReadinessGate.status))}</span>
                      <span>
                        {t(
                          { ko: '준비 {ready}/{total} · 누락 {missing} · 검토 {review}', en: 'Ready {ready}/{total} · missing {missing} · review {review}' },
                          {
                            ready: importPreviewReadinessGate.readyCount,
                            total: importPreviewReadinessGate.itemCount,
                            missing: importPreviewReadinessGate.missingCount,
                            review: importPreviewReadinessGate.warningCount,
                          },
                        )}
                      </span>
                      <span>{t({ ko: '경계', en: 'Boundary' })}: {importPreview.summary.sideEffectBoundary}</span>
                      <span data-generation-brief-import-history-insight-count="true">
                        {t({ ko: '가져온 히스토리 인사이트 {count}개', en: 'Imported history insights: {count}' }, { count: importPreviewHistoryInsights.length })}
                      </span>
                    </div>
                    {importPreviewHistoryInsights.length > 0 ? (
                      <div data-generation-brief-import-history-insights="true" className="space-y-2 rounded-sm border border-border/70 bg-surface-container/35 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{t({ ko: '가져온 히스토리 인사이트', en: 'Imported history insights' })}</span>
                          <Badge variant="outline">
                            {t({ ko: '{count}개 카드', en: '{count} card(s)' }, { count: importPreviewHistoryInsights.length })}
                          </Badge>
                        </div>
                        <div className="grid gap-2">
                          {importPreviewHistoryInsights.map((card, index) => (
                            <div key={`${card.kind}:${card.title}:${index}`} data-generation-brief-import-history-insight-card={card.kind} className="rounded-sm border border-border/60 bg-background/60 p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{card.title}</span>
                                <Badge variant={getHistoryInsightCardStatusTone(card.status)}>{t(getHistoryInsightCardStatusLabel(card.status))}</Badge>
                              </div>
                              <p className="mt-1 leading-5 text-muted-foreground">{card.summary}</p>
                              <ul className="mt-2 space-y-1 leading-5 text-muted-foreground">
                                {card.evidence.slice(0, 3).map((item) => (
                                  <li key={item} className="break-words">• {item}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div data-generation-brief-import-diff="true" className="space-y-2 rounded-sm border border-border/70 bg-surface-container/35 p-2">
                      <div className="font-medium text-foreground">
                        {t(
                          { ko: '덮어쓰기 변경 {changed}/5 · 유지 {unchanged} · 추가 {filled} · 비움 {cleared}', en: 'Overwrite changes {changed}/5 · unchanged {unchanged} · fills {filled} · clears {cleared}' },
                          {
                            changed: importPreviewDiff.changedCount,
                            unchanged: importPreviewDiff.unchangedCount,
                            filled: importPreviewDiff.filledCount,
                            cleared: importPreviewDiff.clearedCount,
                          },
                        )}
                      </div>
                      <div className="grid gap-1">
                        {importPreviewDiff.fields.filter((field) => field.status !== 'unchanged').map((field) => (
                          <div key={field.field} data-generation-brief-import-diff-field={field.field} className="rounded-sm border border-border/60 bg-background/60 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{field.label}</span>
                              <Badge variant={getImportDiffStatusTone(field.status)}>{t(getImportDiffStatusLabel(field.status))}</Badge>
                            </div>
                            <div className="mt-1 grid gap-1 text-muted-foreground">
                              <span>{t({ ko: '현재', en: 'Current' })}: {field.currentPreview}</span>
                              <span>{t({ ko: '가져올 값', en: 'Incoming' })}: {field.importedPreview}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div data-generation-brief-import-field-selection="true" className="space-y-2 rounded-sm border border-border/60 bg-background/60 p-2">
                        <div className="font-medium text-foreground">
                          {t(
                            { ko: '복원할 필드 {selected}/{total}', en: 'Fields to restore {selected}/{total}' },
                            { selected: selectedImportFieldCount, total: importPreviewDiff.fields.length },
                          )}
                        </div>
                        <div data-generation-brief-import-selected-change-count="true" className="text-muted-foreground">
                          {t(
                            { ko: '실제 적용 변경 {selectedChanged}/{changed}', en: 'Selected changes {selectedChanged}/{changed}' },
                            { selectedChanged: selectedChangedImportFieldCount, changed: importPreviewDiff.changedCount },
                          )}
                        </div>
                        {selectedChangedImportFieldCount === 0 ? (
                          <div data-generation-brief-import-noop-guard="true" className="text-muted-foreground">
                            {t({ ko: '변경되는 필드를 하나 이상 선택해야 로컬 초안을 복원해.', en: 'Select at least one changed field before restoring the local draft.' })}
                          </div>
                        ) : null}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {importPreviewDiff.fields.map((field) => (
                            <label key={field.field} className="flex items-start gap-2 rounded-sm border border-border/50 bg-surface-container/25 p-2 text-muted-foreground">
                              <input
                                type="checkbox"
                                data-generation-brief-import-field-select={field.field}
                                className="mt-0.5"
                                checked={selectedImportFieldSet.has(field.field)}
                                onChange={(event) => toggleImportFieldSelection(field.field, event.target.checked)}
                              />
                              <span className="grid gap-1">
                                <span className="font-medium text-foreground">{field.label}</span>
                                <span>{t(getImportDiffStatusLabel(field.status))}: {field.importedPreview}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      {importPreviewDiff.changedCount === 0 ? (
                        <div data-generation-brief-import-diff-empty="true" className="text-muted-foreground">
                          {t({ ko: '현재 초안과 같은 내용이야. 복원해도 필드 값은 바뀌지 않아.', en: 'This matches the current draft. Restoring will not change field values.' })}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div data-generation-brief-import-preview-error="true" className="space-y-1 text-muted-foreground">
                    <div className="font-semibold text-foreground">{t({ ko: '가져오기 전 확인 필요', en: 'Import needs review' })}</div>
                    <div>
                      {t({ ko: '사유', en: 'Reason' })}: {importPreview?.status === 'rejected'
                        ? t(getImportRejectionLabel(importPreview.reason))
                        : t(getImportRejectionLabel('empty'))}
                    </div>
                    <div>{t({ ko: '현재 로컬 초안은 바꾸지 않았어.', en: 'The current local draft was not changed.' })}</div>
                  </div>
                )}
              </PageInset>
            ) : null}
            <Button type="button" size="sm" variant="outline" data-generation-brief-import-apply="true" disabled={!canApplyImport} onClick={importHandoffPayload}>
              {t({ ko: '로컬 초안으로 복원', en: 'Restore as local draft' })}
            </Button>
          </PageInset>
        </div>
      </div>
    </PageSection>
  )
}
