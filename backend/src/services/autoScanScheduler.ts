import * as cron from 'node-cron';
import { FolderScanService } from './folderScan';
import { WatchedFolderService } from './watchedFolderService';
import { FileWatcherService } from './fileWatcherService';
import { BackgroundProcessorService } from './backgroundProcessorService';
import { SystemSettingsService } from './systemSettingsService';
import { FileVerificationService } from './fileVerificationService';

/**
 * 자동 스캔 스케줄러
 * - 폴더별 scan_interval 설정에 따라 주기적으로 스캔 실행
 * - auto_scan이 활성화된 폴더만 대상
 * - 실시간 워처가 활성화된 경우 전체 스캔 건너뛰기 (백업 검증 스캔 유지)
 * - Phase 2 백그라운드 처리 트리거
 */
export class AutoScanScheduler {
  private static cronTask: cron.ScheduledTask | null = null;
  private static phase2Timer: NodeJS.Timeout | null = null;
  private static phase3Timer: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static isPhase2Running = false;

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

    // Phase 2 백그라운드 처리 스케줄러 (초 단위로 동작)
    // 사용자 설정 제거 -> 1초로 고정
    const phase2IntervalMs = 1000;

    const runPhase2 = async () => {
      // 중복 실행 방지 락
      if (this.isPhase2Running) {
        // console.log('  ⏳ Phase 2 백그라운드 처리가 이미 진행 중입니다. 건너뜁니다.');
        return;
      }

      this.isPhase2Running = true;

      try {
        const unprocessedCount = BackgroundProcessorService.getUnprocessedCount();
        if (unprocessedCount > 0) {
          // console.log(`🔨 백그라운드 처리 시작: ${unprocessedCount}개 대기 중`);
          try {
            await BackgroundProcessorService.processUnhashedImages();
          } catch (error) {
            console.error('❌ 백그라운드 처리 중 오류 발생:', error);
          }
        }
      } finally {
        this.isPhase2Running = false;
      }
    };

    // 즉시 한 번 실행
    runPhase2();

    // 주기적 실행
    this.phase2Timer = setInterval(runPhase2, phase2IntervalMs);

    // Phase 3 파일 검증 스케줄러 (초 단위로 동작, 활성화 시만)
    const startFileVerification = () => {
      if (SystemSettingsService.isFileVerificationEnabled()) {
        const verificationIntervalSeconds = SystemSettingsService.getFileVerificationInterval();
        const verificationIntervalMs = verificationIntervalSeconds * 1000;

        const runVerification = async () => {
          // 활성화 상태 다시 확인 (런타임에 비활성화될 수 있음)
          if (!SystemSettingsService.isFileVerificationEnabled()) {
            return;
          }

          const progress = FileVerificationService.getProgress();
          if (progress.isRunning) {
            console.log('  ⏳ 파일 검증이 이미 진행 중입니다. 건너뜁니다.');
            return;
          }

          console.log('🔍 Phase 3 파일 검증 시작...');
          try {
            await FileVerificationService.verifyAllFiles();
          } catch (error) {
            console.error('❌ Phase 3 파일 검증 중 오류 발생:', error);
          }
        };

        // 주기적 실행
        this.phase3Timer = setInterval(runVerification, verificationIntervalMs);

        console.log(`✅ 파일 검증 스케줄러 시작됨 (Phase 3: ${verificationIntervalSeconds}초마다)`);
      } else {
        console.log('ℹ️  파일 검증이 비활성화되어 있습니다');
      }
    };

    // 파일 검증 스케줄러 시작
    startFileVerification();

    console.log(`✅ 자동 스캔 스케줄러 시작됨 (Phase 1: 1분마다, Phase 2: 1초마다, Phase 3: 파일 검증 활성화시)`);
  }

  /**
   * 스케줄러 중지
   */
  static stop(): void {
    if (!this.cronTask && !this.phase2Timer && !this.phase3Timer) {
      console.log('⚠️  자동 스캔 스케줄러가 실행 중이 아닙니다');
      return;
    }

    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    if (this.phase2Timer) {
      clearInterval(this.phase2Timer);
      this.phase2Timer = null;
    }

    if (this.phase3Timer) {
      clearInterval(this.phase3Timer);
      this.phase3Timer = null;
    }

    console.log('🛑 자동 스캔 스케줄러 중지됨 (Phase 1 + Phase 2 + Phase 3)');
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

  /**
   * 스케줄러 재시작 (설정 변경 시)
   */
  static restart(): void {
    console.log('🔄 자동 스캔 스케줄러 재시작 중...');
    this.stop();
    this.start();
  }
}
