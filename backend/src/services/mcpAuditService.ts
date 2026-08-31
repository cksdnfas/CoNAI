import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

const MCP_AUDIT_LOG_PATH = path.join(runtimePaths.logsDir, 'mcp-audit.log');

export type McpAuditRecord = {
  timestamp: string;
  keyId: string | null;
  keyName: string | null;
  ip: string | null;
  rpcMethod: string | null;
  toolName: string | null;
  statusCode: number;
  durationMs: number;
};

/** Append one secret-free JSONL record for every authenticated MCP request. */
export function appendMcpAuditRecord(record: McpAuditRecord): void {
  try {
    fs.mkdirSync(path.dirname(MCP_AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(MCP_AUDIT_LOG_PATH, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[MCP] Failed to append audit record:', error);
  }
}
