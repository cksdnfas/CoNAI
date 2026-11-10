import type { McpServer } from '@modelcontextprotocol/server';
import { CHAT_SKILL_LIMITS, skillSectionPathKey } from '@conai/shared';
import { z } from 'zod';
import { fillCharacterPlaceholders } from '../../services/codex-chat/chatPlaceholders';
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles';
import { searchSkills } from '../../services/codex-chat/chatSkillSearch';
import {
  ChatSkillStore, skillContents, skillNameKey, skillOverviewText, skillResultText, skillSectionsText, USE_SKILL_TOOL,
} from '../../services/codex-chat/chatSkills';
import { userPersonaForThread } from '../../services/codex-chat/chatUserProfiles';
import { CodexChatStore } from '../../services/codex-chat/codexChatStore';
import type { McpRequestContext } from '../context';
import { errorResult } from '../toolResults';
import { presetGuidesInTools } from './chatGenerationTools';

/**
 * use_skill: one of the speaking profile's skills (see chatSkills), by the name the system prompt's skill list shows —
 * the overview with its table of sections, the sections asked for, a group's table, or a search of the skills' text.
 * Offered in a chat whose profile links a skill; a Codex session keeps its first tool list, so it always has it.
 * Every call reads the links again, so an unlinked skill (or one whose plugin is off) is gone at once.
 */
export function registerChatSkillTools(server: McpServer, context: McpRequestContext): void {
  const chatContext = context.chatContext;
  if (!chatContext) return;
  const linkedSkills = () => ChatSkillStore.linked(ChatProfileStore.find(chatContext.profileId)?.skillIds ?? []);
  if (context.source !== 'codex-chat' && linkedSkills().length === 0) return;
  server.registerTool(USE_SKILL_TOOL, {
    description: 'Load a linked skill when its Skills-list trigger fits; follow loaded instructions. Read its overview/table first, then only needed sections. If unsure which skill/section, search with query; if a path is missing, reload the table.',
    inputSchema: z.object({
      name: z.string().trim().min(1).max(CHAT_SKILL_LIMITS.name).optional().describe('The skill name exactly as the Skills list shows it (leave it out only to search all your skills with query)'),
      section: z.string().trim().min(1).max(CHAT_SKILL_LIMITS.sectionPath * CHAT_SKILL_LIMITS.sections).optional().describe('A section path from the table of contents; several separated by commas; "group/" lists that group'),
      query: z.string().trim().min(1).max(200).optional().describe('Search skill text; with name searches only that skill. Do not combine with section.'),
      offset: z.number().int().min(0).optional().describe('Only to continue a long result: the offset the previous result gave'),
    }),
  }, async ({ name, section, query, offset }) => {
    try {
      const profile = ChatProfileStore.find(chatContext.profileId);
      if (!profile) throw new Error('Chat profile not found.');
      const skills = ChatSkillStore.linked(profile.skillIds);
      const named = name === undefined ? null : skills.find((item) => skillNameKey(item.name) === skillNameKey(name));
      if (name !== undefined && !named) throw new Error(`No skill named "${name}". Your skills: ${skills.map((item) => `"${item.name}"`).join(', ') || '(none)'}.`);
      const user = userPersonaForThread(CodexChatStore.findThread(chatContext.threadId, context.requester?.accountId ?? null));
      const fill = (text: string) => fillCharacterPlaceholders(text, profile, user);
      const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

      if (query !== undefined) {
        if (section !== undefined) throw new Error('Give either section or query, not both.');
        const hits = await searchSkills(named ? [named.id] : skills.map((item) => item.id), query);
        if (hits.length === 0) return text(`Nothing in ${named ? `skill "${named.name}"` : 'your skills'} matches "${query}". Load a skill by name to read its table of contents.`);
        // As many hits as the profile's tool output limit holds, best first; the count of the rest says to narrow down.
        const lines = [`Matches for "${query}", best first. Load one with ${USE_SKILL_TOOL} (name, and section for a section):`];
        const rest = (count: number) => `\n(${count} more matches did not fit; search with more specific words.)`;
        let size = lines[0].length + rest(hits.length).length;
        for (const hit of hits) {
          const line = `- skill "${hit.skillName}"${hit.path === null ? ' (overview)' : ` section "${hit.path}"`} — ${hit.title}${hit.summary ? `: ${fill(hit.summary).replace(/\s+/g, ' ')}` : ''}${hit.excerpt ? `\n  ${fill(hit.excerpt)}` : ''}`;
          if (lines.length > 1 && size + 1 + line.length > profile.toolOutputLimit) break;
          lines.push(line);
          size += 1 + line.length;
        }
        const left = hits.length - (lines.length - 1);
        return text(`${lines.join('\n')}${left > 0 ? rest(left) : ''}`);
      }
      if (!named) throw new Error('Give the skill name (or query to search your skills).');
      const skill = ChatSkillStore.outline(named.id);
      if (!skill) throw new Error(`Skill "${named.name}" is gone.`);
      const first = (offset ?? 0) === 0;
      // The table names a section a generation tool already carries as its preset's guide; loading it stays the model's call.
      const table = () => {
        const guides = presetGuidesInTools(context, skill.id);
        if (guides.length === 0) return skill.contents;
        const inGuide = (path: string, guide: string) => guide.endsWith('/') ? skillSectionPathKey(path).startsWith(skillSectionPathKey(guide)) : skillSectionPathKey(path) === skillSectionPathKey(guide);
        return skill.contents.map((entry) => {
          const guide = guides.find((item) => inGuide(entry.path, item.path));
          return guide ? { ...entry, included: `the description of ${guide.tool}` } : entry;
        });
      };

      if (section === undefined) {
        if (first) ChatSkillStore.recordLoad(skill.id, []);
        return text(skillResultText(skill, fill(skillOverviewText(skill.name, skill.instructions, table(), profile.toolOutputLimit)), offset ?? 0, profile.toolOutputLimit));
      }
      const paths = section.split(',').map((path) => path.trim()).filter(Boolean);
      const known = () => skill.contents.map((item) => `"${item.path}"`).join(', ') || '(none: load the skill without section)';
      const group = paths.find((path) => path.endsWith('/'));
      if (group !== undefined) {
        if (paths.length > 1) throw new Error('List one group ("group/") at a time, without other paths.');
        const contents = skillContents(skill.name, table(), Number.MAX_SAFE_INTEGER, group.slice(0, -1));
        if (!contents) throw new Error(`Skill "${skill.name}" has no group "${group}". Its sections: ${known()}.`);
        return text(skillResultText(skill, fill(contents), offset ?? 0, profile.toolOutputLimit, group));
      }
      const chosen = paths.map((path) => {
        const found = skill.contents.find((item) => skillSectionPathKey(item.path) === skillSectionPathKey(path));
        if (!found) throw new Error(`Skill "${skill.name}" has no section "${path}". Its sections: ${known()}.`);
        return found.path;
      });
      const loaded = ChatSkillStore.sectionTexts(skill.id, chosen);
      if (first) ChatSkillStore.recordLoad(skill.id, chosen);
      return text(skillResultText(skill, fill(skillSectionsText(loaded)), offset ?? 0, profile.toolOutputLimit, chosen.join(', ')));
    } catch (error) {
      return errorResult(error);
    }
  });
}
