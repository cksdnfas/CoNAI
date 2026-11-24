import { CHAT_FORM_LIMITS, type ChatFormBinding, type ChatFormButton, type ChatFormComponent, type ChatFormInput, type ChatFormProposal, type ChatFormSlider, type ChatFormText } from '../types/chatForm'

/** The catalog a form may use; `Divider` is accepted and not drawn (rows already sit on hairlines). */
export const CHAT_FORM_CATALOG = ['Column', 'Row', 'List', 'Text', 'Divider', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'MediaPicker', 'Button'] as const

const CONTAINERS = new Set(['Column', 'Row', 'List'])
const INPUTS = new Set(['TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'MediaPicker'])
const PATH_SEGMENT = /^[A-Za-z0-9_-]{1,40}$/
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const EVENT_NAME = /^[A-Za-z][\w.-]*$/
/** A library media id as the model writes it: the bare composite hash or a `media:<hash>.<ext>` link. */
const MEDIA_ITEM = /^(?:media:)?([a-f0-9]{48}|[a-f0-9]{32})(?:\.[a-z0-9]{2,5})?$/

type Raw = Record<string, unknown>

/** Thrown inside the checks below and returned as `{ error }`: the text is what the model reads to correct its call. */
class ChatFormProblem extends Error {}

function fail(message: string): never {
  throw new ChatFormProblem(message)
}

function isRecord(value: unknown): value is Raw {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pathSegments(path: unknown): string[] | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null
  const segments = path.slice(1).split('/')
  if (segments.length > CHAT_FORM_LIMITS.pathDepth || segments.some((segment) => !PATH_SEGMENT.test(segment) || UNSAFE_SEGMENTS.has(segment))) return null
  return segments
}

/** The value at a binding's path (`/a/b`), or undefined. */
export function readChatFormPath(model: unknown, path: string): unknown {
  let value: unknown = model
  for (const segment of pathSegments(path) ?? []) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined
    value = value[segment]
  }
  return value
}

/** A copy of the model with the value set at a binding's path; the model itself is left alone. */
export function writeChatFormPath(model: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = pathSegments(path)
  if (!segments) return model
  const set = (node: unknown, depth: number): Raw => {
    const base: Raw = isRecord(node) ? { ...node } : {}
    base[segments[depth]] = depth === segments.length - 1 ? value : set(base[segments[depth]], depth + 1)
    return base
  }
  return set(model, 0)
}

function literal(raw: Raw, key: string, max: number, where: string): string {
  const value = raw[key]
  if (isRecord(value)) fail(`${where}: "${key}" must be a literal string here (no {"@path"} or function call).`)
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text) fail(`${where}: "${key}" is required.`)
  if (text.length > max) fail(`${where}: "${key}" is longer than ${max} characters.`)
  return text
}

function binding(raw: Raw, where: string): ChatFormBinding {
  const value = raw.value
  const path = isRecord(value) ? value['@path'] : undefined
  if (!pathSegments(path)) fail(`${where}: "value" must be {"@path": "/key"} naming where the value lives in dataModel (letters, digits, _ and -, up to ${CHAT_FORM_LIMITS.pathDepth} levels).`)
  return { '@path': path as string }
}

function selection(value: unknown, allowed: readonly string[], single: boolean, where: string, read: (item: string) => string = (item) => item): string[] {
  const list = value === undefined || value === null || value === '' ? [] : Array.isArray(value) ? value : [value]
  const picked = [...new Set(list.map((item) => (typeof item === 'string' ? read(item) : '')))]
  const unknown = picked.find((item) => !allowed.includes(item))
  if (unknown !== undefined) fail(`${where}: ${unknown ? `the value "${unknown}"` : 'a value'} is not one of its ${allowed.length} choices.`)
  if (single && picked.length > 1) fail(`${where}: it takes one value (variant "mutuallyExclusive").`)
  return picked
}

