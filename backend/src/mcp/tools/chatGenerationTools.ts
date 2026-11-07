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
import { requireMcpToolAccess } from '../toolAccess';
import { requireRequesterPermission } from '../../middleware/featureAccess';
import { errorResult, textResult } from '../toolResults';

import { buildChatGenerationPresetJob, CHAT_NAI_PAYLOAD_MAX_BYTES, joinPrompt } from '../../services/codex-chat/chatGenerationPayload';
export { buildChatGenerationPresetJob, CHAT_NAI_REFERENCE_MAX_BYTES, CHAT_NAI_PAYLOAD_MAX_BYTES } from '../../services/codex-chat/chatGenerationPayload';

/**
 * An inline preset's flag for pictures of the speaking character: the server puts the profile's appearance tags before
 * the scene, so the tags never sit in the model's context. Offered only to a speaker that has appearance tags.
 */
const SELF_FIELD = 'include_self';
const SELF_DESCRIPTION = 'true when you, the speaking character, are in the picture: the server adds your saved appearance tags, so write only this moment (pose, expression, action, changed clothing, setting), not your usual looks. false when you are not in it.';

function speakerAppearance(context: McpRequestContext) {
  return context.chatContext ? ChatProfileStore.find(context.chatContext.profileId)?.appearance.trim() ?? '' : '';
}

function describe(preset: ChatGenerationPreset, body: string) {
  return [
    `Generate an image with the preset "${preset.name}"${preset.instruction ? `: ${preset.instruction}` : ''}.`,
    body,
    'The server adds the preset\'s fixed settings and the app attaches the finished image to your reply by itself: do not wait for or poll the job, just continue your reply.',
  ].join(' ');
}

/** The preset's writing guide for the model filling the tool; it reaches a running Codex session with the preset signature. */
function withGuide(description: string, preset: ChatGenerationPreset) {
  const guide = presetGuideText(preset);
  return guide ? `${description}\n\nPrompt guide for this preset. Follow it when you fill the fields; where it differs from a field description or the general generation rules, the guide wins:\n${guide}` : description;
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
  const { shape, fill, workflowName, problem, sceneField } = presetInputShape(preset);
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
        const input = selfField && args[SELF_FIELD] === true ? { ...args, [selfField]: joinPrompt([speakerAppearance(context), String(args[selfField] ?? '')]) } : args;
        return textResult(await enqueueMcpGenerationJob(context, await buildChatGenerationPresetJob(preset, input, profile), toolName, preset.kind === 'nai' && reference ? { maxPayloadBytes: CHAT_NAI_PAYLOAD_MAX_BYTES } : {}));
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
    { description: `Ask for a picture of this reply with the preset "${preset.name}"${preset.instruction ? `: ${preset.instruction}` : ''}. The picture's prompt is written from your finished reply after you end it, and the app attaches the image to the reply by itself. Call it at most once per moment, then just continue writing; never describe the picture or say it is finished.`, inputSchema: z.object({ focus: z.string().max(500).optional().describe('Optional: which moment of your reply to show, in a few words, when it is not the obvious one.') }) },
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
