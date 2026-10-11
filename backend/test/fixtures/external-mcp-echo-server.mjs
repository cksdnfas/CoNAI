// A tiny MCP server over stdio for the external MCP tests: echo, a tool with a `path` argument, and an image.
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

const server = new McpServer({ name: 'echo', version: '1.0.0' })
server.registerTool('say', { description: 'Echo the text back.', inputSchema: z.object({ text: z.string() }) },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text} (${process.env.ECHO_TOKEN ?? 'no token'})` }] }))
server.registerTool('Read-File', { description: 'Pretend to read a file.', inputSchema: z.object({ path: z.string() }) },
  async ({ path }) => ({ content: [{ type: 'text', text: `read ${path}` }] }))
server.registerTool('pixel', { description: 'One pixel.', inputSchema: z.object({}) },
  async () => ({ content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }, { type: 'resource_link', uri: 'https://example.com/a', name: 'a' }] }))
await server.connect(new StdioServerTransport())
