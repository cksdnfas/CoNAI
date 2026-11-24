import { CHAT_FORM_LIMITS, type ChatFormInput, type ChatFormProposal } from '../types/chatForm'
import { normalizeChatForm, writeChatFormPath } from './chatForm'

/*
 * What a model writes for show_form (an inference format) apart from the card the chat stores (ChatFormProposal, an
 * A2UI createSurface subset). Each format rewrites the call into raw A2UI and ends in normalizeChatForm, which stays
 * the one authority on the card; a new format is one more decoder.
 */

type Raw = Record<string, unknown>
type Decoded = ChatFormProposal | { error: string }

export type ChatFormFormat = {
  id: string
  accepts(input: Raw): boolean
  decode(input: Raw): Decoded
}

type FieldTypeName = 'text' | 'longtext' | 'number' | 'select' | 'multi' | 'slider' | 'switch' | 'media'

type FieldType = {
  type: FieldTypeName
  /** Other names models give it; compared lowercased without `-`, `_` and spaces. */
  aliases: readonly string[]
  component: ChatFormInput['component']
  variant?: string
  /** Its own properties, as the description lists them. */
  takes: string
  /** With finite `min` and `max` it is this type instead. */
  ranged?: FieldTypeName
  hint?: string
}

/** The `fields` types: the decoder's lookup and the tool description both read this table. */
const FIELD_TYPES: readonly FieldType[] = [
  { type: 'text', aliases: ['string', 'short', 'shorttext', 'input'], component: 'TextField', variant: 'shortText', takes: 'placeholder?' },
  { type: 'longtext', aliases: ['textarea', 'long', 'paragraph', 'multiline'], component: 'TextField', variant: 'longText', takes: 'placeholder?' },
  { type: 'number', aliases: ['integer', 'int', 'float'], component: 'TextField', variant: 'number', takes: 'placeholder?', ranged: 'slider' },
  { type: 'select', aliases: ['choice', 'radio', 'dropdown', 'enum', 'single'], component: 'ChoicePicker', variant: 'mutuallyExclusive', takes: 'options:[label]' },
  { type: 'multi', aliases: ['multiselect', 'multiple', 'checkboxes', 'tags'], component: 'ChoicePicker', variant: 'multipleSelection', takes: 'options:[label]' },
  { type: 'slider', aliases: ['range'], component: 'Slider', takes: 'min,max,step?' },
  { type: 'switch', aliases: ['checkbox', 'boolean', 'bool', 'toggle'], component: 'CheckBox', takes: '' },
  { type: 'media', aliases: ['image', 'images'], component: 'MediaPicker', takes: 'items:[composite hash],multiple?', hint: 'to pick library images' },
]

const typeName = (text: string) => text.toLowerCase().replace(/[-_\s]/g, '')
const FIELD_TYPE_LOOKUP = new Map(FIELD_TYPES.flatMap((spec) => [spec.type, ...spec.aliases].map((name) => [typeName(name), spec] as const)))
const FIELD_TYPE = new Map(FIELD_TYPES.map((spec) => [spec.type, spec]))

