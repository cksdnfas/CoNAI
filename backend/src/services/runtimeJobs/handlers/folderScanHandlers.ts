import { FolderScanService } from '../../folderScan'
import type { ScanResult } from '../../folderScan/types'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

/**
 * 전체 폴더 스캔 잡.
 *
 * 이관 전에는 `POST /api/folders/scan-all` 이 활성 폴더를 순차 스캔하는 동안 소켓을 붙잡고 있었다.
 * `index.ts` 의 `server.setTimeout(60000)` 때문에 폴더가 몇 개만 되어도 소켓이 먼저 끊겼고,
 * 클라이언트는 실패 토스트를 띄우는데 서버는 스캔을 계속하는 불일치가 남았다.
 *
 * 폴더 단위 진행률/취소는 `FolderScanService.scanAllFolders(ctx)` 안에 있다. 스캔 루프를
 * 여기로 복제하면 스케줄러 경로(`runAutoScan`)와 로직이 두 벌이 된다.
 */

export type FolderScanAllJobParams = Record<string, never>

export interface FolderScanAllJobResult {
  totalFolders: number
  totalScanned: number
  totalNew: number
  totalExisting: number
  totalErrors: number
  results: ScanResult[]
}

/** Summarize one scan-all pass into the legacy `ScanAllSummary` shape the route used to return. */
export function summarizeScanAllResults(results: ScanResult[]): FolderScanAllJobResult {
  return {
    totalFolders: results.length,
    totalScanned: results.reduce((sum, result) => sum + result.totalScanned, 0),
    totalNew: results.reduce((sum, result) => sum + result.newImages, 0),
    totalExisting: results.reduce((sum, result) => sum + result.existingImages, 0),
    totalErrors: results.reduce((sum, result) => sum + result.errors.length, 0),
    results,
  }
}

async function runFolderScanAll(ctx: RuntimeJobContext<FolderScanAllJobParams>): Promise<FolderScanAllJobResult> {
  return summarizeScanAllResults(await FolderScanService.scanAllFolders(ctx))
}

export function registerFolderScanJobHandlers(): void {
  RuntimeJobRunner.register<FolderScanAllJobParams, FolderScanAllJobResult>({
    kind: 'folder-scan-all',
    singletonKey: () => 'folder-scan-all',
    handler: runFolderScanAll,
  })
}
