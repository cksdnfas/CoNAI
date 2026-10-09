import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { PromptPresetModel } from '../../models/PromptPreset'

/** Access the same prompt library as the generation UI, under the existing MCP read/organize scopes. */
export function registerPromptPresetTools(server: McpServer) {
  server.tool('list_prompt_presets', 'List saved prompt presets and their complete text for reuse in any generation prompt.', {}, async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify(PromptPresetModel.findAllWithItems()) }],
  }))
  server.tool('create_prompt_preset', 'Save a named prompt preset in the same library used by the UI. Save positive and negative prompts as separate presets. Existing names are rejected, never overwritten.', {
    name: z.string().trim().min(1),
    description: z.string().optional(),
    parent_id: z.number().int().positive().optional(),
    items: z.array(z.object({ description: z.string().trim().min(1), value: z.string().trim().min(1) })).min(1),
  }, async (input) => {
    try {
      if (PromptPresetModel.findByName(input.name)) throw new Error('Prompt preset with this name already exists')
      if (input.parent_id && !PromptPresetModel.findById(input.parent_id)) throw new Error('Parent prompt preset not found')
      const preset = PromptPresetModel.create(input)
      return { content: [{ type: 'text' as const, text: JSON.stringify(PromptPresetModel.findByIdWithItems(preset.id)) }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Failed to create prompt preset' }] }
    }
  })
}
