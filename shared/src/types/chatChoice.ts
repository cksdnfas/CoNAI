/**
 * A question the chat puts to the person with ready answers (offer_choices). It shows above the composer while it is
 * the latest thing in the chat; the next message the person sends answers it or, typed freely, sets it aside.
 */
export type ChatChoiceOption = {
  label: string
  detail?: string
  /** Choosing it sends that one message without the connected page, so the tools a page connection withholds come back. */
  withoutPage?: boolean
}

export type ChatChoiceProposal = {
  kind: 'choice'
  question: string
  options: ChatChoiceOption[]
  /** Several options may be picked together. */
  multiple: boolean
}

/** What a sent message answered: the card and the labels picked from it. */
export type ChatChoiceAnswer = { proposalId: number; answers: string[] }

export const CHAT_CHOICE_LIMITS = { question: 200, label: 80, detail: 160, minOptions: 2, maxOptions: 6 } as const