function mediaHash(item: string) {
  return MEDIA_ITEM.exec(item.trim())?.[1] ?? ''
}

function inputComponent(raw: Raw, id: string, model: unknown): { component: ChatFormInput; value: unknown } {
  const where = `${String(raw.component)} "${id}"`
  const label = literal(raw, 'label', CHAT_FORM_LIMITS.label, where)
  const value = binding(raw, where)
  const initial = readChatFormPath(model, value['@path'])
  switch (raw.component) {
    case 'TextField': {
      if (raw.variant === 'obscured') fail(`${where}: "obscured" is not offered. Never ask for passwords or keys in a form.`)
      const variant = raw.variant === 'longText' || raw.variant === 'number' ? raw.variant : 'shortText'
      const text = initial === undefined || initial === null ? '' : typeof initial === 'string' || typeof initial === 'number' ? String(initial) : fail(`${where}: its dataModel value must be a string.`)
      if (text.length > CHAT_FORM_LIMITS.fieldText) fail(`${where}: its dataModel value is longer than ${CHAT_FORM_LIMITS.fieldText} characters.`)
      if (variant === 'number' && text.trim() && !Number.isFinite(Number(text))) fail(`${where}: its dataModel value must be a number.`)
      const placeholder = raw.placeholder === undefined || raw.placeholder === '' ? undefined : literal(raw, 'placeholder', CHAT_FORM_LIMITS.placeholder, where)
      return { component: { id, component: 'TextField', label, value, variant, ...(placeholder ? { placeholder } : {}) }, value: text }
    }
    case 'CheckBox': {
      if (initial !== undefined && typeof initial !== 'boolean') fail(`${where}: its dataModel value must be true or false.`)
      return { component: { id, component: 'CheckBox', label, value }, value: initial === true }
    }
    case 'ChoicePicker': {
      const options = Array.isArray(raw.options) ? raw.options : []
      if (options.length < CHAT_FORM_LIMITS.minOptions || options.length > CHAT_FORM_LIMITS.options) fail(`${where}: "options" needs ${CHAT_FORM_LIMITS.minOptions} to ${CHAT_FORM_LIMITS.options} entries of {"label", "value"}.`)
      const read = options.map((option, index) => {
        if (!isRecord(option)) fail(`${where}: option ${index + 1} must be {"label", "value"}.`)
        const optionValue = typeof option.value === 'string' ? option.value.trim() : ''
        if (!optionValue || optionValue.length > CHAT_FORM_LIMITS.optionValue) fail(`${where}: option ${index + 1} needs a "value" string of up to ${CHAT_FORM_LIMITS.optionValue} characters.`)
        return { label: literal(option, 'label', CHAT_FORM_LIMITS.label, `${where} option ${index + 1}`), value: optionValue }
      })
      if (new Set(read.map((option) => option.value)).size !== read.length) fail(`${where}: each option needs its own "value".`)
      const variant = raw.variant === 'multipleSelection' ? 'multipleSelection' : 'mutuallyExclusive'
      return { component: { id, component: 'ChoicePicker', label, options: read, value, variant }, value: selection(initial, read.map((option) => option.value), variant === 'mutuallyExclusive', where) }
    }
    case 'Slider': {
      const min = raw.min === undefined ? 0 : raw.min
      if (typeof min !== 'number' || typeof raw.max !== 'number' || !Number.isFinite(min) || !Number.isFinite(raw.max) || raw.max <= min) fail(`${where}: "max" must be a number above "min" (default 0).`)
      const steps = raw.steps
      if (steps !== undefined && (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1 || steps > 1000)) fail(`${where}: "steps" must be a whole number from 1 to 1000.`)
      if (initial !== undefined && (typeof initial !== 'number' || !Number.isFinite(initial))) fail(`${where}: its dataModel value must be a number.`)
      const max = raw.max as number
      return { component: { id, component: 'Slider', label, min: min as number, max, value, ...(steps === undefined ? {} : { steps: steps as number }) }, value: Math.min(max, Math.max(min as number, initial === undefined ? min as number : initial as number)) }
    }
    default: {
      const listed = Array.isArray(raw.items) ? raw.items : []
      const items = [...new Set(listed.map((item) => (typeof item === 'string' ? mediaHash(item) : '')))]
      if (items.length === 0 || items.length > CHAT_FORM_LIMITS.mediaItems || items.includes('')) fail(`${where}: "items" needs 1 to ${CHAT_FORM_LIMITS.mediaItems} library media ids (a composite hash or "media:<hash>.<ext>").`)
      const variant = raw.variant === 'mutuallyExclusive' ? 'mutuallyExclusive' : 'multipleSelection'
      return { component: { id, component: 'MediaPicker', label, items, value, variant }, value: selection(initial, items, variant === 'mutuallyExclusive', where, mediaHash) }
    }
  }
}

