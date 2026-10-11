import { describeChatWorkflowModule, sanitizeChatWorkflowInputs, type ChatPageSnapshot, type ChatWorkflowModule } from '@conai/shared'
import { ModuleDefinitionModel } from '../../models/ModuleDefinition'
import { parseModuleDefinition } from '../graph-workflow-executor/shared'
import { NODE_OPTION_SOURCES, type NodeOption } from '../graph-workflow-executor/node-option-sources'

/** Only the public editor interface is exposed, never module templates or internal values. */
export function chatWorkflowModules(): ChatWorkflowModule[] {
  return ModuleDefinitionModel.findAll(true).map(parseModuleDefinition).map(describeChatWorkflowModule)
}

/** Choices shown per field in a module result; checking a set value uses the whole list. */
const CHOICES_SHOWN = 40
const CHOICES_CHECKED = 2000
export type ChatWorkflowChoice = { value: string; label: string; disabled?: true; default?: true }

/**
 * The live choices of fields that name an `options_source` (chat profiles, the asking account's rooms and lorebooks,
 * model rows…), as the node editor's own selects list them. Kept out of the module description itself, which must stay
 * identical between the browser and the server.
 */
export async function chatWorkflowFieldChoices(modules: ChatWorkflowModule[], accountId: number | null, limit = CHOICES_CHECKED): Promise<Map<string, ChatWorkflowChoice[]>> {
  const sources = [...new Set(modules.flatMap((module) => module.fields.flatMap((field) => field.optionsSource ? [field.optionsSource] : [])))]
  const lists = await Promise.all(sources.map(async (source) => {
    const read = NODE_OPTION_SOURCES[source]
    const options: NodeOption[] = read ? await Promise.resolve(read({ accountId })).catch(() => []) : []
    return [source, options.slice(0, limit).map((option) => ({ value: option.value, label: option.label.slice(0, 80), ...(option.disabled ? { disabled: true as const } : {}), ...(option.is_default ? { default: true as const } : {}) }))] as const
  }))
  return new Map(lists)
}

/** Each listed module with `choices` per live-list field. */
export async function withChatWorkflowChoices(modules: ChatWorkflowModule[], accountId: number | null) {
  const choices = await chatWorkflowFieldChoices(modules, accountId, CHOICES_SHOWN + 1)
  return modules.map((module) => {
    const fields = Object.fromEntries(module.fields.flatMap((field) => {
      if (!field.optionsSource) return []
      const list = choices.get(field.optionsSource) ?? []
      // A longer list is cut; list_chat_rooms (rooms) or the field's page lists the rest.
      return [[field.key, list.length > CHOICES_SHOWN ? [...list.slice(0, CHOICES_SHOWN), { value: '…', label: 'more not shown' }] : list]]
    }))
    return Object.keys(fields).length ? { ...module, choices: fields } : module
  })
}

/**
 * A value set on a live-list field must be one of its current, pickable choices (ids are numbers in number fields).
 * Throws with the choices so the next try can be right.
 */
export async function requireChatWorkflowChoiceValues(modules: ChatWorkflowModule[], values: Array<{ moduleId: number; key: string; value: unknown }>, accountId: number | null) {
  const byId = new Map(modules.map((module) => [module.id, module]))
  const targets = values.flatMap((entry) => {
    const field = byId.get(entry.moduleId)?.fields.find((item) => item.key === entry.key)
    return field?.optionsSource && entry.value !== null && entry.value !== undefined ? [{ field, value: String(entry.value) }] : []
  })
  if (targets.length === 0) return
  const choices = await chatWorkflowFieldChoices(targets.map(({ field }) => ({ fields: [field] }) as ChatWorkflowModule), accountId)
  for (const { field, value } of targets) {
    const list = choices.get(field.optionsSource!) ?? []
    if (!NODE_OPTION_SOURCES[field.optionsSource!]) continue
    const match = list.find((choice) => choice.value === value)
    if (!match || match.disabled) {
      const shown = list.filter((choice) => !choice.disabled).slice(0, 30).map((choice) => `${choice.value}=${choice.label}`).join(', ')
      throw new Error(`${field.label}: ${value} is not one of the current choices${shown ? ` (${shown})` : ' (the list is empty)'}.`)
    }
  }
}

export function sanitizeChatWorkflowPage(page: ChatPageSnapshot): ChatPageSnapshot {
  if (!page.workflow) return page
  const modules = new Map(chatWorkflowModules().map((module) => [module.id, module]))
  return { ...page, workflow: { ...page.workflow, nodes: page.workflow.nodes.map((node) => {
    const module = modules.get(node.module_id)
    if (!module) throw new Error('비활성 또는 삭제된 모듈이 있어. 모듈 목록을 새로고침해줘.')
    return { ...node, input_values: sanitizeChatWorkflowInputs(node.input_values, module), ...(module.runInputCapable ? {} : { run_input: undefined }) }
  }) } }
}

export function requireChatWorkflowModules(expected: ChatWorkflowModule[]) {
  const live = new Map(chatWorkflowModules().map((module) => [module.id, module]))
  if (expected.some((module) => JSON.stringify(module) !== JSON.stringify(live.get(module.id)))) throw new Error('모듈 정의가 바뀌었어. 편집기를 새로고침하고 다시 제안받아줘.')
}
