import * as cron from 'node-cron';
import { FolderScanService } from './folderScan';
import { WatchedFolderService } from './watchedFolderService';
import { FileWatcherService } from './fileWatcherService';
import { BackgroundProcessorService } from './backgroundProcessorService';

/**
 * 자동 스캔 스케줄러
 * - 폴더별 scan_interval 설정에 따라 주기적으로 스캔 실행
 * - auto_scan이 활성화된 폴더만 대상
 * - 실시간 워처가 활성화된 경우 전체 스캔 건너뛰기 (백업 검증 스캔 유지)
 * - Phase 2 백그라운드 처리 트리거
 */
export class AutoScanScheduler {
  private static cronTask: cron.ScheduledTask | null = null;
  private static phase2CronTask: cron.ScheduledTask | null = null;
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

    // Phase 2 백그라운드 처리 스케줄러 (매 5분마다)
    this.phase2CronTask = cron.schedule('*/5 * * * *', async () => {
      const unprocessedCount = BackgroundProcessorService.getUnprocessedCount();
      if (unprocessedCount > 0) {
        console.log(`🔨 Phase 2 처리 시작: ${unprocessedCount}개 대기 중`);
        try {
          await BackgroundProcessorService.processUnhashedImages();
        } catch (error) {
          console.error('❌ Phase 2 처리 중 오류 발생:', error);
        }
      }
    });

    console.log('✅ 자동 스캔 스케줄러 시작됨 (Phase 1: 1분마다, Phase 2: 5분마다)');
  }

  /**
   * 스케줄러 중지
   */
  static stop(): void {
    if (!this.cronTask && !this.phase2CronTask) {
      console.log('⚠️  자동 스캔 스케줄러가 실행 중이 아닙니다');
      return;
    }

    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    if (this.phase2CronTask) {
      this.phase2CronTask.stop();
      this.phase2CronTask = null;
    }

    console.log('🛑 자동 스캔 스케줄러 중지됨 (Phase 1 + Phase 2)');
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
