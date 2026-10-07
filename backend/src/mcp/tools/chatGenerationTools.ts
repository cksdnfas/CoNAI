import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MarkedField } from '../../types/workflow';
import { ChatGenerationPresetStore, resolvePresetWorkflow, type ChatGenerationPreset } from '../../services/codex-chat/chatGenerationPresets';
import { chatGenerationToolName, type McpRequestContext } from '../context';
import { enqueueMcpGenerationJob } from './generationJobTools';
import { parseMcpMarkedFields } from './mcpComfyWorkflowService';

const SCENE_DESCRIPTION = 'What this moment shows, as comma-separated Danbooru-style tags: subject count, pose, action, expression, clothing, setting, lighting, camera angle. Do not add quality, artist or style tags and no negative tags; the preset already holds them.';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
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

function joinPrompt(parts: string[]) {
  return parts.map((part) => part.trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');
}

function registerNaiPreset(server: McpServer, context: McpRequestContext, preset: ChatGenerationPreset, toolName: string) {
  const config = preset.nai;
  if (!config) return;
  const labels = config.sizes.map((size) => size.label);
  const shape: Record<string, z.ZodTypeAny> = { prompt: z.string().min(1).max(4000).describe(SCENE_DESCRIPTION) };
  if (labels.length > 1) {
    shape.size = z.enum(labels as [string, ...string[]]).optional().describe(`Picture size: ${config.sizes.map((size) => `${size.label} (${size.width}×${size.height})`).join(', ')}. Default ${labels[0]}.`);
  }
  server.tool(
    toolName,
    describe(preset, labels.length > 1 ? 'Fill prompt and, when the composition calls for it, size.' : 'Fill only prompt.'),
    shape,
    async (args: Record<string, unknown>) => {
      try {
        const scene = String(args.prompt ?? '');
        const size = config.sizes.find((entry) => entry.label === args.size) ?? config.sizes[0];
        const payload: Record<string, unknown> = {
          prompt: joinPrompt([config.promptPrefix, scene, config.promptSuffix]),
          negative_prompt: config.negativePrompt || undefined,
          model: config.model,
          action: 'generate',
          sampler: config.sampler,
          noise_schedule: config.noiseSchedule,
          width: size.width,
          height: size.height,
          steps: config.steps,
          scale: config.scale,
          n_samples: 1,
          use_coords: config.useCoords,
          characters: config.characters.length > 0 ? config.characters : undefined,
          vibes: config.vibes.length > 0 ? config.vibes : undefined,
          character_refs: config.characterRefs.length > 0 ? config.characterRefs : undefined,
          variety_plus: config.varietyPlus,
          transparent_background: config.transparentBackground,
        };
        return textResult(await enqueueMcpGenerationJob(context, { service_type: 'novelai', request_payload: payload, request_summary: `채팅 프리셋 · ${preset.name}` }, toolName));
      } catch (error) {
        return errorResult(`Generation job error: ${(error as Error).message}`);
      }
    },
  );
}

function fieldSchema(field: MarkedField, required: boolean): z.ZodTypeAny {
  const label = field.description ? `${field.label}: ${field.description}` : field.label;
  let schema: z.ZodTypeAny;
  if (field.type === 'number') {
    let numeric = z.number();
    if (typeof field.min === 'number') numeric = numeric.min(field.min);
    if (typeof field.max === 'number') numeric = numeric.max(field.max);
    schema = numeric;
  } else if (field.type === 'select' && field.options && field.options.length > 0) {
    schema = z.enum(field.options as [string, ...string[]]);
  } else if (field.type === 'image') {
    schema = z.string().describe('A data URL of the image.');
  } else if (field.type === 'node') {
    schema = z.record(z.string(), z.unknown());
  } else {
    schema = z.string().max(8000);
  }
  schema = schema.describe(label);
  return required ? schema : schema.optional();
}

function registerComfyPreset(server: McpServer, context: McpRequestContext, preset: ChatGenerationPreset, toolName: string) {
  const config = preset.comfyui;
  if (!config) return;
  const { workflow, problem } = resolvePresetWorkflow(config);
  if (!workflow) {
    // Registered anyway so the model learns why instead of finding no generation tool at all.
    server.tool(toolName, describe(preset, `Currently unavailable: ${problem}`), {}, async () => errorResult(problem ?? 'Workflow unavailable'));
    return;
  }
  const markedFields = parseMcpMarkedFields(workflow);
  const exposed = markedFields.filter((field) => config.exposedFieldIds.includes(field.id));
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of exposed) {
    const covered = config.fixedInputs[field.id] !== undefined || field.default_value !== undefined;
    shape[field.id] = fieldSchema(field, field.required === true && !covered);
  }
  const fieldList = exposed.length > 0 ? `Fill ${exposed.map((field) => `${field.id} (${field.label})`).join(', ')}.` : 'It takes no input.';
  server.tool(
    toolName,
    describe(preset, `${fieldList} Workflow "${workflow.name}".`),
    shape,
    async (args: Record<string, unknown>) => {
      try {
        const supplied: Record<string, unknown> = {};
        for (const field of exposed) {
          if (args[field.id] !== undefined) supplied[field.id] = args[field.id];
        }
        return textResult(await enqueueMcpGenerationJob(context, {
          service_type: 'comfyui',
          workflow_id: config.workflowId,
          server_id: config.serverId ?? undefined,
          server_tag: config.serverTag ?? undefined,
          inputs: { ...config.fixedInputs, ...supplied },
          request_summary: `채팅 프리셋 · ${preset.name}`,
        }, toolName));
      } catch (error) {
        return errorResult(`Generation job error: ${(error as Error).message}`);
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
    if (preset.kind === 'nai') registerNaiPreset(server, context, preset, toolName);
    else registerComfyPreset(server, context, preset, toolName);
  });
}