/**
 * A model's `show_form` call as the card the chat stores: every reference resolved, defaults filled, the data model
 * rebuilt from the inputs' own paths. `{ error }` names the first thing to correct.
 */
export function normalizeChatForm(input: { title?: unknown; components?: unknown; dataModel?: unknown }): ChatFormProposal | { error: string } {
  try {
    const title = literal({ title: input.title }, 'title', CHAT_FORM_LIMITS.title, 'show_form')
    const list = Array.isArray(input.components) ? input.components : []
    if (list.length === 0 || list.length > CHAT_FORM_LIMITS.components) fail(`"components" needs 1 to ${CHAT_FORM_LIMITS.components} entries.`)
    if (input.dataModel !== undefined && !isRecord(input.dataModel)) fail('"dataModel" must be an object.')
    const byId = new Map<string, Raw>()
    for (const entry of list) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > CHAT_FORM_LIMITS.id) fail(`Every component needs an "id" string of up to ${CHAT_FORM_LIMITS.id} characters.`)
      if (byId.has(entry.id)) fail(`Two components share the id "${entry.id}".`)
      if (!(CHAT_FORM_CATALOG as readonly string[]).includes(String(entry.component))) fail(`Component "${entry.id}": "${String(entry.component)}" is not in the catalog (${CHAT_FORM_CATALOG.join(', ')}).`)
      byId.set(entry.id, entry)
    }
    const root = byId.get('root')
    if (!root || !CONTAINERS.has(String(root.component))) fail('One component must have the id "root" and be a Column.')

    // The card is one flat column: containers give the order, each other component is listed once.
    const order: string[] = []
    const walk = (id: string, trail: ReadonlySet<string>) => {
      const raw = byId.get(id)
      if (!raw) fail(`A "children" list names "${id}", which is not among the components.`)
      if (!CONTAINERS.has(String(raw.component))) {
        if (raw.component !== 'Divider' && !order.includes(id)) order.push(id)
        return
      }
      if (trail.has(id)) fail(`The container "${id}" contains itself.`)
      if (!Array.isArray(raw.children) || raw.children.some((child) => typeof child !== 'string')) fail(`Container "${id}": "children" must be a list of component ids (templates are not offered).`)
      for (const child of raw.children as string[]) walk(child, new Set([...trail, id]))
    }
    walk('root', new Set())

    const labelIds = new Set(order.filter((id) => byId.get(id)!.component === 'Button').map((id) => String(byId.get(id)!.child ?? '')))
    const rows: ChatFormComponent[] = []
    const labels: ChatFormText[] = []
    const paths: string[] = []
    let dataModel: Record<string, unknown> = {}
    let inputs = 0
    for (const id of order) {
      const raw = byId.get(id)!
      if (raw.component === 'Text') {
        if (labelIds.has(id)) continue
        rows.push({ id, component: 'Text', text: literal(raw, 'text', CHAT_FORM_LIMITS.text, `Text "${id}"`), variant: raw.variant === 'caption' ? 'caption' : 'body' })
      } else if (raw.component === 'Button') {
        const child = byId.get(String(raw.child ?? ''))
        if (!child || child.component !== 'Text') fail(`Button "${id}": "child" must be the id of a Text component holding its label.`)
        const event = isRecord(raw.action) && isRecord(raw.action.event) ? raw.action.event.name : undefined
        if (typeof event !== 'string' || !EVENT_NAME.test(event) || event.length > CHAT_FORM_LIMITS.eventName) fail(`Button "${id}": "action" must be {"event": {"name": "<name>"}} (letters, digits, _ . -; function calls are not offered).`)
        if (!labels.some((label) => label.id === raw.child)) labels.push({ id: String(raw.child), component: 'Text', text: literal(child, 'text', CHAT_FORM_LIMITS.label, `Button "${id}" label`), variant: 'body' })
        rows.push({ id, component: 'Button', child: String(raw.child), variant: raw.variant === 'primary' ? 'primary' : 'default', action: { event: { name: event } } })
      } else if (INPUTS.has(String(raw.component))) {
        inputs += 1
        if (inputs > CHAT_FORM_LIMITS.inputs) fail(`A form takes up to ${CHAT_FORM_LIMITS.inputs} inputs.`)
        const { component, value } = inputComponent(raw, id, input.dataModel)
        const path = component.value['@path']
        if (paths.some((other) => other === path || other.startsWith(`${path}/`) || path.startsWith(`${other}/`))) fail(`${component.component} "${id}": the path "${path}" overlaps another input's path.`)
        paths.push(path)
        dataModel = writeChatFormPath(dataModel, path, value)
        rows.push(component)
      }
    }
    const buttons = rows.filter((row): row is ChatFormButton => row.component === 'Button')
    if (buttons.length === 0) fail('Add at least one Button: pressing it sends the values as the person\'s next message.')
    if (buttons.length > CHAT_FORM_LIMITS.buttons) fail(`A form takes up to ${CHAT_FORM_LIMITS.buttons} buttons.`)
    if (new Set(buttons.map((button) => button.action.event.name)).size !== buttons.length) fail('Each Button needs its own event name.')
    // One primary action: the first marked one, else the first button.
    const primary = buttons.find((button) => button.variant === 'primary') ?? buttons[0]
    for (const button of buttons) button.variant = button === primary ? 'primary' : 'default'
    return { kind: 'form', title, components: [{ id: 'root', component: 'Column', children: rows.map((row) => row.id) }, ...rows, ...labels], dataModel }
  } catch (error) {
    if (error instanceof ChatFormProblem) return { error: error.message }
    throw error
  }
}

