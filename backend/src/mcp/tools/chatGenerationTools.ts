import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ChatGenerationPresetStore, type ChatGenerationPreset } from '../../services/codex-chat/chatGenerationPresets';
import { presetInputShape } from '../../services/codex-chat/chatGenerationInputs';
import { presetGuideText } from '../../services/codex-chat/chatGenerationPrompting';
import { ChatDeferredGenerationStore } from '../../services/codex-chat/chatDeferredGenerations';
import { requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry';
import { chatGenerationToolName, type McpRequestContext } from '../context';
import { enqueueMcpGenerationJob } from './generationJobTools';
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles';
import { skillGuide } from '../../services/codex-chat/chatSkills';
import { isContextToolAllowed, requireMcpToolAccess } from '../toolAccess';
import { requireRequesterPermission } from '../../middleware/featureAccess';
import { errorResult, textResult } from '../toolResults';

import { buildChatGenerationPresetJob, CHAT_NAI_PAYLOAD_MAX_BYTES, joinPrompt } from '../../services/codex-chat/chatGenerationPayload';
export { buildChatGenerationPresetJob, CHAT_NAI_REFERENCE_MAX_BYTES, CHAT_NAI_PAYLOAD_MAX_BYTES } from '../../services/codex-chat/chatGenerationPayload';

/**
 * An inline preset's flag for pictures of the speaking character: the server puts the profile's appearance tags before
 * the scene, so the tags never sit in the model's context. Offered only to a speaker that has appearance tags.
 */
const SELF_FIELD = 'include_self';
const SELF_DESCRIPTION = 'Whether the speaking character appears. If true, saved appearance is added: write only pose, expression, action, changed clothing and setting, not usual looks.';

/** The speaker's appearance goes to the characters entries marked self, else (include_self) before the scene field. */
function withSpeakerAppearance(context: McpRequestContext, args: Record<string, unknown>, selfField: string | null) {
  const characters = Array.isArray(args.characters) ? args.characters as Array<Record<string, unknown>> : [];
  if (characters.some((entry) => entry.self === true)) {
    const appearance = speakerAppearance(context);
    return { ...args, characters: characters.map(({ self, ...entry }) => (self === true ? { ...entry, prompt: joinPrompt([appearance, String(entry.prompt ?? '')]) } : entry)) };
  }
  return selfField && args[SELF_FIELD] === true ? { ...args, [selfField]: joinPrompt([speakerAppearance(context), String(args[selfField] ?? '')]) } : args;
}

function speakerAppearance(context: McpRequestContext) {
  return context.chatContext ? ChatProfileStore.find(context.chatContext.profileId)?.appearance.trim() ?? '' : '';
}

function describe(preset: ChatGenerationPreset, body: string) {
  return [
    `Generate an image with the preset "${preset.name}"${preset.instruction ? `: ${preset.instruction}` : ''}.`,
    body,
    'Returns a queued job; fixed preset settings apply. The app attaches the finished image: continue your reply, do not wait or poll.',
  ].join(' ');
}

/** The preset's writing guide for the model filling the tool; it reaches a running Codex session with the preset signature. */
function withGuide(description: string, preset: ChatGenerationPreset) {
  const guide = presetGuideText(preset);
  return guide ? `${description}\n\nPrompt guide for this preset. Follow it when you fill the fields; where it differs from a field description or the general generation rules, the guide wins:\n${guide}` : description;
}

/**
 * The sections of skill `skillId` (a section path, or `group/`) that a generation tool of this chat already carries in
 * its description as the preset's prompt guide (withGuide). use_skill names that tool beside them in a table of
 * contents, so the model can tell the text is there instead of loading it a second time.
 */
export function presetGuidesInTools(context: McpRequestContext, skillId: number): Array<{ path: string; tool: string }> {
  return ChatGenerationPresetStore.resolve(context.generationPresetIds ?? []).flatMap((preset, index) => {
    const link = preset.prompting.guideSkill;
    const tool = chatGenerationToolName(index);
    if (!link || link.skillId !== skillId || preset.prompting.timing === 'after' || !isContextToolAllowed(context, tool) || presetInputShape(preset).problem || skillGuide(skillId, link.path).text === null) return [];
    return [{ path: link.path, tool }];
  });
}

function usesReference(preset: ChatGenerationPreset) {
  return preset.kind === 'nai' ? preset.nai?.characterReference !== 'none' : Boolean(preset.comfyui?.referenceField);
}

function generationProfile(context: McpRequestContext, toolName: string, args: Record<string, unknown>, reference: boolean) {
  requireMcpToolAccess(context, toolName, args);
  if (!reference) return null;
  requireRequesterPermission(context.requester, 'images.view');
  return context.chatContext ? ChatProfileStore.find(context.chatContext.profileId, context.chatContext.threadId) : null;
}

/** `inline`: the chat model fills the preset's fields now, and the job is queued at once. */
function registerInlinePreset(server: McpServer, context: McpRequestContext, preset: ChatGenerationPreset, toolName: string, hasAppearance: boolean) {
  const { shape, fill, workflowName, problem, sceneField } = presetInputShape(preset, { self: hasAppearance });
  if (problem) {
    // Registered anyway so the model learns why instead of finding no generation tool at all.
    server.registerTool(toolName, { description: describe(preset, `Currently unavailable: ${problem}`), inputSchema: z.object({}) }, async () => errorResult(problem));
    return;
  }
  const reference = usesReference(preset);
  const selfField = hasAppearance && sceneField && !(SELF_FIELD in shape) ? sceneField : null;
  const body = `${workflowName ? `${fill} Workflow "${workflowName}".` : fill}${selfField ? ` Also set ${SELF_FIELD}.` : ''}`;
  server.registerTool(
    toolName,
    { description: withGuide(describe(preset, body), preset), inputSchema: z.object(selfField ? { ...shape, [SELF_FIELD]: z.boolean().describe(SELF_DESCRIPTION) } : shape) },
    async (args: Record<string, unknown>) => {
      try {
        const profile = generationProfile(context, toolName, args, reference);
        return textResult(await enqueueMcpGenerationJob(context, await buildChatGenerationPresetJob(preset, withSpeakerAppearance(context, args, selfField), profile), toolName, preset.kind === 'nai' && reference ? { maxPayloadBytes: CHAT_NAI_PAYLOAD_MAX_BYTES } : {}));
      } catch (error) {
        return errorResult(`Generation job error: ${(error as Error).message}`);
      }
    },
  );
}

/** `after`: the chat model only asks for a picture; its prompt is written from the finished reply (chatGenerationPrompting). */
function registerAfterPreset(server: McpServer, context: McpRequestContext, preset: ChatGenerationPreset, toolName: string) {
  const { problem } = presetInputShape(preset);
  if (problem) {
    server.registerTool(toolName, { description: describe(preset, `Currently unavailable: ${problem}`), inputSchema: z.object({}) }, async () => errorResult(problem));
    return;
  }
  server.registerTool(
    toolName,
    { description: `Request a picture with preset "${preset.name}"${preset.instruction ? `: ${preset.instruction}` : ''}; returns requested status. Generated from your finished reply and attached automatically. Once per moment; continue writing without waiting or polling. Never describe the picture or claim it is finished.`, inputSchema: z.object({ focus: z.string().max(500).optional().describe('Which moment of your reply to show, if not obvious.') }) },
    async (args: Record<string, unknown>) => {
      try {
        requireMcpToolAccess(context, toolName, args);
        requireActiveChatReply(context.chatContext);
        ChatDeferredGenerationStore.add(context, preset.id, toolName, typeof args.focus === 'string' ? args.focus.trim() : '');
        return textResult({ status: 'requested', note: 'The picture will be made from your finished reply. Continue the reply.' });
      } catch (error) {
        return errorResult(`Generation request error: ${(error as Error).message}`);
      }
    },
  );
}

/** One `generate_image` tool per generation preset the chat profile links; nothing without presets. */
export function registerChatGenerationTools(server: McpServer, context: McpRequestContext): void {
  const ids = context.generationPresetIds ?? [];
  if (ids.length === 0) return;
  const presets = ChatGenerationPresetStore.resolve(ids);
  const hasAppearance = presets.some((preset) => preset.prompting.timing !== 'after') && Boolean(speakerAppearance(context));
  presets.forEach((preset, index) => {
    const toolName = chatGenerationToolName(index);
    if (preset.prompting.timing === 'after') registerAfterPreset(server, context, preset, toolName);
    else registerInlinePreset(server, context, preset, toolName, hasAppearance);
  });
}
