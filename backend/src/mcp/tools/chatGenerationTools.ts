import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

import { buildChatGenerationPresetJob, CHAT_NAI_PAYLOAD_MAX_BYTES } from '../../services/codex-chat/chatGenerationPayload';
export { buildChatGenerationPresetJob, CHAT_NAI_REFERENCE_MAX_BYTES, CHAT_NAI_PAYLOAD_MAX_BYTES } from '../../services/codex-chat/chatGenerationPayload';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
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
  return guide ? `${description}\n\nPrompt guide (follow it when you fill the fields):\n${guide}` : description;
}

function usesReference(preset: ChatGenerationPreset) {
  return preset.kind === 'nai' ? preset.nai?.characterReference !== 'none' : Boolean(preset.comfyui?.referenceField);
}

function generationProfile(context: McpRequestContext, toolName: string, args: Record<string, unknown>, reference: boolean) {
  requireMcpToolAccess(context, toolName, args);
  if (!reference) return null;
  requireRequesterPermission(context.requester, 'images.view');
  return context.chatContext ? ChatProfileStore.find(context.chatContext.profileId) : null;
}

/** `inline`: the chat model fills the preset's fields now, and the job is queued at once. */
function registerInlinePreset(server: McpServer, context: McpRequestContext, preset: ChatGenerationPreset, toolName: string) {
  const { shape, fill, workflowName, problem } = presetInputShape(preset);
  if (problem) {
    // Registered anyway so the model learns why instead of finding no generation tool at all.
    server.tool(toolName, describe(preset, `Currently unavailable: ${problem}`), {}, async () => errorResult(problem));
    return;
  }
  const reference = usesReference(preset);
  server.tool(
    toolName,
    withGuide(describe(preset, workflowName ? `${fill} Workflow "${workflowName}".` : fill), preset),
    shape,
    async (args: Record<string, unknown>) => {
      try {
        const profile = generationProfile(context, toolName, args, reference);
        return textResult(await enqueueMcpGenerationJob(context, await buildChatGenerationPresetJob(preset, args, profile), toolName, preset.kind === 'nai' && reference ? { maxPayloadBytes: CHAT_NAI_PAYLOAD_MAX_BYTES } : {}));
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
    server.tool(toolName, describe(preset, `Currently unavailable: ${problem}`), {}, async () => errorResult(problem));
    return;
  }
  server.tool(
    toolName,
    `Ask for a picture of this reply with the preset "${preset.name}"${preset.instruction ? `: ${preset.instruction}` : ''}. The picture's prompt is written from your finished reply after you end it, and the app attaches the image to the reply by itself. Call it at most once per moment, then just continue writing; never describe the picture or say it is finished.`,
    { focus: z.string().max(500).optional().describe('Optional: which moment of your reply to show, in a few words, when it is not the obvious one.') },
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
  ChatGenerationPresetStore.resolve(ids).forEach((preset, index) => {
    const toolName = chatGenerationToolName(index);
    if (preset.prompting.timing === 'after') registerAfterPreset(server, context, preset, toolName);
    else registerInlinePreset(server, context, preset, toolName);
  });
}
