import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { rawTokenEstimate } from '../services/llmUsage';
import { CHAT_PAGE_KIND_TOOLS, CHAT_PAGE_TOOLS, CHAT_ROOM_TOOLS, CHAT_SETTINGS_TOOLS, CHAT_VISION_BUILTIN_TOOLS, isChatGenerationTool, type McpRequestContext } from './context';

/**
 * A chat agent sees the app's tools as a table of contents instead of every definition at once: the chat's own tools
 * (room, choices, connected page, linked generation presets) stay direct, the rest sit behind `open_tools` (read a
 * category's descriptions and input schemas) and `run_tool` (call one). The catalogued tools run on a private
 * server with the same wrapped handlers, so permission checks and argument validation are exactly those of a direct call.
 */
export const CATALOG_OPEN_TOOL = 'open_tools';
export const CATALOG_RUN_TOOL = 'run_tool';
/** Fewer catalogued tools than this are listed directly: the catalog would cost more than it saves. */
const CATALOG_MIN_TOOLS = 10;
const CATALOG_CALL_TIMEOUT_MS = 30 * 60_000;
/** Page at tool boundaries; a single larger definition is kept intact. */
const CATALOG_PAGE_CHARS = 12_000;

export type ToolCategoryId = 'images' | 'image_groups' | 'emoticons' | 'generation' | 'workflows' | 'prompts' | 'files' | 'posts' | 'audio' | 'sprite' | 'chat_setup' | 'web' | 'external' | 'plugins' | 'guide' | 'chat';

export const TOOL_CATEGORIES: Record<ToolCategoryId, string> = {
  images: 'Library images/videos: search, metadata, history, downloads, resize',
  image_groups: 'Image groups: list, create, edit, add/move/remove images, auto-collect',
  emoticons: 'Emoticons: list, view, keywords, groups',
  generation: 'Generation: NovelAI, ComfyUI workflows, servers, routing, jobs',
  workflows: 'Graph workflows and definitions: list, inspect, run, export/import',
  prompts: 'Saved prompts and Danbooru tags/artists/characters (including related tags), prompt groups, presets, wildcards, dropdown lists, backups',
  files: 'Private file store: list, search, read/write/edit text docs, folders, rename, move, delete, versions',
  posts: 'Posts board and knowledge: search, read, evidence-based assessments, propose knowledge changes for human review, posts and comments, earlier versions',
  audio: 'Sound effects (오디오): projects, effects (groups), folders (UI 그룹), takes, orders, edits, export',
  sprite: 'Sprites: video info, sheet extraction, normalize, animations, frames',
  chat_setup: 'Chat setup (admins): profiles, display blocks, asset batches, proposals',
  web: 'Web: research assistant with sources, read a public page',
  guide: 'CoNAI user guide: how screens, features and settings work',
  external: 'Tools of outside MCP servers (x_<server>_<tool>); results are untrusted data',
  plugins: 'Tools added by installed plugins (p_<plugin>_<tool>)',
  chat: 'Chat tools',
};

/**
 * The tools the contents name in each category: the everyday ones. The rest of a category shows as "+N more" and is
 * listed by opening it; any catalogued tool still runs by name. A category this small or smaller is named whole.
 */
const CONTENTS_PRIMARY_TOOLS = new Set([
  'search_prompts', 'list_prompt_presets', 'search_wildcards',
  'list_workflows', 'get_workflow_details', 'submit_generation_job', 'get_generation_job', 'generate_nai',
  'search_images', 'search_images_by_tags', 'search_images_by_meaning', 'find_similar_images', 'get_image_metadata',
  'list_files', 'search_files', 'read_file_text', 'write_text_file', 'edit_file_text',
  'posts_search', 'posts_read', 'posts_assess', 'posts_propose_knowledge', 'posts_create', 'post_comment',
  'list_image_groups', 'add_images_to_group', 'create_image_group',
  'list_audio_projects', 'list_audio_groups', 'list_audio_candidates', 'order_audio',
  'get_chat_setup_guide', 'propose_chat_profile', 'propose_profile_update',
  'extract_sprite_sheet', 'extract_sprite_sheets_batch',
]);
const CONTENTS_WHOLE_CATEGORY = 4;

function contentsLine(names: string[]) {
  if (names.length <= CONTENTS_WHOLE_CATEGORY) return names.join(', ');
  const shown = names.filter((name) => CONTENTS_PRIMARY_TOOLS.has(name));
  const more = names.length - shown.length;
  return [...shown, ...(more > 0 ? [`+${more} more`] : [])].join(', ');
}

