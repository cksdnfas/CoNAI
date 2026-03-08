/**
 * MCP Stdio 진입점
 *
 * Claude Code에서 stdio 방식으로 직접 사용할 수 있는 별도 진입점.
 * Express 서버와 독립적으로 실행되며, DB 초기화만 수행한 후 MCP 서버를 stdio로 시작한다.
 *
 * 사용법:
 *   npx tsx backend/src/mcp/stdio.ts
 *   node backend/dist/mcp/stdio.js
 *
 * Claude Code 설정:
 *   claude mcp add --transport stdio conai -- npx tsx backend/src/mcp/stdio.ts
 */

import dotenv from 'dotenv';
import path from 'path';

// .env 로드
const getEnvPath = () => {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env');
  }
  // backend/src/mcp/stdio.ts → 루트는 3레벨 위
  return path.resolve(__dirname, '../../../.env');
};

dotenv.config({ path: getEnvPath() });

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server';
import { initializeDatabase } from '../database/init';
import { initializeUserSettingsDb } from '../database/userSettingsDb';
import { initializeApiGenerationDb } from '../database/apiGenerationDb';
import { ensureRuntimeDirectories } from '../config/runtimePaths';

async function main() {
  // 런타임 디렉토리 확인
  ensureRuntimeDirectories();

  // 데이터베이스 초기화 (동기)
  await initializeDatabase();
  initializeUserSettingsDb();
  initializeApiGenerationDb();

  // MCP 서버 생성 및 stdio 트랜스포트 연결
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // stderr로 출력 (stdout은 JSON-RPC 통신에 사용)
  console.error('[MCP] CoNAI MCP server running on stdio');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