export type ChatFormLayout = {
  /** Texts and inputs in reading order. */
  rows: Array<ChatFormText | ChatFormInput>
  buttons: Array<{ event: string; label: string; primary: boolean }>
}

/** A stored form as the card draws it: its rows in order and its buttons with their labels. */
export function chatFormLayout(form: Pick<ChatFormProposal, 'components'>): ChatFormLayout {
  const byId = new Map(form.components.map((component) => [component.id, component]))
  const root = byId.get('root')
  const ordered = (root && 'children' in root ? root.children : []).map((id) => byId.get(id)).filter((component): component is ChatFormComponent => component !== undefined)
  return {
    rows: ordered.filter((component): component is ChatFormText | ChatFormInput => component.component === 'Text' || INPUTS.has(component.component)),
    buttons: ordered.filter((component): component is ChatFormButton => component.component === 'Button').map((button) => {
      const label = byId.get(button.child)
      return { event: button.action.event.name, label: label?.component === 'Text' ? label.text : button.action.event.name, primary: button.variant === 'primary' }
    }),
  }
}

/** How far one step of a slider moves: the range over its `steps`, else whole numbers, else a hundredth of the range. */
export function chatFormSliderStep(slider: Pick<ChatFormSlider, 'min' | 'max' | 'steps'>) {
  if (slider.steps) return (slider.max - slider.min) / slider.steps
  return Number.isInteger(slider.min) && Number.isInteger(slider.max) ? 1 : (slider.max - slider.min) / 100
}

