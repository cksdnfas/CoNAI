import { buildMcpDryRunEvidencePacket } from '../mcp/mcpDryRunEvidence';

const [, , ...args] = process.argv;
const targetUrlArg = args.find((arg) => arg.startsWith('--target='));
const clientArg = args.find((arg) => arg.startsWith('--client='));
const toolsArg = args.find((arg) => arg.startsWith('--tools='));

const packet = buildMcpDryRunEvidencePacket({
  targetUrl: targetUrlArg?.slice('--target='.length),
  client: clientArg?.slice('--client='.length),
  tools: toolsArg
    ?.slice('--tools='.length)
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean),
});

console.log(JSON.stringify(packet, null, 2));
