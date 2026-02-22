import { ensureAbsoluteUrl } from '@/utils/backend'
import type { Workflow, MarkedField } from '@/services/workflow-api'
import { parseObjectWildcards } from '@/utils/wildcard-parser'
import { cleanPrompt, isPromptEmpty } from '@/utils/prompt-cleaner'
import type { PromptParseResult } from '../types/prompt.types'

async function imageToBase64(imagePath: string): Promise<string> {
  if (imagePath.startsWith('data:')) {
    return imagePath
  }

  try {
    const imageUrl = ensureAbsoluteUrl(imagePath)
    const response = await fetch(imageUrl)
    const blob = await response.blob()

    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('Failed to convert image to Base64:', error)
    throw error
  }
}

export async function buildPromptData(workflow: Workflow | null, formData: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!workflow?.workflow_json || !workflow?.marked_fields) {
    return {}
  }

  try {
    const workflowObj = JSON.parse(workflow.workflow_json) as Record<string, unknown>
    const promptData = JSON.parse(JSON.stringify(workflowObj)) as Record<string, unknown>

    for (const field of workflow.marked_fields) {
      const path = field.jsonPath.split('.')
      let current = promptData as Record<string, unknown>

      for (let index = 0; index < path.length - 1; index += 1) {
        const key = path[index]
        if (!(key in current)) {
          current[key] = {}
        }
        current = current[key] as Record<string, unknown>
      }

      const lastKey = path[path.length - 1]
      let value = formData[field.id]

      if (field.type === 'number') {
        const numericValue = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
        current[lastKey] = Number.isFinite(numericValue) ? numericValue : 0
      } else if (field.type === 'image') {
        if (typeof value === 'string' && value.length > 0) {
          current[lastKey] = await imageToBase64(value)
        } else {
          current[lastKey] = ''
        }
      } else {
        const originalValue = current[lastKey]
        if (
          typeof originalValue === 'string' &&
          typeof value === 'string' &&
          originalValue.includes('\\') &&
          value.includes('/')
        ) {
          value = value.replace(/\//g, '\\')
        }
        current[lastKey] = value
      }
    }

    return promptData
  } catch (error) {
    console.error('Failed to build prompt data:', error)
    return {}
  }
}

export async function buildPromptDataWithWildcards(
  workflow: Workflow | null,
  formData: Record<string, unknown>,
): Promise<PromptParseResult> {
  const promptData = await buildPromptData(workflow, formData)
  const parseResult = await parseObjectWildcards(promptData, 'comfyui')

  return {
    data: parseResult.data as Record<string, unknown>,
    emptyWildcards: parseResult.emptyWildcards,
  }
}

export function initializeFormData(workflow: Workflow): Record<string, unknown> {
  if (!workflow.marked_fields) {
    return {}
  }

  const initialData: Record<string, unknown> = {}
  workflow.marked_fields.forEach((field: MarkedField) => {
    initialData[field.id] = field.default_value || ''
  })

  return initialData
}

export function hasEmptyPrompts(promptData: Record<string, unknown>): boolean {
  function findTextFields(obj: unknown): string[] {
    const texts: string[] = []

    if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      Object.keys(record).forEach((key) => {
        const value = record[key]

        if (key === 'text' && typeof value === 'string') {
          texts.push(value)
        } else if (key === 'inputs' && value && typeof value === 'object') {
          const inputs = value as Record<string, unknown>
          if (typeof inputs.text === 'string') {
            texts.push(inputs.text)
          }
        }

        if (typeof value === 'object') {
          texts.push(...findTextFields(value))
        }
      })
    }

    return texts
  }

  const textFields = findTextFields(promptData)
  return textFields.length > 0 && textFields.every((text) => isPromptEmpty(cleanPrompt(text)))
}