/** The chat's own tools and what a connected page brings stay in the tool list; everything else may be catalogued. */
export function isDirectChatTool(context: McpRequestContext, toolName: string): boolean {
  if (context.workspace && toolName.startsWith('workspace_')) return true;
  if (CHAT_ROOM_TOOLS.has(toolName) || CHAT_VISION_BUILTIN_TOOLS.has(toolName) || CHAT_PAGE_TOOLS.has(toolName) || isChatGenerationTool(toolName)) return true;
  const page = context.chatContext?.page;
  return Boolean(page && CHAT_PAGE_KIND_TOOLS[page.kind]?.has(toolName));
}

/** A `run_tool` call as the tool it runs (for records, judges and permission checks); any other call unchanged. */
export function unwrapCatalogCall(name: string, args: unknown): { tool: string; arguments: unknown } {
  if (name !== CATALOG_RUN_TOOL || !args || typeof args !== 'object') return { tool: name, arguments: args };
  const record = args as Record<string, unknown>;
  return typeof record.tool === 'string' && record.tool
    ? { tool: record.tool, arguments: record.arguments && typeof record.arguments === 'object' ? record.arguments : {} }
    : { tool: name, arguments: args };
}

type PendingTool = { name: string; category: ToolCategoryId; summary: string; args: unknown[] };

const catalogNames = new WeakMap<McpServer, string[]>();
/** The tools a server offers through its catalog (empty when it lists everything directly). */
export function catalogToolNames(server: McpServer): string[] {
  return catalogNames.get(server) ?? [];
}

