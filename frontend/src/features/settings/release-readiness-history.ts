import type { TranslationDictionary } from '@/i18n'

export const RELEASE_READINESS_HISTORY_SCHEMA_VERSION = 1
export const RELEASE_READINESS_HISTORY_STORAGE_KEY = 'conai.release-readiness.history.v1'
export const MAX_RELEASE_READINESS_HISTORY_RECORDS = 12

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type ReleaseReadinessEvidenceTone = 'ready' | 'attention' | 'blocked'

export type ReleaseReadinessChecklistItemContract = {
  id: string
  title: TranslationDictionary
  description: TranslationDictionary
}

export type ReleaseReadinessEvidenceItemContract = {
  id: string
  label: TranslationDictionary
  value: string
  detail: TranslationDictionary
  tone: ReleaseReadinessEvidenceTone
}

export type ReleaseReadinessHandoffItemContract = {
  id: string
  title: TranslationDictionary
  artifact: string
  detail: TranslationDictionary
}

export type ReleaseReadinessRunbookGuardrailContract = {
  id: string
  phase: TranslationDictionary
  title: TranslationDictionary
  status: TranslationDictionary
  description: TranslationDictionary
}

export type ReleaseReadinessUserDecisionContract = ReleaseReadinessChecklistItemContract

export type ReleaseReadinessOperationStepContract = {
  id: string
  phase: TranslationDictionary
  approval: TranslationDictionary
  command: string
  target: string
  smokeAssertion: string
  stopCondition: string
}

export type ReleaseReadinessAlertReviewItemContract = {
  id: string
  domain: 'media-review' | 'workflow-runtime'
  title: TranslationDictionary
  signal: TranslationDictionary
  sourceSurface: string
  thresholdKey: string
  detail: TranslationDictionary
  approvalBoundary: 'operator-review' | 'approval-required'
}

export type ReleaseReadinessTrendEvidenceContract = {
  id: string
  domain: 'dependency-security' | 'release-operations' | 'media-review' | 'workflow-runtime'
  title: TranslationDictionary
  sourceSurface: string
  metric: string
  trend: TranslationDictionary
  exportValue: string
  releaseUse: TranslationDictionary
  approvalBoundary: 'local-evidence' | 'operator-review' | 'approval-required'
}

export type ReleaseReadinessAutomationContextContract = {
  id: string
  surface: TranslationDictionary
  contractAnchor: string
  reviewUse: TranslationDictionary
  boundary: 'local-evidence' | 'opt-in-only' | 'approval-required'
}

export type ReleaseReadinessEvidenceReviewContract = {
  id: string
  sourceSurface: TranslationDictionary
  evidenceAnchor: string
  compares: TranslationDictionary
  operatorQuestion: TranslationDictionary
  approvalBoundary: 'local-evidence' | 'operator-review' | 'approval-required'
}

export type ReleaseReadinessHistoryRecord = {
  id: string
  schemaVersion: typeof RELEASE_READINESS_HISTORY_SCHEMA_VERSION
  source: 'settings.release-readiness'
  storageSurface: 'local-browser'
  savedAt: string
  appVersionLabel: string
  externalActionsExecuted: false
  pushDeployRestartBoundary: 'approval-required'
  reviewedItemIds: string[]
  capturedHandoffItemIds: string[]
  reviewedAlertIds: string[]
  summary: {
    reviewedCount: number
    reviewItemCount: number
    capturedHandoffCount: number
    handoffItemCount: number
    reviewedAlertCount: number
    alertReviewItemCount: number
    trendEvidenceCount: number
    readyForExport: boolean
  }
  checklist: Array<ReleaseReadinessChecklistItemContract & { status: 'checked' | 'open' }>
  evidence: ReleaseReadinessEvidenceItemContract[]
  observabilityAlerts: Array<ReleaseReadinessAlertReviewItemContract & { status: 'reviewed' | 'open' }>
  trendEvidence: ReleaseReadinessTrendEvidenceContract[]
  automationContext: ReleaseReadinessAutomationContextContract[]
  evidenceReview: ReleaseReadinessEvidenceReviewContract[]
  handoff: Array<ReleaseReadinessHandoffItemContract & { status: 'captured' | 'open' }>
  runbookGuardrails: ReleaseReadinessRunbookGuardrailContract[]
  operationSteps: ReleaseReadinessOperationStepContract[]
  userDecisions: Array<ReleaseReadinessUserDecisionContract & { status: 'approval-required' }>
}

