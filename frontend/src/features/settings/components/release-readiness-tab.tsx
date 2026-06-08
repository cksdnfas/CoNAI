import { useMemo, useState } from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsInsetBlock, SettingsSection, SettingsToggleRow, SettingsValueTile } from './settings-primitives'
import { APP_VERSION_LABEL } from '@/lib/app-metadata'
import { cn } from '@/lib/utils'
import { useI18n, type TranslationDictionary } from '@/i18n'

type ReadinessItem = {
  id: string
  title: TranslationDictionary
  description: TranslationDictionary
}

type EvidenceItem = {
  label: TranslationDictionary
  value: string
  detail: TranslationDictionary
  tone: 'ready' | 'attention' | 'blocked'
}

const REVIEW_ITEMS: ReadinessItem[] = [
  {
    id: 'completed-work',
    title: { ko: '완료 작업 검토', en: 'Completed work reviewed' },
    description: {
      ko: '완료된 변경, 릴리즈 노트, 로컬 결과 상태가 릴리즈 판단 전에 확인됨.',
      en: 'Completed changes, release notes, and local result state are checked before release decisions.',
    },
  },
  {
    id: 'caveats',
    title: { ko: '주의 사항 확인', en: 'Caveats reviewed' },
    description: {
      ko: '미완료 항목, 보호 서비스, 외부 작업 제한이 릴리즈 준비 판단에 포함됨.',
      en: 'Open caveats, protected services, and external-action limits are included in readiness review.',
    },
  },
  {
    id: 'evidence',
    title: { ko: '검증 근거 확인', en: 'Evidence checked' },
    description: {
      ko: '빌드, 문서, Graphify 갱신, 스모크 근거가 커밋 또는 핸드오프 기록과 연결됨.',
      en: 'Build, docs, Graphify refresh, and smoke evidence are tied to commits or handoff notes.',
    },
  },
  {
    id: 'decisions',
    title: { ko: '사용자 결정 분리', en: 'User decisions separated' },
    description: {
      ko: 'push, demo update, restart, destructive cleanup은 실행 버튼이 아니라 승인 항목으로 남음.',
      en: 'Push, demo update, restart, and destructive cleanup stay as approvals, not action buttons.',
    },
  },
]

const EVIDENCE_ITEMS: EvidenceItem[] = [
  {
    label: { ko: '현재 버전', en: 'Current version' },
    value: APP_VERSION_LABEL,
    detail: { ko: '패키지 버전 라벨 기준', en: 'From the package version label' },
    tone: 'ready',
  },
  {
    label: { ko: '릴리즈 점검', en: 'Release check' },
    value: 'npm run verify:release-readiness',
    detail: { ko: '스크립트 alias, docs build, 전체 build 포함', en: 'Includes script aliases, docs build, and full build' },
    tone: 'ready',
  },
  {
    label: { ko: 'Graphify 근거', en: 'Graphify evidence' },
    value: 'python -m graphify update .',
    detail: { ko: '코드 변경 뒤 갱신 필요', en: 'Required after code changes' },
    tone: 'attention',
  },
  {
    label: { ko: '외부 작업', en: 'External actions' },
    value: 'approval-required',
    detail: { ko: 'push, deploy, restart는 별도 승인 필요', en: 'Push, deploy, and restart need separate approval' },
    tone: 'blocked',
  },
]

const REVIEW_LANES: ReadinessItem[] = [
  {
    id: 'local-results',
    title: { ko: '로컬 결과', en: 'Local results' },
    description: {
      ko: '커밋, 변경 요약, 로컬 UI/계약 검증, 문서 빌드 결과를 릴리즈 전 근거로 모음.',
      en: 'Commit, change summary, focused UI/contract checks, and docs build results are collected as release evidence.',
    },
  },
  {
    id: 'caveat-register',
    title: { ko: '주의 사항', en: 'Caveats' },
    description: {
      ko: '미완료 항목, 실패한 검증, 보호 포트 3999, 수동 확인 필요 작업을 릴리즈 판단에서 숨기지 않음.',
      en: 'Open work, failed checks, protected port 3999, and manual checks stay visible for release judgment.',
    },
  },
  {
    id: 'handoff-evidence',
    title: { ko: '핸드오프 근거', en: 'Handoff evidence' },
    description: {
      ko: 'alpha push, demo host update, smoke, rollback 준비에 필요한 파일과 명령을 실행 전 검토 대상으로 둠.',
      en: 'Files and commands for alpha push, demo-host update, smoke, and rollback preparation stay reviewable before execution.',
    },
  },
]

const USER_DECISIONS: ReadinessItem[] = [
  {
    id: 'alpha-push',
    title: { ko: 'alpha branch push 승인', en: 'Approve alpha branch push' },
    description: { ko: '로컬 검토 뒤 원격 반영 여부를 사용자가 결정함.', en: 'The user decides whether local work is pushed remotely after review.' },
  },
  {
    id: 'demo-update',
    title: { ko: 'demo host 업데이트 승인', en: 'Approve demo host update' },
    description: { ko: 'demo host pull/update는 릴리즈 판단 뒤 별도 승인으로 진행함.', en: 'Demo host pull/update happens only after a separate release decision.' },
  },
  {
    id: 'restart-smoke',
    title: { ko: 'restart/smoke 승인', en: 'Approve restart/smoke' },
    description: { ko: '서비스 재시작과 smoke는 보호 포트와 롤백 계획 확인 뒤 진행함.', en: 'Service restart and smoke run only after protected-port and rollback checks.' },
  },
  {
    id: 'cleanup',
    title: { ko: '데이터 정리 승인', en: 'Approve data cleanup' },
    description: { ko: '파괴적 삭제나 보존 정책 변경은 이 화면에서 실행하지 않음.', en: 'Destructive deletion or retention changes are not executed from this workspace.' },
  },
]

