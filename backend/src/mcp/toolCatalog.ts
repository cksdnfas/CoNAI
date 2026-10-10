import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { CHAT_PAGE_KIND_TOOLS, CHAT_PAGE_TOOLS, CHAT_ROOM_TOOLS, CHAT_VISION_BUILTIN_TOOLS, isChatGenerationTool, type McpRequestContext } from './context';

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

export type ToolCategoryId = 'images' | 'image_groups' | 'emoticons' | 'generation' | 'workflows' | 'prompts' | 'files' | 'posts' | 'audio' | 'sprite' | 'chat_setup' | 'chat';

export const TOOL_CATEGORIES: Record<ToolCategoryId, string> = {
  images: 'Library images and videos: search, metadata, generation history, downloads, resizing',
  image_groups: 'Image groups: list, create, rename, add/move/remove images, auto-collect',
  emoticons: 'Emoticon groups: list emoticons, view images, set keywords and groups',
  generation: 'Image generation: NovelAI and ComfyUI workflows, servers, routing, generation jobs',
  workflows: 'Graph workflows and workflow definitions: list, inspect, run, export/import, restore',
  prompts: 'Prompts, prompt groups and presets, wildcards and custom dropdown lists, prompt backups',
  files: 'The private file store: list, search, read, write and edit text documents (Markdown, HTML, txt…), make folders, rename, move, delete',
  posts: 'The posts board: categories, search, read, write posts and comments',
  audio: 'Sound-effect (오디오) workspace: projects, effects (groups), folders (그룹 in the UI), candidates, generation orders, edits, export',
  sprite: 'Sprite workspace: video info, sprite sheet extraction, normalizing, animations, frame downloads',
  chat_setup: 'Chat setup (administrators): profiles, display blocks, asset batches, setup proposals',
  chat: 'Chat tools',
};

/** The chat's own tools and what a connected page brings stay in the tool list; everything else may be catalogued. */
export function isDirectChatTool(context: McpRequestContext, toolName: string): boolean {
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
export function createToolCatalog(server: McpServer, registerDirect: (args: unknown[]) => void) {
  const pending: PendingTool[] = [];
  return {
    add(name: string, category: ToolCategoryId, args: unknown[]) {
      const description = (args[1] as { description?: unknown } | undefined)?.description;
      pending.push({ name, category, summary: typeof description === 'string' ? firstSentence(description) : '', args });
    },
    install() {
      if (pending.length < CATALOG_MIN_TOOLS) {
        for (const tool of pending) registerDirect(tool.args);
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
      const close = server.close.bind(server);
      server.close = async () => {
        await close();
        if (connecting) await (await connecting).close().catch(() => undefined);
        await inner.close().catch(() => undefined);
      };

      const categories = [...new Set(pending.map((tool) => tool.category))];
      const contents = categories.map((category) => `- ${category}: ${TOOL_CATEGORIES[category]}\n  ${pending.filter((tool) => tool.category === category).map((tool) => tool.name).join(', ')}`).join('\n');
      registerDirect([CATALOG_OPEN_TOOL, { description: [
        'The CoNAI app tools beyond this list, as a table of contents (category: what it covers, then its tools).',
        'Open a category (or name tools) to read their descriptions and input schemas, then call one with run_tool.',
        'A tool named in your instructions or in earlier replies that is not in your tool list is one of these.',
        'Contents:',
        contents,
      ].join('\n'), inputSchema: z.object({
        category: z.string().optional().describe('A category id from the contents, e.g. "audio"'),
        tools: z.array(z.string()).max(20).optional().describe('Tool names to open instead of (or besides) a category'),
      }) }, async ({ category, tools }: { category?: string; tools?: string[] }) => {
        const wanted = new Set([
          ...(category ? pending.filter((tool) => tool.category === category).map((tool) => tool.name) : []),
          ...(tools ?? []).filter((name) => byName.has(name)),
        ]);
        if (wanted.size === 0) return errorResult(`Nothing to open. Categories: ${categories.join(', ')}.`);
        const { tools: listed } = await (await client()).listTools();
        const opened = listed.filter((tool) => wanted.has(tool.name)).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
        return { content: [{ type: 'text' as const, text: JSON.stringify({ tools: opened, call_with: `${CATALOG_RUN_TOOL} {"tool": "<name>", "arguments": {…}}` }) }] };
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
            const schema = (await connected.listTools()).tools.find((listed) => listed.name === tool)?.inputSchema;
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