export type ReleaseReadinessHistoryDocument = {
  schemaVersion: typeof RELEASE_READINESS_HISTORY_SCHEMA_VERSION
  records: ReleaseReadinessHistoryRecord[]
  lastSavedAt: string | null
}

export type ReleaseReadinessHistorySnapshotInput = {
  id?: string
  savedAt?: string
  appVersionLabel: string
  reviewedItemIds: Iterable<string>
  capturedHandoffItemIds: Iterable<string>
  reviewedAlertIds: Iterable<string>
  reviewItems: readonly ReleaseReadinessChecklistItemContract[]
  evidenceItems: readonly ReleaseReadinessEvidenceItemContract[]
  alertReviewItems: readonly ReleaseReadinessAlertReviewItemContract[]
  trendEvidenceItems: readonly ReleaseReadinessTrendEvidenceContract[]
  automationContextItems: readonly ReleaseReadinessAutomationContextContract[]
  evidenceReviewItems: readonly ReleaseReadinessEvidenceReviewContract[]
  handoffItems: readonly ReleaseReadinessHandoffItemContract[]
  runbookGuardrails: readonly ReleaseReadinessRunbookGuardrailContract[]
  operationSteps: readonly ReleaseReadinessOperationStepContract[]
  userDecisions: readonly ReleaseReadinessUserDecisionContract[]
}

export function createEmptyReleaseReadinessHistoryDocument(): ReleaseReadinessHistoryDocument {
  return {
    schemaVersion: RELEASE_READINESS_HISTORY_SCHEMA_VERSION,
    records: [],
    lastSavedAt: null,
  }
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function uniqueIds(ids: Iterable<string>) {
  return Array.from(new Set(Array.from(ids).filter((id) => typeof id === 'string' && id.trim().length > 0)))
}

function buildRecordId(savedAt: string) {
  const timestamp = savedAt.replace(/\D/g, '').slice(0, 14) || 'snapshot'
  const suffix = Math.random().toString(36).slice(2, 8)
  return `release-readiness-${timestamp}-${suffix}`
}

type PersistedReleaseReadinessHistoryRecord = Omit<ReleaseReadinessHistoryRecord, 'operationSteps' | 'reviewedAlertIds' | 'observabilityAlerts' | 'trendEvidence' | 'automationContext' | 'evidenceReview' | 'summary'> & {
  operationSteps?: ReleaseReadinessOperationStepContract[]
  reviewedAlertIds?: string[]
  observabilityAlerts?: Array<ReleaseReadinessAlertReviewItemContract & { status: 'reviewed' | 'open' }>
  trendEvidence?: ReleaseReadinessTrendEvidenceContract[]
  automationContext?: ReleaseReadinessAutomationContextContract[]
  evidenceReview?: ReleaseReadinessEvidenceReviewContract[]
  summary: Omit<ReleaseReadinessHistoryRecord['summary'], 'reviewedAlertCount' | 'alertReviewItemCount' | 'trendEvidenceCount'> & {
    reviewedAlertCount?: number
    alertReviewItemCount?: number
    trendEvidenceCount?: number
  }
}

function isHistoryRecord(value: unknown): value is PersistedReleaseReadinessHistoryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PersistedReleaseReadinessHistoryRecord>
  return (
    record.schemaVersion === RELEASE_READINESS_HISTORY_SCHEMA_VERSION
    && record.source === 'settings.release-readiness'
    && record.storageSurface === 'local-browser'
    && record.externalActionsExecuted === false
    && record.pushDeployRestartBoundary === 'approval-required'
    && typeof record.id === 'string'
    && typeof record.savedAt === 'string'
    && typeof record.appVersionLabel === 'string'
    && Array.isArray(record.reviewedItemIds)
    && Array.isArray(record.capturedHandoffItemIds)
    && (record.reviewedAlertIds === undefined || Array.isArray(record.reviewedAlertIds))
    && Array.isArray(record.checklist)
    && Array.isArray(record.evidence)
    && (record.observabilityAlerts === undefined || Array.isArray(record.observabilityAlerts))
    && (record.trendEvidence === undefined || Array.isArray(record.trendEvidence))
    && (record.automationContext === undefined || Array.isArray(record.automationContext))
    && (record.evidenceReview === undefined || Array.isArray(record.evidenceReview))
    && Array.isArray(record.handoff)
    && Array.isArray(record.runbookGuardrails)
    && (record.operationSteps === undefined || Array.isArray(record.operationSteps))
    && Array.isArray(record.userDecisions)
  )
}