/** The `fields` format as the show_form description gives it. */
export function describeChatFormFields(): string {
  const groups: Array<{ names: string[]; takes: string; notes: string[] }> = []
  for (const spec of FIELD_TYPES) {
    const last = groups[groups.length - 1]
    const group = last && last.takes === spec.takes ? last : (groups.push({ names: [], takes: spec.takes, notes: [] }), groups[groups.length - 1])
    group.names.push(spec.type)
    if (spec.ranged) group.notes.push(`${spec.type} with min,max is a ${spec.ranged}`)
    if (spec.hint) group.notes.push(spec.hint)
  }
  const types = groups.map((group) => [group.names.join('|'), group.takes && `{${group.takes}}`, group.notes.length > 0 && `(${group.notes.join(', ')})`].filter(Boolean).join(' ')).join('; ')
  return [
    'Arguments: title; note? (one line above the fields); fields:[{key,label,type,default?,…}] in order; buttons?:[label] or [{label,primary?}] (default ["OK"]).',
    `type: ${types}.`,
    'default is the starting value (select: an option; multi: a list of them; switch: true/false).',
  ].join(' ')
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const CONTAINERS = new Set(['Column', 'Row', 'List'])
const INPUTS = new Set(['TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'MediaPicker'])
const EVENT_NAME = /^[A-Za-z][\w.-]*$/
const FIELDS_MISSING = 'Give "fields": a list of {key, label, type}.'
const EMPTY: Raw = {}

function isRecord(value: unknown): value is Raw {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** Whether `/key` is a binding path of one segment (writeChatFormPath leaves the model alone for a bad path). */
function validKey(key: string) {
  return !key.includes('/') && writeChatFormPath(EMPTY, `/${key}`, true) !== EMPTY
}

/** Path keys (`{"/a/b": 1}`) rebuilt into a nested model; a plain key wins over a path key for the same place. */
function repairDataModel(model: unknown): unknown {
  if (!isRecord(model) || !Object.keys(model).some((key) => key.startsWith('/'))) return model
  let rebuilt: Raw = {}
  for (const [key, value] of Object.entries(model)) if (key.startsWith('/')) rebuilt = writeChatFormPath(rebuilt, key, value)
  const merge = (base: unknown, over: unknown): unknown => {
    if (!isRecord(base) || !isRecord(over)) return over
    const merged: Raw = { ...base }
    for (const [key, value] of Object.entries(over)) if (!UNSAFE_KEYS.has(key)) merged[key] = merge(base[key], value)
    return merged
  }
  return merge(rebuilt, Object.fromEntries(Object.entries(model).filter(([key]) => !key.startsWith('/'))))
}

/**
 * `steps` read as a step size or as the number of positions (1–50 with 1, 140–200 with 61, 1–6 with 6): dropped so the
 * default step applies. Over whole-number bounds a step of up to three decimals is meant (0–1 with 20 moves by 0.05).
 */
function repairSteps(component: Raw): Raw {
  const { min = 0, max, steps } = component
  if (component.component !== 'Slider' || typeof steps !== 'number') return component
  const step = ((max as number) - (min as number)) / steps
  const misread = steps === 1 || (Number.isInteger(min) && Number.isInteger(max) && Math.abs(step * 1000 - Math.round(step * 1000)) > 1e-6)
  if (!misread) return component
  const rest = { ...component }
  delete rest.steps
  return rest
}

/** A Text row that repeats the label of the input right after it (the row label already shows it). */
function repeatsLabel(caption: Raw | undefined, next: Raw | undefined) {
  if (caption?.component !== 'Text' || !next || !INPUTS.has(String(next.component))) return false
  const said = text(caption.text).toLowerCase()
  const label = text(next.label).toLowerCase()
  return Boolean(said) && (label === said || label.startsWith(`${said} `) || label.startsWith(`${said}(`))
}

function decodeA2ui(input: Raw): Decoded {
  const list = Array.isArray(input.components) ? input.components : []
  const byId = new Map(list.filter(isRecord).map((entry) => [String(entry.id), entry]))
  const buttonLabels = new Set(list.filter((entry) => isRecord(entry) && entry.component === 'Button').map((entry) => String((entry as Raw).child ?? '')))
  const components = list.map((entry) => {
    if (!isRecord(entry)) return entry
    if (!CONTAINERS.has(String(entry.component)) || !Array.isArray(entry.children)) return repairSteps(entry)
    const children = entry.children as unknown[]
    const kept = children.filter((child, index) => typeof child !== 'string' || buttonLabels.has(child) || !repeatsLabel(byId.get(child), byId.get(String(children[index + 1]))))
    return kept.length === children.length ? entry : { ...entry, children: kept }
  })
  return normalizeChatForm({ title: input.title, components, dataModel: repairDataModel(input.dataModel) })
}

class FieldProblem extends Error {}

function fail(message: string): never {
  throw new FieldProblem(message)
}

function optionList(options: unknown): unknown[] {
  if (!Array.isArray(options)) return []
  return options.map((option) => {
    if (typeof option === 'string') return { label: option, value: option.trim() }
    if (!isRecord(option)) return option
    const label = typeof option.label === 'string' ? option.label : option.text
    const value = typeof option.value === 'string' ? option.value : typeof option.value === 'number' ? String(option.value) : label
    return { label, value: typeof value === 'string' ? value.trim() : value }
  })
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === ''

/** A select/multi default held to its options: by value, else by label (trimmed, case-insensitive). */
function pickOptions(value: unknown, options: unknown[], key: string): string[] {
  const listed = (Array.isArray(value) ? value : [value]).filter((item) => !isEmpty(item))
  return listed.map((item) => {
    const wanted = typeof item === 'number' ? String(item) : typeof item === 'string' ? item.trim() : ''
    const known = options.filter(isRecord) as Array<{ label?: unknown; value?: unknown }>
    const loose = wanted.toLowerCase()
    const match = known.find((option) => option.value === wanted)
      ?? known.find((option) => typeof option.value === 'string' && option.value.toLowerCase() === loose)
      ?? known.find((option) => text(option.label).toLowerCase() === loose)
    if (!wanted || typeof match?.value !== 'string') fail(`Field "${key}": default "${typeof item === 'string' || typeof item === 'number' ? item : JSON.stringify(item)}" is not one of its options.`)
    return match.value as string
  })
}

function startingValue(spec: FieldType, value: unknown, options: unknown[], key: string): unknown {
  if (isEmpty(value)) return undefined
  switch (spec.component) {
    case 'ChoicePicker': return pickOptions(value, options, key)
    case 'CheckBox': {
      if (typeof value !== 'string') return value
      const word = value.trim().toLowerCase()
      return ['true', 'yes', 'on', '1'].includes(word) ? true : ['false', 'no', 'off', '0'].includes(word) ? false : value
    }
    case 'Slider': return typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value
    case 'MediaPicker': return typeof value === 'string' ? [value] : value
    default: return value
  }
}

/** A step size as the slider's `steps` (positions over the range), when it divides the range evenly. */
function stepsOf(min: unknown, max: unknown, step: unknown): number | undefined {
  if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number' || !(step > 0)) return undefined
  const exact = (max - min) / step
  const steps = Math.round(exact)
  return Math.abs(exact - steps) < 1e-9 && steps >= 1 && steps <= 1000 ? steps : undefined
}

function slug(label: string) {
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, CHAT_FORM_LIMITS.eventName).replace(/_+$/, '')
  return /^[a-z]/.test(name) ? name : ''
}

function decodeFields(input: Raw): Decoded {
  const fields = Array.isArray(input.fields) ? input.fields : []
  if (fields.length === 0) return { error: FIELDS_MISSING }
  try {
    const children: string[] = []
    const components: Raw[] = []
    const dataModel: Raw = {}
    const note = text(input.note) || text(input.description)
    if (note) {
      children.push('note')
      components.push({ id: 'note', component: 'Text', text: note, variant: 'caption' })
    }
    const keys = new Set<string>()
    const names: string[] = []
    fields.forEach((field, index) => {
      if (!isRecord(field)) fail(`Field ${index + 1}: give {key, label, type}.`)
      const given = [field.key, field.name, field.id].find((value) => typeof value === 'string' || typeof value === 'number')
      const written = given === undefined ? '' : String(given).trim()
      const base = written && validKey(written) ? written : `field_${index + 1}`
      let key = base
      for (let n = 2; keys.has(key); n += 1) key = `${base.slice(0, CHAT_FORM_LIMITS.id - String(n).length - 1)}_${n}`
      keys.add(key)
      names.push(written || key)
      const typeText = typeof field.type === 'string' && field.type.trim() ? field.type : 'text'
      let spec = FIELD_TYPE_LOOKUP.get(typeName(typeText))
      if (!spec) fail(`Field "${written || key}": type "${typeText}" is not offered (${FIELD_TYPES.map((entry) => entry.type).join(', ')}).`)
      if (spec.ranged && Number.isFinite(field.min) && Number.isFinite(field.max)) spec = FIELD_TYPE.get(spec.ranged)!
      const id = `f${index + 1}`
      const label = text(field.label) || written || key
      const value = { '@path': `/${key}` }
      const options = optionList(field.options)
      let component: Raw
      switch (spec.component) {
        case 'TextField':
          component = { id, component: 'TextField', label, value, variant: spec.variant, ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}) }
          break
        case 'ChoicePicker':
          component = { id, component: 'ChoicePicker', label, options, value, variant: spec.variant }
          break
        case 'Slider': {
          const min = field.min === undefined ? 0 : field.min
          const steps = stepsOf(min, field.max, field.step) ?? field.steps
          component = { id, component: 'Slider', label, min, max: field.max, value, ...(steps === undefined ? {} : { steps }) }
          break
        }
        case 'CheckBox':
          component = { id, component: 'CheckBox', label, value }
          break
        default:
          component = { id, component: 'MediaPicker', label, items: typeof field.items === 'string' ? [field.items] : field.items, value, variant: field.multiple === false ? 'mutuallyExclusive' : 'multipleSelection' }
      }
      const initial = startingValue(spec, field.default !== undefined ? field.default : isRecord(field.value) ? undefined : field.value, options, written || key)
      if (initial !== undefined) dataModel[key] = initial
      children.push(id)
      components.push(component)
    })
    const named = Array.isArray(input.buttons) && input.buttons.length > 0 ? input.buttons : null
    const fallback = [input.submit_label, input.submitLabel, input.submit].find((value) => typeof value === 'string' && value.trim())
    const events = new Set<string>()
    // A guessed call names its buttons one by one; the cancelling one is a second button, not a dropped key.
    const cancel = [input.cancel_label, input.cancelLabel, input.cancel].find((value) => typeof value === 'string' && value.trim())
    ;(named ?? [fallback ?? 'OK', ...(cancel ? [cancel] : [])]).forEach((button, index) => {
      const entry = isRecord(button) ? button : {}
      const label = typeof button === 'string' ? text(button) : text(entry.label) || text(entry.text)
      if (!label) fail(`Button ${index + 1}: give a "label".`)
      const asked = typeof entry.event === 'string' && EVENT_NAME.test(entry.event) && entry.event.length <= CHAT_FORM_LIMITS.eventName ? entry.event : ''
      let event = asked && !events.has(asked) ? asked : slug(label)
      for (let n = index + 1; !event || events.has(event); n += 1) event = `button_${n}`
      events.add(event)
      children.push(`b${index + 1}`)
      components.push(
        { id: `b${index + 1}`, component: 'Button', child: `t${index + 1}`, variant: entry.primary === true ? 'primary' : 'default', action: { event: { name: event } } },
        { id: `t${index + 1}`, component: 'Text', text: label },
      )
    })
    const decoded = decodeA2ui({ title: input.title, components: [{ id: 'root', component: 'Column', children }, ...components], dataModel })
    if (!('error' in decoded)) return decoded
    // normalizeChatForm names the generated component; the model wrote a field with a key and a default.
    return { error: decoded.error
      .replace(/^(?:TextField|CheckBox|ChoicePicker|Slider|MediaPicker) "f(\d+)"/, (whole, n: string) => (names[Number(n) - 1] ? `Field "${names[Number(n) - 1]}"` : whole))
      .replace('its dataModel value', 'its default')
      .replace(' of {"label", "value"}', '') }
  } catch (error) {
    if (error instanceof FieldProblem) return { error: error.message }
    throw error
  }
}

const a2uiFormat: ChatFormFormat = { id: 'a2ui', accepts: (input) => Array.isArray(input.components), decode: decodeA2ui }
const fieldsFormat: ChatFormFormat = { id: 'fields', accepts: () => true, decode: decodeFields }

/** The formats a show_form call may come in, checked in order. */
export const CHAT_FORM_FORMATS: ChatFormFormat[] = [a2uiFormat, fieldsFormat]

/** A model's show_form call, in any of the formats, as the card the chat stores; `{ error }` names what to correct. */
export function decodeChatForm(input: Record<string, unknown>): Decoded {
  const format = CHAT_FORM_FORMATS.find((entry) => entry.accepts(input))
  return format ? format.decode(input) : { error: FIELDS_MISSING }
}
