import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { PromptPresetModel } from '../../models/PromptPreset'
import { textResult } from '../toolResults'

/** Access the same prompt library as the generation UI, under the existing MCP read/organize scopes. */
export function registerPromptPresetTools(server: McpServer) {
  server.registerTool('list_prompt_presets', { description: 'List saved prompt presets and their complete text for reuse in any generation prompt.', inputSchema: z.object({}) }, async () => textResult(PromptPresetModel.findAllWithItems()))
  server.registerTool('create_prompt_preset', { description: 'Save a prompt preset; returns the saved preset and items. Save positive and negative prompts separately. On name conflict, choose another name; existing presets are never overwritten.', inputSchema: z.object({
    name: z.string().trim().min(1).describe('Unused preset name'),
    description: z.string().optional(),
    parent_id: z.number().int().positive().optional(),
    items: z.array(z.object({ description: z.string().trim().min(1), value: z.string().trim().min(1) })).min(1),
  }) }, async (input) => {
    try {
      if (PromptPresetModel.findByName(input.name)) throw new Error('Prompt preset with this name already exists')
      if (input.parent_id && !PromptPresetModel.findById(input.parent_id)) throw new Error('Parent prompt preset not found')
      const preset = PromptPresetModel.create(input)
      return textResult(PromptPresetModel.findByIdWithItems(preset.id))
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Failed to create prompt preset' }] }
    }
  })
}
