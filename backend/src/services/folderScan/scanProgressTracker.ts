/**
 * 스캔 진행 추적 서비스
 */
export class ScanProgressTracker {
  /**
   * ETA 포맷팅 (초 -> "Xm Ys" 형식)
   */
  static formatETA(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '계산 중...';
    if (seconds < 60) return Math.round(seconds) + '초';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (minutes < 60) {
      return minutes + '분 ' + remainingSeconds + '초';
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours + '시간 ' + remainingMinutes + '분';
  }

  /**
   * 진행 상황 계산
   */
  static calculateProgress(
    processed: number,
    total: number,
    startTime: number
  ): {
    speed: number;
    eta: number;
    etaFormatted: string;
    percentComplete: number;
  } {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? processed / elapsed : 0;
    const remaining = total - processed;
    const eta = speed > 0 ? remaining / speed : 0;

    return {
      speed,
      eta,
      etaFormatted: this.formatETA(eta),
      percentComplete: total > 0 ? (processed / total) * 100 : 0
    };
  }
}