export function buildReleaseReadinessHistoryRecord(input: ReleaseReadinessHistorySnapshotInput): ReleaseReadinessHistoryRecord {
  const savedAt = input.savedAt ?? new Date().toISOString()
  const reviewedItemIds = uniqueIds(input.reviewedItemIds)
  const capturedHandoffItemIds = uniqueIds(input.capturedHandoffItemIds)
  const reviewedAlertIds = uniqueIds(input.reviewedAlertIds)
  const reviewedSet = new Set(reviewedItemIds)
  const capturedSet = new Set(capturedHandoffItemIds)
  const alertReviewSet = new Set(reviewedAlertIds)
  const reviewItemCount = input.reviewItems.length
  const handoffItemCount = input.handoffItems.length
  const alertReviewItemCount = input.alertReviewItems.length
  const trendEvidenceCount = input.trendEvidenceItems.length

  return {
    id: input.id ?? buildRecordId(savedAt),
    schemaVersion: RELEASE_READINESS_HISTORY_SCHEMA_VERSION,
    source: 'settings.release-readiness',
    storageSurface: 'local-browser',
    savedAt,
    appVersionLabel: input.appVersionLabel,
    externalActionsExecuted: false,
    pushDeployRestartBoundary: 'approval-required',
    reviewedItemIds,
    capturedHandoffItemIds,
    reviewedAlertIds,
    summary: {
      reviewedCount: reviewedItemIds.length,
      reviewItemCount,
      capturedHandoffCount: capturedHandoffItemIds.length,
      handoffItemCount,
      reviewedAlertCount: reviewedAlertIds.length,
      alertReviewItemCount,
      trendEvidenceCount,
      readyForExport: reviewItemCount > 0
        && handoffItemCount > 0
        && alertReviewItemCount > 0
        && trendEvidenceCount > 0
        && reviewedItemIds.length === reviewItemCount
        && capturedHandoffItemIds.length === handoffItemCount
        && reviewedAlertIds.length === alertReviewItemCount,
    },
    checklist: input.reviewItems.map((item) => ({
      ...item,
      status: reviewedSet.has(item.id) ? 'checked' : 'open',
    })),
    evidence: input.evidenceItems.map((item) => ({ ...item })),
    observabilityAlerts: input.alertReviewItems.map((item) => ({
      ...item,
      status: alertReviewSet.has(item.id) ? 'reviewed' : 'open',
    })),
    trendEvidence: input.trendEvidenceItems.map((item) => ({ ...item })),
    automationContext: input.automationContextItems.map((item) => ({ ...item })),
    evidenceReview: input.evidenceReviewItems.map((item) => ({ ...item })),
    handoff: input.handoffItems.map((item) => ({
      ...item,
      status: capturedSet.has(item.id) ? 'captured' : 'open',
    })),
    runbookGuardrails: input.runbookGuardrails.map((item) => ({ ...item })),
    operationSteps: input.operationSteps.map((item) => ({ ...item })),
    userDecisions: input.userDecisions.map((item) => ({
      ...item,
      status: 'approval-required',
    })),
  }
}

