import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isHttpMcpEnabled } from '../mcp';

const mcpHttpRouteSource = readFileSync(resolve(process.cwd(), 'src/mcp/index.ts'), 'utf8');
const generationToolsSource = readFileSync(resolve(process.cwd(), 'src/mcp/tools/generationTools.ts'), 'utf8');
const novelAiToolsSource = readFileSync(resolve(process.cwd(), 'src/mcp/tools/generationNovelAiTools.ts'), 'utf8');
const comfyOutputServiceSource = readFileSync(resolve(process.cwd(), 'src/mcp/tools/mcpComfyOutputService.ts'), 'utf8');
const combinedSource = `${generationToolsSource}\n${novelAiToolsSource}\n${comfyOutputServiceSource}`;

assert.equal(isHttpMcpEnabled({}), false, 'HTTP MCP endpoint should be disabled by default');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'true' }), true, 'HTTP MCP endpoint should support explicit true opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: '1' }), true, 'HTTP MCP endpoint should support numeric opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'yes' }), true, 'HTTP MCP endpoint should support yes opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'false' }), false, 'HTTP MCP endpoint should reject false');
assert.match(mcpHttpRouteSource, /router\.use\('\/mcp'[\s\S]*?isHttpMcpEnabled\(\)/, 'HTTP MCP route should be guarded before method handlers');
assert.match(mcpHttpRouteSource, /CONAI_MCP_HTTP_ENABLED=true/, 'disabled HTTP MCP message should name the explicit opt-in variable');

const registerMatch = /export function registerGenerationTools\(server: McpServer\): void \{([\s\S]*?)\n\}/.exec(generationToolsSource);
assert.ok(registerMatch, 'generation tools should expose a public registration entrypoint');
assert.doesNotMatch(registerMatch[1], /server\.tool\(/, 'public generation tool registration should delegate to focused registration groups');
assert.match(registerMatch[1], /registerWorkflowListTools\(server\)/, 'generation tools should keep workflow listing registration separate');
assert.match(registerMatch[1], /registerComfyGenerationTools\(server\)/, 'generation tools should keep Comfy generation registration separate');
assert.match(registerMatch[1], /registerWorkflowDetailTools\(server\)/, 'generation tools should keep workflow detail registration separate');
assert.match(registerMatch[1], /registerNovelAiGenerationTools\(server\)/, 'generation tools should keep NovelAI registration separate');
assert.match(generationToolsSource, /import \{ registerNovelAiGenerationTools \} from '\.\/generationNovelAiTools'/, 'NovelAI generation registration should live outside the aggregator file');
assert.doesNotMatch(generationToolsSource, /https:\/\/image\.novelai\.net\/ai\/generate-image/, 'aggregator file should not own NovelAI request details');
assert.match(generationToolsSource, /import \{ cleanupMcpComfyTempFile, processMcpComfyOutput \} from '\.\/mcpComfyOutputService'/, 'Comfy output persistence should live outside the tool registration file');
assert.doesNotMatch(generationToolsSource, /APIImageProcessor\.processGeneratedFile/, 'tool registration file should not own Comfy media persistence details');
assert.match(comfyOutputServiceSource, /APIImageProcessor\.processGeneratedFile/, 'Comfy output service should reuse the normal generated-file media pipeline');
assert.match(comfyOutputServiceSource, /BackgroundProcessorService\.processApiGenerationGroupAssignmentForHash/, 'Comfy output service should preserve group assignment post-processing');

for (const registrationGroup of [
  'registerWorkflowListTools',
  'registerComfyGenerationTools',
  'registerWorkflowDetailTools',
]) {
  assert.match(generationToolsSource, new RegExp(`function ${registrationGroup}\\(server: McpServer\\): void \\{`), `${registrationGroup} should remain a focused helper`);
}
assert.match(novelAiToolsSource, /export function registerNovelAiGenerationTools\(server: McpServer\): void \{/, 'NovelAI generation should have its own exported registration helper');

for (const toolName of [
  'list_workflows',
  'list_comfyui_servers',
  'generate_comfyui',
  'generate_comfyui_all_servers',
  'get_workflow_details',
  'generate_nai',
]) {
  assert.match(combinedSource, new RegExp(`server\\.tool\\(\\s*'${toolName}'`), `${toolName} MCP tool should remain registered`);
}

console.log('✅ MCP generation tool contracts verified');
