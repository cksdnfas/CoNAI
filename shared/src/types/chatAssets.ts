export type ChatAssetKind = 'expression' | 'background' | 'full' | 'avatar' | 'reference'
export type ChatAssetSlotInput = { slotKey: string; kind: Exclude<ChatAssetKind, 'expression'>; prompt: string; size?: string; inputs?: Record<string, unknown> }
export type ChatAssetBatchInput = {
  /** Reuse this key for retries of the same create request. */
  idempotencyKey: string
  presetId: number
  expressionPresetId?: number
  /** Emotion names from that prompt preset; omitted means every entry. */
  expressions?: string[]
  slots?: ChatAssetSlotInput[]
  /** ComfyUI: the text field receiving the slot prompt; omitted, the preset's chosen field or the only clear one. */
  promptField?: string
}
export type ChatAssetApplyInput = { avatarCrop?: { x: number; y: number; scale: number } | null }
export type ChatAssetReview = {
  expression: { expected: string[]; matched: string[]; matches: boolean | null } | null
  hair: { reference: string[]; candidate: string[]; matches: boolean | null }
  eyes: { reference: string[]; candidate: string[]; matches: boolean | null }
  rating: Record<string, number>
  similarSlots: Array<{ slotKey: string; compositeHash: string; confidence: number }>
  /**
   * The judge's reading of the image tags (profiles whose judge preset reviews assets): the emotion it picked among
   * the batch's expressions and the probability it gave this slot's own emotion.
   */
  judge?: { picked: string; probability: number } | null
}
export type ChatAssetVisionReview = { compositeHash: string; referenceHash: string; modelSlotId: number; samePerson: boolean; expression: string; flaw: string | null }
export type ChatAssetCandidate = { compositeHash: string; historyId: number; review?: ChatAssetReview }
export type ChatAssetAttempt = {
  jobId: number
  createdAt: string
  useCurrentPreset: boolean
  referenceHash: string | null
  status: string
  failureCode: string | null
  cancelRequested: boolean
  candidates: ChatAssetCandidate[]
}
export type ChatAssetBatch = {
  id: number
  accountId: number | null
  profileId: number
  presetId: number
  createdAt: string
  snapshot: { preset: Record<string, unknown>; appearance: string; referenceHash: string | null; slots: Array<{ slotKey: string; kind: ChatAssetKind; prompt: string }> }
  slots: Array<{ slotKey: string; kind: ChatAssetKind; prompt: string; chosenHash: string | null; status: string; attempts: ChatAssetAttempt[] }>
}
export type ChatAssetApplyResult = { profileId: number; applied: { profileFields: string[]; expressionSlots: string[]; expressionGroupId: number | null; backgroundGroupId: number | null } }

/** Creation and application are separate approvals; applying binds the chosen hashes shown on the card. */
export type ChatProfileAssetsProposal = {
  kind: 'profile_assets'
  profileId: number
  profileName: string
  savedId?: number | null
} & (
  | { action: 'create'; input: ChatAssetBatchInput }
  /** `picks`: candidates the chat chose (slot → hash); approving picks them first, then applies every chosen slot. */
  | { action: 'apply'; batchId: number; chosenHashes: Record<string, string>; picks?: Record<string, string>; input: ChatAssetApplyInput }
)
