import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildMcpDryRunEvidencePacket,
  classifyMcpToolForDryRunEvidence,
} from '../mcp/mcpDryRunEvidence';

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const backendRoot = path.join(projectRoot, 'backend');
const evidenceDocSource = fs.readFileSync(
  path.join(projectRoot, 'docs', 'systems', 'agent-mcp-local-evidence-export.md'),
  'utf8',
);
const optInContractSource = fs.readFileSync(
  path.join(projectRoot, 'docs', 'systems', 'agent-mcp-opt-in-operation-contracts.md'),
  'utf8',
);
const systemsIndexSource = fs.readFileSync(path.join(projectRoot, 'docs', 'systems', 'index.md'), 'utf8');
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const backendPackageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));

const defaultPacket = buildMcpDryRunEvidencePacket();
assert.equal(defaultPacket.schemaVersion, 1, 'dry-run evidence packet should use schema version 1');
assert.equal(defaultPacket.dryRunOnly, true, 'dry-run evidence export should stay dry-run only');
assert.equal(defaultPacket.externalSideEffects, false, 'dry-run evidence export should not create external side effects');
assert.equal(defaultPacket.mutationApproved, false, 'dry-run evidence export should not imply mutation approval');
assert.equal(defaultPacket.generationApproved, false, 'dry-run evidence export should not imply generation approval');
assert.equal(defaultPacket.targetUrl, 'http://localhost:1666/mcp', 'default target URL should point at local MCP');
assert.deepEqual(
  defaultPacket.toolsReviewed.map((tool) => tool.name),
  ['search_prompts', 'search_images', 'get_generation_history'],
  'default evidence export should review read-only tools only',
);
assert.equal(defaultPacket.toolsReviewed.every((tool) => tool.approvalRequired === false), true, 'default tools should not require approval');

const mutationPacket = buildMcpDryRunEvidencePacket({
  client: 'claude-code',
  tools: ['search_prompts', 'backup_prompt_data', 'restore_prompt_data', 'generate_comfyui', 'unknown_tool'],
});
assert.equal(mutationPacket.client, 'claude-code', 'custom client should be reflected in evidence');
assert.equal(mutationPacket.backupRequiredBeforeMutation, true, 'mutation packets should require backup evidence');
assert.deepEqual(
  mutationPacket.toolsReviewed.map((tool) => [tool.name, tool.sideEffectClass, tool.approvalRequired]),
  [
    ['search_prompts', 'read-only', false],
    ['backup_prompt_data', 'safety-prerequisite', false],
    ['restore_prompt_data', 'local-mutation', true],
    ['generate_comfyui', 'generation-external-service', true],
    ['unknown_tool', 'unknown', true],
  ],
  'tool review should classify dry-run approval boundaries',
);

assert.equal(classifyMcpToolForDryRunEvidence('generate_nai'), 'generation-external-service');
assert.equal(classifyMcpToolForDryRunEvidence('move_prompts_between_groups'), 'local-mutation');
assert.equal(classifyMcpToolForDryRunEvidence('search_wildcards'), 'read-only');

for (const requiredPhrase of [
  'agent-mcp-local-evidence-export',
  'npm run export:mcp-dry-run-evidence',
  'dryRunOnly',
  'externalSideEffects',
  'operator-check-required',
  'approvalRequired',
  'backupRequiredBeforeMutation',
  'restore_prompt_data',
  'generate_comfyui',
  'generate_nai',
  'calling MCP tools',
]) {
  assert.match(
    `${evidenceDocSource}\n${optInContractSource}\n${systemsIndexSource}`,
    new RegExp(requiredPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `MCP local evidence docs should include: ${requiredPhrase}`,
  );
}

assert.equal(
  backendPackageJson.scripts['export:mcp-dry-run-evidence'],
  'tsx src/scripts/exportMcpDryRunEvidence.ts',
  'backend package should expose the local MCP evidence exporter',
);
assert.equal(
  backendPackageJson.scripts['verify:mcp-local-evidence-export'],
  'tsx src/scripts/verifyMcpLocalEvidenceExportContracts.ts',
  'backend package should expose the MCP local evidence export verifier',
);
assert.equal(
  rootPackageJson.scripts['export:mcp-dry-run-evidence'],
  'cd backend && npm run export:mcp-dry-run-evidence --',
  'root package should expose the local MCP evidence exporter',
);
assert.equal(
  rootPackageJson.scripts['verify:mcp-local-evidence-export'],
  'cd backend && npm run verify:mcp-local-evidence-export',
  'root package should expose the MCP local evidence export verifier',
);

console.log('✅ MCP local evidence export contracts verified');
