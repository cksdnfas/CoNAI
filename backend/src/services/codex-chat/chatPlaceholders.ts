import type { ChatProfile } from './chatProfiles'
import { DEFAULT_USER_NAME, type ChatUserPersona } from './chatUserProfiles'

/** `{{char}}` / `{{user}}` placeholders, as character cards write them; `user` is the chat's user profile (else the plain user). */
export function fillCharacterPlaceholders(text: string, profile: Pick<ChatProfile, 'name'>, user?: Pick<ChatUserPersona, 'name'> | null) {
  return text.replace(/\{\{\s*char\s*\}\}/gi, profile.name).replace(/\{\{\s*user\s*\}\}/gi, user?.name ?? DEFAULT_USER_NAME)
}
