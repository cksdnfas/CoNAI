import type { GraphWorkflowExposedInput } from '@/lib/api-module-graph'

const WORKFLOW_RUNNER_DRAFT_STORAGE_KEY_PREFIX = 'conai:module-graph:workflow-runner-draft:v1:'

function buildWorkflowRunnerDraftStorageKey(workflowId: number) {
  return `${WORKFLOW_RUNNER_DRAFT_STORAGE_KEY_PREFIX}${workflowId}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function sanitizeStructuredValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return undefined
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return undefined
    }
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'boolean' || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeStructuredValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entryValue]) => [key, sanitizeStructuredValue(entryValue, depth + 1)] as const)
        .filter(([, entryValue]) => entryValue !== undefined),
    )
  }

  return undefined
}

function readLocalStorageJson<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(key)
    if (!rawValue) {
      return null
    }

    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

function writeLocalStorageJson(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore quota/private-mode persistence failures.
  }
}

export function loadPersistedWorkflowRunnerDraft(
  workflowId: number,
  inputDefinitions: GraphWorkflowExposedInput[],
): Record<string, unknown> {
  const rawValue = readLocalStorageJson<Record<string, unknown>>(buildWorkflowRunnerDraftStorageKey(workflowId))
  if (!rawValue) {
    return {}
  }

  const allowedInputs = new Map(inputDefinitions.map((inputDefinition) => [inputDefinition.id, inputDefinition]))

  return Object.fromEntries(
    Object.entries(rawValue)
      .filter(([inputId]) => allowedInputs.has(inputId))
      .map(([inputId, value]) => {
        const inputDefinition = allowedInputs.get(inputId)
        if (!inputDefinition || inputDefinition.data_type === 'image' || inputDefinition.data_type === 'mask') {
          return [inputId, undefined] as const
        }

        return [inputId, sanitizeStructuredValue(value)] as const
      })
      .filter(([, value]) => value !== undefined),
  )
}

export function persistWorkflowRunnerDraft(
  workflowId: number,
  inputDefinitions: GraphWorkflowExposedInput[],
  inputValues: Record<string, unknown>,
) {
  const persistableEntries = inputDefinitions
    .filter((inputDefinition) => inputDefinition.data_type !== 'image' && inputDefinition.data_type !== 'mask')
    .map((inputDefinition) => {
      const rawValue = inputValues[inputDefinition.id]
      if (rawValue === undefined || rawValue === '') {
        return [inputDefinition.id, undefined] as const
      }

      return [inputDefinition.id, sanitizeStructuredValue(rawValue)] as const
    })
    .filter(([, value]) => value !== undefined)

  writeLocalStorageJson(buildWorkflowRunnerDraftStorageKey(workflowId), Object.fromEntries(persistableEntries))
}

export function clearPersistedWorkflowRunnerDraft(workflowId: number) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(buildWorkflowRunnerDraftStorageKey(workflowId))
  } catch {
    // Ignore storage cleanup failures.
  }
}
