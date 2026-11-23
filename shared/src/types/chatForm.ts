/**
 * An input card the chat puts under a reply (show_form): several values asked at once and answered with one press.
 * The payload is an A2UI v1.0 `createSurface` subset: a flat component list with one `root` container, inputs bound
 * to `dataModel` by `{"@path": "/key"}`, and buttons with an `event` action. The catalog is CoNAI's own (the A2UI
 * basic names and properties where they exist, plus `MediaPicker`); the app draws it with its shared controls.
 */
export const CHAT_FORM_LIMITS = {
  title: 80, label: 80, text: 400, placeholder: 80, fieldText: 2000, id: 40, eventName: 40,
  components: 40, inputs: 12, buttons: 3, minOptions: 2, options: 12, optionValue: 80, mediaItems: 24, pathDepth: 4,
} as const

export type ChatFormBinding = { '@path': string }

type ChatFormBase = { id: string }
/** Layout containers are read for their order only: the card is one flat column of rows. */
export type ChatFormContainer = ChatFormBase & { component: 'Column' | 'Row' | 'List'; children: string[] }
export type ChatFormText = ChatFormBase & { component: 'Text'; text: string; variant: 'caption' | 'body' }
export type ChatFormTextField = ChatFormBase & { component: 'TextField'; label: string; value: ChatFormBinding; placeholder?: string; variant: 'shortText' | 'longText' | 'number' }
export type ChatFormCheckBox = ChatFormBase & { component: 'CheckBox'; label: string; value: ChatFormBinding }
export type ChatFormChoicePicker = ChatFormBase & { component: 'ChoicePicker'; label: string; options: Array<{ label: string; value: string }>; value: ChatFormBinding; variant: 'mutuallyExclusive' | 'multipleSelection' }
export type ChatFormSlider = ChatFormBase & { component: 'Slider'; label: string; min: number; max: number; steps?: number; value: ChatFormBinding }
/** CoNAI's addition to the catalog: library media to pick from, by composite hash. */
export type ChatFormMediaPicker = ChatFormBase & { component: 'MediaPicker'; label: string; items: string[]; value: ChatFormBinding; variant: 'mutuallyExclusive' | 'multipleSelection' }
export type ChatFormButton = ChatFormBase & { component: 'Button'; child: string; variant: 'default' | 'primary'; action: { event: { name: string } } }

export type ChatFormInput = ChatFormTextField | ChatFormCheckBox | ChatFormChoicePicker | ChatFormSlider | ChatFormMediaPicker
export type ChatFormComponent = ChatFormContainer | ChatFormText | ChatFormInput | ChatFormButton

export type ChatFormProposal = {
  kind: 'form'
  title: string
  /** Checked and with defaults filled (see normalizeChatForm); only what the root reaches is kept. */
  components: ChatFormComponent[]
  /** The inputs' starting values, at their paths. */
  dataModel: Record<string, unknown>
}

/** What a sent message answered: the card, the pressed button's event and the values as the person left them. */
export type ChatFormAnswer = { proposalId: number; action: string; values: Record<string, unknown> }
