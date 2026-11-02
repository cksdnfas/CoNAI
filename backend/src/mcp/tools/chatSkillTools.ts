import type { McpServer } from '@modelcontextprotocol/server';
import { CHAT_SKILL_LIMITS } from '@conai/shared';
import { z } from 'zod';
import { fillCharacterPlaceholders } from '../../services/codex-chat/chatPlaceholders';
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles';
import { ChatSkillStore, skillNameKey, skillResultText, USE_SKILL_TOOL } from '../../services/codex-chat/chatSkills';
import { userPersonaForThread } from '../../services/codex-chat/chatUserProfiles';
import { CodexChatStore } from '../../services/codex-chat/codexChatStore';
import type { McpRequestContext } from '../context';
import { errorResult } from '../toolResults';

/**
 * use_skill: the instructions of one of the speaking profile's skills (see chatSkills), by the name the system
 * prompt's skill list shows. Offered in a chat whose profile links a skill; a Codex session keeps its first tool
 * list, so it always has it. Every call reads the links again, so an unlinked skill is gone at once.
 */
export function registerChatSkillTools(server: McpServer, context: McpRequestContext): void {
  const chatContext = context.chatContext;
  if (!chatContext) return;
  const linkedSkills = () => ChatSkillStore.skillsOf(ChatProfileStore.find(chatContext.profileId)?.skillIds ?? []);
  if (context.source !== 'codex-chat' && linkedSkills().length === 0) return;
  server.registerTool(USE_SKILL_TOOL, {
    description: 'Load the instructions of one of your skills. The Skills list in your instructions names each skill and says when it applies. Call this before you handle a request a skill covers, then follow what it returns.',
    inputSchema: z.object({
      name: z.string().trim().min(1).max(CHAT_SKILL_LIMITS.name).describe('The skill name exactly as the Skills list shows it'),
      offset: z.number().int().min(0).optional().describe('Only to continue a long skill: the offset the previous result gave'),
    }),
  }, ({ name, offset }) => {
    try {
      const profile = ChatProfileStore.find(chatContext.profileId);
      if (!profile) throw new Error('Chat profile not found.');
      const skills = ChatSkillStore.skillsOf(profile.skillIds);
      const skill = skills.find((item) => skillNameKey(item.name) === skillNameKey(name));
      if (!skill) throw new Error(`No skill named "${name}". Your skills: ${skills.map((item) => `"${item.name}"`).join(', ') || '(none)'}.`);
      const user = userPersonaForThread(CodexChatStore.findThread(chatContext.threadId, context.requester?.accountId ?? null));
      const instructions = fillCharacterPlaceholders(skill.instructions, profile, user);
      return { content: [{ type: 'text' as const, text: skillResultText(skill, instructions, offset ?? 0, profile.toolOutputLimit) }] };
    } catch (error) {
      return errorResult(error);
    }
  });
}
