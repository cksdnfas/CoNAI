import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { ChatGenerationPresetStore } from '../codex-chat/chatGenerationPresets'
import { ChatLorebookStore } from '../codex-chat/chatLorebook'
import { OwnedLorebookStore } from '../codex-chat/chatLorebookFiles'
import { ChatProfileStore } from '../codex-chat/chatProfiles'
import { CodexChatStore } from '../codex-chat/codexChatStore'
import { fileOwnerKey } from '../fileStoreService'
import { PostCategoryStore } from '../posts/postStore'
import type { NodeOptionContext, NodeOptionSource } from './node-option-sources'

/** The asking account; null is the bootstrap owner only while no accounts are configured, otherwise nobody. */
function askingOwner(context: NodeOptionContext) {
  if (context.accountId !== null) return { accountId: context.accountId as number | null, fileOwner: fileOwnerKey(context.accountId) }
  return hasConfiguredAuth() ? null : { accountId: null, fileOwner: fileOwnerKey(null) }
}

/** Option lists for chat-data node fields (generation presets, lorebooks, chat rooms). */
export const CHAT_NODE_OPTION_SOURCES: Record<string, NodeOptionSource> = {
  chat_generation_presets: () => ChatGenerationPresetStore.list().map((preset) => ({
    value: String(preset.id),
    label: `${preset.name} · ${preset.kind === 'nai' ? 'NAI' : 'ComfyUI'}`,
  })),

  // Global books, then the asking account's own books.
  chat_lorebooks: (context) => {
    const owner = askingOwner(context)
    const books = [...ChatLorebookStore.list(), ...(owner ? OwnedLorebookStore.list(owner.fileOwner) : [])]
    return books.map((book) => ({ value: String(book.id), label: book.name }))
  },

  // Board categories as paths (창작 / 일러스트), in tree order.
  post_categories: () => {
    const categories = PostCategoryStore.list()
    const byId = new Map(categories.map((category) => [category.id, category]))
    const pathOf = (id: number | null, depth = 0): string[] => {
      const category = id === null ? undefined : byId.get(id)
      return category && depth < 8 ? [...pathOf(category.parentId, depth + 1), category.name] : []
    }
    return categories
      .map((category) => ({ value: String(category.id), label: pathOf(category.id).join(' / ') }))
      .sort((left, right) => left.label.localeCompare(right.label))
  },

  // The asking account's chats and group rooms, most recent first.
  chat_rooms: (context) => {
    const owner = askingOwner(context)
    if (!owner) return []
    const profileNames = new Map(ChatProfileStore.list().map((profile) => [profile.id, profile.name]))
    return CodexChatStore.listThreads(owner.accountId).map((thread) => ({
      value: String(thread.id),
      label: thread.title.trim() || (thread.profile_id !== null ? profileNames.get(thread.profile_id) : undefined) || `채팅 ${thread.id}`,
    }))
  },
}
