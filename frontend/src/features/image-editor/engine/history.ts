/** One undoable edit. Raster edits keep only the changed region before and after. */
export type HistoryEntry = {
  bytes: number
  undo: () => void
  redo: () => void
}

/** Command history trimmed by memory, not by count. */
export class EditorHistory {
  private done: HistoryEntry[] = []
  private undone: HistoryEntry[] = []
  private totalBytes = 0
  /** Count of entries ever pushed minus undone ones; lets the editor tell "changed since load". */
  private revision = 0

  private readonly budgetBytes: number

  constructor(budgetBytes: number) {
    this.budgetBytes = budgetBytes
  }

  push(entry: HistoryEntry) {
    this.done.push(entry)
    this.totalBytes += entry.bytes
    for (const dropped of this.undone) {
      this.totalBytes -= dropped.bytes
    }
    this.undone = []
    this.revision += 1
    while (this.totalBytes > this.budgetBytes && this.done.length > 1) {
      const oldest = this.done.shift()
      this.totalBytes -= oldest?.bytes ?? 0
    }
  }

  undo() {
    const entry = this.done.pop()
    if (!entry) return false
    entry.undo()
    this.undone.push(entry)
    this.revision -= 1
    return true
  }

  redo() {
    const entry = this.undone.pop()
    if (!entry) return false
    entry.redo()
    this.done.push(entry)
    this.revision += 1
    return true
  }

  clear() {
    this.done = []
    this.undone = []
    this.totalBytes = 0
    this.revision = 0
  }

  get canUndo() {
    return this.done.length > 0
  }

  get canRedo() {
    return this.undone.length > 0
  }

  /** Non-zero when the document differs from the loaded one (trimmed history still counts as changed). */
  get dirty() {
    return this.revision !== 0
  }
}