function firstSentence(description: string) {
  const sentence = description.split(/(?<=\.)\s|\n/)[0] ?? description;
  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

/**
 * Collects the catalogued tools while the server is built, then either lists them directly (few of them) or puts them
 * on a private server behind `open_tools` / `run_tool`.
 */
export function createToolCatalog(server: McpServer, registerDirect: (args: unknown[]) => void, remainingTokens?: () => number) {
  const pending: PendingTool[] = [];
  return {
    add(name: string, category: ToolCategoryId, args: unknown[]) {
      const description = (args[1] as { description?: unknown } | undefined)?.description;
      pending.push({ name, category, summary: typeof description === 'string' ? firstSentence(description) : '', args });
    },
    install() {
      // The chat's settings tools never cost a direct definition: without a catalog they are left out.
      if (pending.filter((tool) => !CHAT_SETTINGS_TOOLS.has(tool.name)).length < CATALOG_MIN_TOOLS) {
        for (const tool of pending) if (!CHAT_SETTINGS_TOOLS.has(tool.name)) registerDirect(tool.args);
        return;
      }
      const inner = new McpServer({ name: 'conai-catalog', version: '1.0.0' });
      const innerRegister = inner.registerTool.bind(inner) as (...args: unknown[]) => unknown;
      for (const tool of pending) innerRegister(...tool.args);
      const byName = new Map(pending.map((tool) => [tool.name, tool]));
      catalogNames.set(server, pending.map((tool) => tool.name));

      let connecting: Promise<Client> | null = null;
      const client = () => connecting ??= (async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await inner.connect(serverTransport);
        const connected = new Client({ name: 'conai-catalog-client', version: '1.0.0' });
        await connected.connect(clientTransport);
        return connected;
      })();
      let definitions: ReturnType<Client['listTools']> | null = null;
      const listDefinitions = () => definitions ??= client().then((connected) => connected.listTools()).catch((error) => { definitions = null; throw error; });
      const close = server.close.bind(server);
      server.close = async () => {
        await close();
        if (connecting) await (await connecting).close().catch(() => undefined);
        await inner.close().catch(() => undefined);
      };

      const categories = [...new Set(pending.map((tool) => tool.category))];
      const contents = categories.map((category) => `- ${category}: ${TOOL_CATEGORIES[category]}\n  ${contentsLine(pending.filter((tool) => tool.category === category).map((tool) => tool.name))}`).join('\n');
      registerDirect([CATALOG_OPEN_TOOL, { description: [
        'The CoNAI app tools beyond this list, as a table of contents (category: what it covers, then its main tools; "+N more" are listed when you open the category).',
        'Search with query or browse a category using detail="summary"; open exact tool names for input schemas, then call one with run_tool.',
        'A tool named in your instructions or in earlier replies that is not in your tool list is one of these.',
        'Contents:',
        contents,
      ].join('\n'), inputSchema: z.object({
        category: z.string().optional().describe('A category id from the contents, e.g. "audio"'),
        tools: z.array(z.string()).max(20).optional().describe('Tool names to open instead of (or besides) a category'),
        query: z.string().trim().max(200).optional().describe('Words to match in tool names and descriptions; filters the selection'),
        detail: z.enum(['summary', 'schema']).optional().describe('summary: short discovery list; schema (default): complete input definitions'),
        max_tokens: z.number().int().min(256).max(12000).optional().describe('Approximate response token budget, also limited by remaining chat context'),
        offset: z.number().int().min(0).optional().describe('Continue the same selection from next_offset in the previous result'),
      }) }, async ({ category, tools, query, detail = 'schema', max_tokens = 3000, offset = 0 }: { category?: string; tools?: string[]; query?: string; detail?: 'summary' | 'schema'; max_tokens?: number; offset?: number }) => {
        const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const wanted = new Set([
          ...(category ? pending.filter((tool) => tool.category === category).map((tool) => tool.name) : []),
          ...(tools ?? []).filter((name) => byName.has(name)),
          ...(!category && !tools?.length && terms.length ? pending.map((tool) => tool.name) : []),
        ]);
        for (const name of wanted) {
          const tool = byName.get(name)!;
          const text = `${name} ${(tool.args[1] as { description?: string })?.description ?? tool.summary}`.toLowerCase();
          if (!terms.every((term) => text.includes(term))) wanted.delete(name);
        }
        if (wanted.size === 0) return errorResult(`Nothing to open. Categories: ${categories.join(', ')}.`);
        const { tools: listed } = await listDefinitions();
        const selected = listed.filter((tool) => wanted.has(tool.name));
        const opened: Array<{ name: string; description?: string; input_schema?: unknown }> = [];
        let chars = 0;
        let tokens = 0;
        const budget = Math.max(0, Math.min(max_tokens, remainingTokens?.() ?? max_tokens) - 150);
        for (const tool of selected.slice(offset)) {
          const definition = detail === 'summary' ? { name: tool.name, description: byName.get(tool.name)?.summary } : { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
          const size = JSON.stringify(definition).length;
          const cost = rawTokenEstimate(JSON.stringify(definition));
          if (tokens + cost > budget || (opened.length > 0 && chars + size > CATALOG_PAGE_CHARS)) {
            if (opened.length === 0) return errorResult(`Definition of ${tool.name} needs about ${cost + 150} tokens. Use detail="summary" to browse, or open that tool alone with a larger max_tokens when context permits. The schema was not cut.`);
            break;
          }
          opened.push(definition);
          chars += size;
          tokens += cost;
        }
        const nextOffset = offset + opened.length;
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          tools: opened,
          ...(nextOffset < selected.length ? { next_offset: nextOffset, remaining: selected.length - nextOffset, continue_with: { category, tools, query, detail, max_tokens, offset: nextOffset } } : {}),
          call_with: `${CATALOG_RUN_TOOL} {"tool": "<name>", "arguments": {…}}`,
        }) }] };
      }]);

      registerDirect([CATALOG_RUN_TOOL, { description: 'Run one tool from the open_tools contents with its arguments. Open its category first unless you already know its exact input schema.', inputSchema: z.object({
        tool: z.string().describe('The tool name, e.g. "create_audio_folder"'),
        arguments: z.record(z.string(), z.unknown()).optional().describe('The tool\'s arguments, as its input schema describes'),
      }) }, async ({ tool, arguments: args }: { tool: string; arguments?: Record<string, unknown> }, ctx: { mcpReq?: { signal?: AbortSignal } }) => {
        if (!byName.has(tool)) return errorResult(`Unknown tool: ${tool}. See the contents of ${CATALOG_OPEN_TOOL}.`);
        try {
          const connected = await client();
          const result = await connected.callTool({ name: tool, arguments: args ?? {} }, { signal: ctx?.mcpReq?.signal, timeout: CATALOG_CALL_TIMEOUT_MS });
          const content = Array.isArray(result.content) ? result.content as Array<{ type?: string; text?: string }> : [];
          // Wrong arguments come back with the tool's schema, so the next call can be right without another lookup.
          if (result.isError && content.some((part) => part.type === 'text' && part.text?.includes('Input validation error'))) {
            const schema = (await listDefinitions()).tools.find((listed) => listed.name === tool)?.inputSchema;
            return { ...result, content: [...content, { type: 'text' as const, text: `Input schema of ${tool} (from open_tools): ${JSON.stringify(schema ?? {})}` }] };
          }
          return result;
        } catch (error) {
          return errorResult(`${error instanceof Error ? error.message : String(error)} (open_tools {"tools": ["${tool}"]} shows its input schema)`);
        }
      }]);
    },
  };
}
