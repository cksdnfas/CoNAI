import type {
  CreateGenerationWorkflowPayload,
  WorkflowMarkedField,
  WorkflowRoleQueueLimits,
} from '@/lib/api-image-generation-types'

export const PUBLIC_QUEUE_ROLE_LIMIT_MAX = 999

export function slugifyPublicWorkflow(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function clampPublicQueueMaxCount(value: string) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return 32
  return Math.min(32, Math.max(1, parsed))
}

/** Empty and invalid role limits stay unlimited; valid limits keep the existing inclusive 0..999 contract. */
export function buildPublicQueueRoleLimitsPayload(draft: Record<string, string>): WorkflowRoleQueueLimits | null {
  const limits: WorkflowRoleQueueLimits = {}
  for (const [groupKey, rawValue] of Object.entries(draft)) {
    if (rawValue.trim().length === 0) continue
    const parsed = Math.trunc(Number(rawValue))
    if (!Number.isFinite(parsed)) continue
    limits[groupKey] = Math.min(PUBLIC_QUEUE_ROLE_LIMIT_MAX, Math.max(0, parsed))
  }
  return Object.keys(limits).length > 0 ? limits : null
}

export function roleLimitsToDraft(limits: WorkflowRoleQueueLimits | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(limits ?? {}).map(([groupKey, limit]) => [groupKey, String(limit)]))
}

interface BuildComfyWorkflowPayloadOptions {
  artifactDirectoryMode: CreateGenerationWorkflowPayload['artifact_directory_mode']
  artifactRootPath: string
  color: string
  description: string
  isActive: boolean
  isPublicPage: boolean
  markedFields: WorkflowMarkedField[]
  publicQueueMaxCount: string
  publicQueueRoleLimits: Record<string, string>
  publicSlug: string
  resultViewMode: CreateGenerationWorkflowPayload['result_view_mode']
  workflowJson: string
  workflowName: string
}

/** Build the create/update payload without changing the public workflow nullability contract. */
export function buildComfyWorkflowPayload({
  artifactDirectoryMode,
  artifactRootPath,
  color,
  description,
  isActive,
  isPublicPage,
  markedFields,
  publicQueueMaxCount,
  publicQueueRoleLimits,
  publicSlug,
  resultViewMode,
  workflowJson,
  workflowName,
}: BuildComfyWorkflowPayloadOptions): CreateGenerationWorkflowPayload {
  return {
    name: workflowName.trim(),
    description: description.trim() || undefined,
    workflow_json: workflowJson,
    marked_fields: markedFields,
    is_active: isActive,
    is_public_page: isPublicPage,
    public_slug: isPublicPage ? slugifyPublicWorkflow(publicSlug) : null,
    public_queue_max_count: isPublicPage ? clampPublicQueueMaxCount(publicQueueMaxCount) : null,
    public_queue_role_limits: isPublicPage ? buildPublicQueueRoleLimitsPayload(publicQueueRoleLimits) : null,
    result_view_mode: resultViewMode,
    artifact_directory_mode: artifactDirectoryMode,
    artifact_root_path: artifactRootPath.trim() || null,
    color,
  }
}
