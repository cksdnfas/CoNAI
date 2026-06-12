import { useMemo, useState } from 'react'
import { ClipboardCopy, ClipboardList, Download, FileUp, RotateCcw, Save } from 'lucide-react'
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
  buildGenerationBriefIterationHandoffCards,
  buildGenerationBriefIterationHandoffText,
  buildGenerationBriefNaiReusableAssetsText,
  buildGenerationBriefNaiReuseCards,
  buildGenerationBriefReviewCopy,
  buildGenerationBriefReviewSummary,
  clearGenerationBriefDraft,
  parseGenerationBriefHandoffPayload,
  readGenerationBriefDraft,
  saveGenerationBriefDraft,
  serializeGenerationBriefHandoffPayload,
  type GenerationBriefComfyCompatibilityCardStatus,
  type GenerationBriefComfyCompatibilitySnapshot,
  type GenerationBriefDraft,
  type GenerationBriefIterationHandoffCardStatus,
  type GenerationBriefIterationHandoffSnapshot,
  type GenerationBriefNaiReuseCardStatus,
  type GenerationBriefNaiReuseSnapshot,
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

function appendGenerationBriefNote(current: string, next: string) {
  const currentText = current.trim()
  const nextText = next.trim()

  if (!nextText) return currentText
  if (!currentText) return nextText
  if (currentText.includes(nextText)) return currentText
  return `${currentText}\n\n${nextText}`
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
  const [importPayload, setImportPayload] = useState('')
  const summary = useMemo(() => buildGenerationBriefReviewSummary(draft), [draft])
  const reviewCopy = useMemo(() => buildGenerationBriefReviewCopy(draft), [draft])
  const naiReuseCards = useMemo(() => (naiReuseSnapshot ? buildGenerationBriefNaiReuseCards(naiReuseSnapshot) : []), [naiReuseSnapshot])
  const naiReuseText = useMemo(() => (naiReuseSnapshot ? buildGenerationBriefNaiReusableAssetsText(naiReuseSnapshot) : ''), [naiReuseSnapshot])
  const comfyCompatibilityCards = useMemo(() => (comfyCompatibilitySnapshot ? buildGenerationBriefComfyCompatibilityCards(comfyCompatibilitySnapshot) : []), [comfyCompatibilitySnapshot])
  const comfyCompatibilityText = useMemo(() => (comfyCompatibilitySnapshot ? buildGenerationBriefComfyCompatibilityText(comfyCompatibilitySnapshot) : ''), [comfyCompatibilitySnapshot])
  const iterationHandoffCards = useMemo(() => (iterationHandoffSnapshot ? buildGenerationBriefIterationHandoffCards(iterationHandoffSnapshot) : []), [iterationHandoffSnapshot])
  const iterationHandoffText = useMemo(() => (iterationHandoffSnapshot ? buildGenerationBriefIterationHandoffText(iterationHandoffSnapshot) : ''), [iterationHandoffSnapshot])
  const showNaiReuseCards = activeTarget === 'novelai' || draft.target === 'novelai'
  const showComfyCompatibilityCards = activeTarget === 'comfyui' || draft.target === 'comfyui'

  const updateDraft = (patch: Partial<GenerationBriefDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      saveGenerationBriefDraft(next)
      return next
    })
  }

  const resetDraft = () => {
    setDraft(clearGenerationBriefDraft())
  }

  const applyNaiReuseCards = () => {
    if (!naiReuseText.trim()) {
      return
    }

    setDraft((current) => {
      const next = saveGenerationBriefDraft({
        ...current,
        target: 'novelai',
        reusableAssets: appendGenerationBriefNote(current.reusableAssets, naiReuseText),
      })
      return next
    })
    showSnackbar({ message: t({ ko: 'NAI 재사용 카드를 브리프에 추가했어.', en: 'Added NAI reuse cards to the brief.' }), tone: 'info' })
  }

  const applyComfyCompatibilitySummary = () => {
    if (!comfyCompatibilityText.trim()) {
      return
    }

    setDraft((current) => {
      const next = saveGenerationBriefDraft({
        ...current,
        target: 'comfyui',
        reusableAssets: appendGenerationBriefNote(current.reusableAssets, comfyCompatibilityText),
      })
      return next
    })
    showSnackbar({ message: t({ ko: 'Comfy 호환성 요약을 브리프에 추가했어.', en: 'Added the Comfy compatibility summary to the brief.' }), tone: 'info' })
  }

  const applyIterationHandoffPacket = () => {
    if (!iterationHandoffSnapshot || !iterationHandoffText.trim()) {
      return
    }

    setDraft((current) => {
      const next = saveGenerationBriefDraft({
        ...current,
        target: iterationHandoffSnapshot.target,
        sourceReferences: appendGenerationBriefNote(current.sourceReferences, iterationHandoffText),
      })
      return next
    })
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
    const payload = serializeGenerationBriefHandoffPayload(draft, exportedAt.toISOString())
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    triggerBlobDownload(blob, buildGenerationBriefHandoffFilename(exportedAt))
    showSnackbar({ message: t({ ko: '로컬 브리프 JSON을 내려받았어.', en: 'Downloaded the local brief JSON.' }), tone: 'info' })
  }

  const importHandoffPayload = () => {
    const parsed = parseGenerationBriefHandoffPayload(importPayload)

    if (parsed.status === 'rejected') {
      showSnackbar({
        message: t({ ko: '브리프 JSON을 가져오지 못했어. 스키마와 local-only 경계를 확인해줘.', en: 'Could not import the brief JSON. Check its schema and local-only boundary.' }),
        tone: 'error',
      })
      return
    }

    const importedDraft = saveGenerationBriefDraft(parsed.draft)
    setDraft(importedDraft)
    setImportPayload('')
    showSnackbar({ message: t({ ko: '브리프를 로컬 초안으로 복원했어.', en: 'Restored the brief as a local draft.' }), tone: 'info' })
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
          <Button type="button" size="sm" variant="secondary" onClick={() => saveGenerationBriefDraft(draft)}>
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
            <Button type="button" size="sm" variant="outline" data-generation-brief-import-apply="true" disabled={!importPayload.trim()} onClick={importHandoffPayload}>
              {t({ ko: '로컬 초안으로 복원', en: 'Restore as local draft' })}
            </Button>
          </PageInset>
        </div>
      </div>
    </PageSection>
  )
}