export function normalizeReleaseReadinessHistoryDocument(value: unknown): ReleaseReadinessHistoryDocument {
  if (!value || typeof value !== 'object') return createEmptyReleaseReadinessHistoryDocument()
  const document = value as Partial<ReleaseReadinessHistoryDocument>
  if (document.schemaVersion !== RELEASE_READINESS_HISTORY_SCHEMA_VERSION || !Array.isArray(document.records)) {
    return createEmptyReleaseReadinessHistoryDocument()
  }

  const records = document.records
    .filter(isHistoryRecord)
    .map((record) => ({
      ...record,
      reviewedAlertIds: uniqueIds(record.reviewedAlertIds ?? []),
      summary: {
        ...record.summary,
        reviewedAlertCount: record.summary.reviewedAlertCount ?? uniqueIds(record.reviewedAlertIds ?? []).length,
        alertReviewItemCount: record.summary.alertReviewItemCount ?? record.observabilityAlerts?.length ?? 0,
        trendEvidenceCount: record.summary.trendEvidenceCount ?? record.trendEvidence?.length ?? 0,
      },
      observabilityAlerts: Array.isArray(record.observabilityAlerts) ? record.observabilityAlerts : [],
      trendEvidence: Array.isArray(record.trendEvidence) ? record.trendEvidence : [],
      automationContext: Array.isArray(record.automationContext) ? record.automationContext : [],
      evidenceReview: Array.isArray(record.evidenceReview) ? record.evidenceReview : [],
      operationSteps: Array.isArray(record.operationSteps) ? record.operationSteps : [],
    }))
    .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt))
    .slice(0, MAX_RELEASE_READINESS_HISTORY_RECORDS)

  return {
    schemaVersion: RELEASE_READINESS_HISTORY_SCHEMA_VERSION,
    records,
    lastSavedAt: records[0]?.savedAt ?? null,
  }
}

export function readReleaseReadinessHistoryFromStorage(storage: StorageLike | null = getBrowserStorage()): ReleaseReadinessHistoryDocument {
  if (!storage) return createEmptyReleaseReadinessHistoryDocument()

  try {
    const rawValue = storage.getItem(RELEASE_READINESS_HISTORY_STORAGE_KEY)
    if (!rawValue) return createEmptyReleaseReadinessHistoryDocument()
    return normalizeReleaseReadinessHistoryDocument(JSON.parse(rawValue))
  } catch {
    return createEmptyReleaseReadinessHistoryDocument()
  }
}

export function saveReleaseReadinessHistoryRecord(
  record: ReleaseReadinessHistoryRecord,
  storage: StorageLike | null = getBrowserStorage(),
): ReleaseReadinessHistoryDocument {
  const current = readReleaseReadinessHistoryFromStorage(storage)
  const document = normalizeReleaseReadinessHistoryDocument({
    schemaVersion: RELEASE_READINESS_HISTORY_SCHEMA_VERSION,
    records: [record, ...current.records.filter((historyRecord) => historyRecord.id !== record.id)],
  })

  if (storage) {
    try {
      storage.setItem(RELEASE_READINESS_HISTORY_STORAGE_KEY, JSON.stringify(document))
    } catch {
      // Storage can be blocked in private, embedded, or policy-restricted contexts.
    }
  }

  return document
}

function formatTranslationDictionary(value: TranslationDictionary) {
  const ko = value.ko?.trim()
  const en = value.en?.trim()
  if (ko && en && ko !== en) return `${ko} / ${en}`
  return ko || en || 'n/a'
}

function formatMarkdownStatus(status: string) {
  return status.replace(/-/g, ' ')
}

function formatHistoryFileTimestamp(savedAt: string) {
  return savedAt.replace(/\D/g, '').slice(0, 14) || 'snapshot'
}

export function buildReleaseReadinessHandoffFilename(record: ReleaseReadinessHistoryRecord) {
  return `conai-release-readiness-${formatHistoryFileTimestamp(record.savedAt)}.md`
}

