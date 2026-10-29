/** A profile, lorebook or display block input the server will not save; the message is shown as is. */
export class ChatProfileError extends Error {}

/** A revision-checked editor write found a newer record. */
export class ChatRevisionConflict extends Error {
  constructor(readonly current: unknown) { super('다른 곳에서 바뀌었어.') }
}
