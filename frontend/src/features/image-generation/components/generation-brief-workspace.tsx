import { useMemo, useState } from 'react'
import { ClipboardList, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  buildGenerationBriefReviewSummary,
  clearGenerationBriefDraft,
  readGenerationBriefDraft,
  saveGenerationBriefDraft,
  type GenerationBriefDraft,
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

interface GenerationBriefWorkspaceProps {
  activeTab: string
}

export function GenerationBriefWorkspace({ activeTab }: GenerationBriefWorkspaceProps) {
  const { t } = useI18n()
  const activeTarget = getTargetFromActiveTab(activeTab)
  const [draft, setDraft] = useState<GenerationBriefDraft>(() => {
    const storedDraft = readGenerationBriefDraft()
    return storedDraft.target === 'undecided' && activeTarget !== 'undecided'
      ? { ...storedDraft, target: activeTarget }
      : storedDraft
  })
  const summary = useMemo(() => buildGenerationBriefReviewSummary(draft), [draft])

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
        </div>
      </div>
    </PageSection>
  )
}