export function buildReleaseReadinessHandoffMarkdown(record: ReleaseReadinessHistoryRecord) {
  const lines = [
    '# CoNAI Release Readiness Handoff',
    '',
    `- savedAt: ${record.savedAt}`,
    `- appVersionLabel: ${record.appVersionLabel}`,
    `- schemaVersion: ${record.schemaVersion}`,
    `- source: ${record.source}`,
    `- storageSurface: ${record.storageSurface}`,
    `- externalActionsExecuted: ${record.externalActionsExecuted}`,
    `- pushDeployRestartBoundary: ${record.pushDeployRestartBoundary}`,
    `- readyForExport: ${record.summary.readyForExport}`,
    '',
    'This export is local release-review evidence only. It does not perform push, deploy, restart, smoke, destructive cleanup, package version bump, tag, or public release actions.',
    '',
    '## Review State',
    '',
    ...record.checklist.map((item) => (
      `- [${item.status === 'checked' ? 'x' : ' '}] ${formatTranslationDictionary(item.title)}: ${formatTranslationDictionary(item.description)}`
    )),
    '',
    '## Evidence',
    '',
    ...record.evidence.map((item) => (
      `- ${formatTranslationDictionary(item.label)} (${formatMarkdownStatus(item.tone)}): ${item.value} - ${formatTranslationDictionary(item.detail)}`
    )),
    '',
    '## Observability Alert Review',
    '',
    ...record.observabilityAlerts.map((item) => (
      `- [${item.status === 'reviewed' ? 'x' : ' '}] ${formatTranslationDictionary(item.title)} (${item.sourceSurface} / ${item.thresholdKey} / ${formatMarkdownStatus(item.approvalBoundary)}): ${formatTranslationDictionary(item.signal)} - ${formatTranslationDictionary(item.detail)}`
    )),
    '',
    '## Trend Evidence',
    '',
    ...record.trendEvidence.map((item) => (
      `- ${formatTranslationDictionary(item.title)} (${item.domain} / ${item.sourceSurface} / ${item.metric} / ${formatMarkdownStatus(item.approvalBoundary)}): ${formatTranslationDictionary(item.trend)} - ${item.exportValue}; release use: ${formatTranslationDictionary(item.releaseUse)}`
    )),
    '',
    '## Automation Context',
    '',
    ...record.automationContext.map((item) => (
      `- ${formatTranslationDictionary(item.surface)} (${item.contractAnchor} / ${formatMarkdownStatus(item.boundary)}): ${formatTranslationDictionary(item.reviewUse)}`
    )),
    '',
    '## Operator Evidence Review Console',
    '',
    ...record.evidenceReview.map((item) => (
      `- ${formatTranslationDictionary(item.sourceSurface)} (${item.evidenceAnchor} / ${formatMarkdownStatus(item.approvalBoundary)}): compares ${formatTranslationDictionary(item.compares)}; asks ${formatTranslationDictionary(item.operatorQuestion)}`
    )),
    '',
    '## Captured Handoff Evidence',
    '',
    ...record.handoff.map((item) => (
      `- [${item.status === 'captured' ? 'x' : ' '}] ${formatTranslationDictionary(item.title)}: ${item.artifact} - ${formatTranslationDictionary(item.detail)}`
    )),
    '',
    '## Runbook Guardrails',
    '',
    ...record.runbookGuardrails.map((item) => (
      `- ${formatTranslationDictionary(item.phase)} / ${formatTranslationDictionary(item.status)}: ${formatTranslationDictionary(item.title)} - ${formatTranslationDictionary(item.description)}`
    )),
    '',
    '## Approval-Gated Operation Checklist',
    '',
    ...record.operationSteps.map((item) => (
      `- ${formatTranslationDictionary(item.phase)} / ${formatTranslationDictionary(item.approval)}: ${item.command} -> ${item.target}; smoke: ${item.smokeAssertion}; stop: ${item.stopCondition}`
    )),
    '',
    '## User-Owned Decisions',
    '',
    ...record.userDecisions.map((item) => (
      `- ${formatTranslationDictionary(item.title)} (${formatMarkdownStatus(item.status)}): ${formatTranslationDictionary(item.description)}`
    )),
  ]

  return `${lines.join('\n')}\n`
}
