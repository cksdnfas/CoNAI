export type SystemMaintenanceLockMode = 'exclusive';

export interface SystemMaintenanceLockSnapshot {
  active: boolean;
  mode: SystemMaintenanceLockMode | null;
  owner: string | null;
  reason: string | null;
  message: string | null;
  startedAt: string | null;
}

interface ActiveSystemMaintenanceLock {
  mode: SystemMaintenanceLockMode;
  owner: string;
  reason: string;
  message: string;
  startedAt: string;
}

export interface AcquiredSystemMaintenanceLock {
  snapshot: SystemMaintenanceLockSnapshot;
  release: () => void;
}

/** In-process exclusive maintenance gate for jobs that rewrite media identity. */
export class SystemMaintenanceLockService {
  private static activeLock: ActiveSystemMaintenanceLock | null = null;

  static acquireExclusive(input: {
    owner: string;
    reason: string;
    message: string;
  }): AcquiredSystemMaintenanceLock {
    if (this.activeLock && this.activeLock.owner !== input.owner) {
      throw new Error(`시스템 대기 모드가 이미 실행 중입니다: ${this.activeLock.reason}`);
    }

    this.activeLock = {
      mode: 'exclusive',
      owner: input.owner,
      reason: input.reason,
      message: input.message,
      startedAt: new Date().toISOString(),
    };

    return {
      snapshot: this.getStatus(),
      release: () => this.release(input.owner),
    };
  }

  static release(owner: string): void {
    if (!this.activeLock) {
      return;
    }

    if (this.activeLock.owner !== owner) {
      throw new Error(`시스템 대기 모드 소유자가 다릅니다: ${this.activeLock.owner}`);
    }

    this.activeLock = null;
  }

  static isExclusiveActive(): boolean {
    return this.activeLock?.mode === 'exclusive';
  }

  static isOwnedBy(owner: string): boolean {
    return this.activeLock?.owner === owner;
  }

  static getStatus(): SystemMaintenanceLockSnapshot {
    if (!this.activeLock) {
      return {
        active: false,
        mode: null,
        owner: null,
        reason: null,
        message: null,
        startedAt: null,
      };
    }

    return {
      active: true,
      mode: this.activeLock.mode,
      owner: this.activeLock.owner,
      reason: this.activeLock.reason,
      message: this.activeLock.message,
      startedAt: this.activeLock.startedAt,
    };
  }
}