function getEvidenceToneLabel(tone: EvidenceItem['tone']) {
  if (tone === 'ready') return { ko: '준비', en: 'Ready' }
  if (tone === 'attention') return { ko: '확인', en: 'Check' }
  return { ko: '승인 필요', en: 'Approval needed' }
}

function getEvidenceToneVariant(tone: EvidenceItem['tone']) {
  if (tone === 'ready') return 'default'
  if (tone === 'attention') return 'secondary'
  return 'outline'
}

/** Provide a release decision workspace that never performs external release actions itself. */
export function ReleaseReadinessTab() {
  const { t } = useI18n()
  const [reviewedItems, setReviewedItems] = useState<Set<string>>(() => new Set())
  const reviewedCount = reviewedItems.size
  const allReviewed = reviewedCount === REVIEW_ITEMS.length
  const readinessState = allReviewed ? t({ ko: '검토 완료', en: 'Reviewed' }) : t({ ko: '{count}/{total} 확인', en: '{count}/{total} checked' }, { count: reviewedCount, total: REVIEW_ITEMS.length })

  const readinessPercent = useMemo(() => Math.round((reviewedCount / REVIEW_ITEMS.length) * 100), [reviewedCount])

  const toggleReviewedItem = (id: string, checked: boolean) => {
    setReviewedItems((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        heading={t({ ko: '릴리즈 준비 워크스페이스', en: 'Release readiness workspace' })}
        actions={(
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setReviewedItems(new Set(REVIEW_ITEMS.map((item) => item.id)))}>
              <CheckCircle2 className="h-4 w-4" />
              {t({ ko: '검토 표시', en: 'Mark reviewed' })}
            </Button>
            <Button type="button" size="icon-sm" variant="secondary" onClick={() => setReviewedItems(new Set())} aria-label={t({ ko: '검토 초기화', en: 'Reset review' })} title={t({ ko: '검토 초기화', en: 'Reset review' })}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </>
        )}
      >
        <div className="grid gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_220px]">
          <SettingsInsetBlock>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={allReviewed ? 'default' : 'secondary'}>{readinessState}</Badge>
              <div className="min-w-0 text-sm text-muted-foreground">
                {t({
                  ko: '완료 작업, 주의 사항, 검증 근거, 사용자 결정을 릴리즈 액션 전에 한곳에서 점검해.',
                  en: 'Review completed work, caveats, evidence, and user-owned decisions in one place before release actions.',
                })}
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-sm bg-surface-high">
              <div className="h-full bg-primary transition-all" style={{ width: `${readinessPercent}%` }} />
            </div>
          </SettingsInsetBlock>

          <SettingsValueTile label={t({ ko: '진행률', en: 'Progress' })} value={`${readinessPercent}%`} />
        </div>

        <div className="grid gap-3 min-[900px]:grid-cols-2">
          {REVIEW_ITEMS.map((item) => {
            const checked = reviewedItems.has(item.id)

            return (
              <SettingsToggleRow key={item.id} className={cn('items-start', checked && 'border-primary/40 bg-primary/10')}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleReviewedItem(item.id, event.target.checked)}
                  aria-label={t(item.title)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{t(item.title)}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(item.description)}</span>
                </span>
              </SettingsToggleRow>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection heading={t({ ko: '검증 근거', en: 'Readiness evidence' })}>
        <div className="grid gap-3 md:grid-cols-2 min-[1200px]:grid-cols-4">
          {EVIDENCE_ITEMS.map((item) => (
            <SettingsValueTile
              key={item.value}
              label={t(item.label)}
              value={(
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="truncate font-mono text-xs">{item.value}</span>
                  <Badge variant={getEvidenceToneVariant(item.tone)}>{t(getEvidenceToneLabel(item.tone))}</Badge>
                </span>
              )}
              valueClassName="font-normal"
            />
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {EVIDENCE_ITEMS.map((item) => (
            <SettingsInsetBlock key={t(item.label)} className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{t(item.label)}: </span>
              {t(item.detail)}
            </SettingsInsetBlock>
          ))}
        </div>
      </SettingsSection>

      <div className="grid gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <SettingsSection heading={t({ ko: '검토 레인', en: 'Review lanes' })}>
          <div className="grid gap-3">
            {REVIEW_LANES.map((item) => (
              <SettingsInsetBlock key={item.id}>
                <div className="text-sm font-semibold text-foreground">{t(item.title)}</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">{t(item.description)}</div>
              </SettingsInsetBlock>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection heading={t({ ko: '사용자 결정 필요', en: 'User decisions needed' })}>
          <div className="space-y-3">
            {USER_DECISIONS.map((item) => (
              <SettingsInsetBlock key={item.id}>
                <div className="flex items-start gap-2">
                  <Badge variant="outline">{t({ ko: '승인', en: 'Approval' })}</Badge>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{t(item.title)}</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">{t(item.description)}</div>
                  </div>
                </div>
              </SettingsInsetBlock>
            ))}
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}