/**
 * The values a person sent for a form, held to its inputs: every input present, of its type, within its choices and
 * range. Anything else in the object is dropped. `{ error }` when a value does not fit the card.
 */
export function normalizeChatFormValues(form: Pick<ChatFormProposal, 'components'>, values: unknown): { values: Record<string, unknown> } | { error: string } {
  let model: Record<string, unknown> = {}
  try {
    for (const input of chatFormLayout(form).rows) {
      if (input.component === 'Text') continue
      const path = input.value['@path']
      const value = readChatFormPath(values, path)
      const unfit = (): never => fail(`${input.component} "${input.id}": the sent value does not fit this input.`)
      let checked: unknown
      if (input.component === 'TextField') {
        if (typeof value !== 'string' || value.length > CHAT_FORM_LIMITS.fieldText || (input.variant === 'number' && value.trim() !== '' && !Number.isFinite(Number(value)))) unfit()
        checked = value
      } else if (input.component === 'CheckBox') {
        if (typeof value !== 'boolean') unfit()
        checked = value
      } else if (input.component === 'Slider') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < input.min || value > input.max) unfit()
        checked = value
      } else {
        if (!Array.isArray(value)) unfit()
        checked = selection(value, input.component === 'ChoicePicker' ? input.options.map((option) => option.value) : input.items, input.variant === 'mutuallyExclusive', `${input.component} "${input.id}"`)
      }
      model = writeChatFormPath(model, path, checked)
    }
  } catch (error) {
    if (error instanceof ChatFormProblem) return { error: error.message }
    throw error
  }
  return { values: model }
}

const NAME_MAX = 80

function clip(text: string) {
  return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1)}…` : text
}

function numberText(value: number) {
  return String(Number.isInteger(value) ? value : Number(value.toFixed(2)))
}

/**
 * A form's answer as lines: `name` is what the person reads on their message, `content` what the model reads. An empty
 * text field says nothing; the pressed button is named when the form has several, or when nothing else was filled.
 */
export function chatFormAnswerLines(form: Pick<ChatFormProposal, 'components'>, values: Record<string, unknown>, action: string): Array<{ name: string; content: string }> {
  const { rows, buttons } = chatFormLayout(form)
  const lines: Array<{ name: string; content: string }> = []
  for (const input of rows) {
    if (input.component === 'Text') continue
    const value = readChatFormPath(values, input.value['@path'])
    if (input.component === 'TextField') {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text) lines.push({ name: clip(text), content: `${input.label}: ${text}` })
    } else if (input.component === 'CheckBox') {
      lines.push({ name: value === true ? input.label : `${input.label} ✗`, content: `${input.label}: ${value === true ? 'yes' : 'no'}` })
    } else if (input.component === 'Slider') {
      const text = numberText(typeof value === 'number' ? value : input.min)
      lines.push({ name: `${input.label} ${text}`, content: `${input.label}: ${text}` })
    } else {
      const picked = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
      const shown = input.component === 'ChoicePicker'
        ? picked.map((item) => input.options.find((option) => option.value === item)?.label ?? item).join(', ')
        : picked.length ? `${input.label} ${picked.length}` : ''
      lines.push({ name: clip(shown || `${input.label} ✗`), content: `${input.label}: ${picked.length ? picked.join(', ') : 'none'}` })
    }
  }
  const pressed = buttons.find((button) => button.event === action)
  if (pressed && (buttons.length > 1 || lines.length === 0)) lines.push({ name: pressed.label, content: `Pressed: ${pressed.label}` })
  return lines
}
