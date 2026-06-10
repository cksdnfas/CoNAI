import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isHttpMcpEnabled } from '../mcp';

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const backendRoot = path.join(projectRoot, 'backend');
const mcpRouteSource = fs.readFileSync(path.join(backendRoot, 'src', 'mcp', 'index.ts'), 'utf8');
const mcpGuideSource = fs.readFileSync(path.join(projectRoot, 'docs', 'GUIDE', 'MCP_GUIDE.md'), 'utf8');
const operationsContractSource = fs.readFileSync(
  path.join(projectRoot, 'docs', 'systems', 'agent-mcp-opt-in-operation-contracts.md'),
  'utf8',
);
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const backendPackageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));

assert.equal(isHttpMcpEnabled({}), false, 'HTTP MCP must be disabled by default');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'true' }), true, 'HTTP MCP must support explicit true opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: '1' }), true, 'HTTP MCP must support numeric opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'yes' }), true, 'HTTP MCP must support yes opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'on' }), true, 'HTTP MCP must support on opt-in');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'false' }), false, 'HTTP MCP must reject false');
assert.equal(isHttpMcpEnabled({ CONAI_MCP_HTTP_ENABLED: 'disabled' }), false, 'HTTP MCP must reject non-opt-in values');

assert.match(
  mcpRouteSource,
  /router\.use\('\/mcp'[\s\S]*?isHttpMcpEnabled\(\)/,
  'HTTP MCP route should be guarded before method handlers',
);
assert.match(mcpRouteSource, /res\.status\(404\)/, 'disabled HTTP MCP should not advertise an active endpoint');
assert.match(mcpRouteSource, /CONAI_MCP_HTTP_ENABLED=true/, 'disabled response should name the explicit opt-in variable');
assert.match(mcpRouteSource, /router\.post\('\/mcp'/, 'stateless HTTP MCP should expose POST /mcp');
assert.match(mcpRouteSource, /router\.get\('\/mcp'[\s\S]*?res\.status\(405\)/, 'GET /mcp should remain method-denied');
assert.match(mcpRouteSource, /router\.delete\('\/mcp'[\s\S]*?res\.status\(405\)/, 'DELETE /mcp should remain method-denied');

assert.match(mcpGuideSource, /HTTP MCP는 기본 비활성/, 'MCP guide should document the disabled-by-default boundary');
assert.match(mcpGuideSource, /CONAI_MCP_HTTP_ENABLED=true/, 'MCP guide should document the explicit HTTP opt-in');
assert.match(mcpGuideSource, /GET \/mcp.*405/, 'MCP guide should document that GET /mcp is not a browser page');
assert.match(mcpGuideSource, /생성 도구는 실제 파일과 생성 이력을 만듭니다/, 'MCP guide should warn generation tools create local artifacts');

for (const requiredPhrase of [
  'HTTP MCP is off by default',
  'Agent preflight contract',
  'Dry-run evidence packet',
  'Stop conditions',
  'mutationApproved',
  'generationApproved',
  'backupRequiredBeforeMutation',
  'generate_comfyui',
  'generate_nai',
  'restore_prompt_data',
]) {
  assert.match(
    operationsContractSource,
    new RegExp(requiredPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `operations contract should include: ${requiredPhrase}`,
  );
}

assert.equal(
  backendPackageJson.scripts['verify:mcp-opt-in-operation-contracts'],
  'tsx src/scripts/verifyMcpOptInOperationContracts.ts',
  'backend package should expose the MCP opt-in operation contract verifier',
);
assert.equal(
  rootPackageJson.scripts['verify:mcp-opt-in-operation-contracts'],
  'cd backend && npm run verify:mcp-opt-in-operation-contracts',
  'root package should expose the MCP opt-in operation contract verifier',
);

console.log('✅ MCP opt-in operation contracts verified');
