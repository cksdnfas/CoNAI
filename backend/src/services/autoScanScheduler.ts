import * as cron from 'node-cron';
import { FolderScanService } from './folderScanService';
import { WatchedFolderService } from './watchedFolderService';
import { FileWatcherService } from './fileWatcherService';

/**
 * 자동 스캔 스케줄러
 * - 폴더별 scan_interval 설정에 따라 주기적으로 스캔 실행
 * - auto_scan이 활성화된 폴더만 대상
 * - 실시간 워처가 활성화된 경우 전체 스캔 건너뛰기 (백업 검증 스캔 유지)
 */
export class AutoScanScheduler {
  private static cronTask: cron.ScheduledTask | null = null;
  private static isRunning = false;

  /**
   * 스케줄러 시작
   * - 매 1분마다 실행하여 스캔이 필요한 폴더 확인
   */
  static start(): void {
    if (this.cronTask) {
      console.log('⚠️  자동 스캔 스케줄러가 이미 실행 중입니다');
      return;
    }

    console.log('🤖 자동 스캔 스케줄러 시작...');

    // 매 1분마다 실행
    this.cronTask = cron.schedule('* * * * *', async () => {
      if (this.isRunning) {
        console.log('  ⏳ 이전 스캔이 아직 진행 중입니다. 건너뜁니다.');
        return;
      }

      this.isRunning = true;

      try {
        await FolderScanService.runAutoScan();
      } catch (error) {
        console.error('❌ 자동 스캔 중 오류 발생:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✅ 자동 스캔 스케줄러 시작됨 (1분마다 실행)');
  }

  /**
   * 스케줄러 중지
   */
  static stop(): void {
    if (!this.cronTask) {
      console.log('⚠️  자동 스캔 스케줄러가 실행 중이 아닙니다');
      return;
    }

    this.cronTask.stop();
    this.cronTask = null;
    console.log('🛑 자동 스캔 스케줄러 중지됨');
  }

  /**
   * 스케줄러 상태 확인
   */
  static getStatus(): {
    running: boolean;
    scanning: boolean;
  } {
    return {
      running: this.cronTask !== null,
      scanning: this.isRunning
    };
  }

  /**
   * 수동 스캔 트리거 (테스트용)
   */
  static async triggerManualScan(): Promise<void> {
    if (this.isRunning) {
      throw new Error('스캔이 이미 진행 중입니다');
    }

    this.isRunning = true;
    try {
      await FolderScanService.runAutoScan();
    } finally {
      this.isRunning = false;
    }
  }
}
