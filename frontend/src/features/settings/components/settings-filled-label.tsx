import type { ReactNode } from 'react'
import { ChatFilledMark } from '@/features/codex-chat/chat-page-context'

/** A setting label with the dot that marks a value the connected chat filled (ids from settings-chat-fields). */
export function ChatFilledLabel({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  return <span className="inline-flex items-center gap-2">{children}<ChatFilledMark fieldId={fieldId} /></span>
}
