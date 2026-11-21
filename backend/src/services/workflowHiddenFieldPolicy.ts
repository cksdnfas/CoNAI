/**
 * A hidden marked field is a fixed value: no generation form, input schema or module port offers it, and a run always
 * uses its authored default_value whatever a caller sends for that field id. An empty default leaves the workflow
 * JSON's own input as it is. Only text, textarea, number and select fields can be hidden; the flag on an image or node
 * field is ignored. The frontend mirrors this in features/image-generation/workflow-field-choices.ts.
 */

export type HiddenWorkflowFieldLike = {
  id?: unknown
  type?: unknown
  hidden?: unknown
}

const HIDEABLE_WORKFLOW_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'select'])

/** Whether a marked field is hidden (a fixed value no caller fills). */
export function isHiddenWorkflowField(field: HiddenWorkflowFieldLike): boolean {
  return field.hidden === true && typeof field.type === 'string' && HIDEABLE_WORKFLOW_FIELD_TYPES.has(field.type)
}

/** The fields a caller can fill: every marked field except the hidden ones. */
export function visibleWorkflowFields<T extends HiddenWorkflowFieldLike>(fields: readonly T[]): T[] {
  return fields.filter((field) => !isHiddenWorkflowField(field))
}

/** Prompt data without the values given for hidden fields, so each of them runs with its default. */
export function withoutHiddenWorkflowFieldValues<T extends Record<string, any>>(fields: readonly HiddenWorkflowFieldLike[], promptData: T): T {
  let next: Record<string, any> | null = null
  for (const field of fields) {
    if (typeof field.id !== 'string' || !isHiddenWorkflowField(field) || !Object.prototype.hasOwnProperty.call(promptData, field.id)) continue
    next ??= { ...promptData }
    delete next[field.id]
  }
  return (next ?? promptData) as T
}

/** A hidden field whose fixed value is empty: the workflow JSON keeps its own input. */
export function isEmptyHiddenWorkflowFieldValue(field: HiddenWorkflowFieldLike, value: unknown): boolean {
  return isHiddenWorkflowField(field) && (value === undefined || value === null || value === '')
}
