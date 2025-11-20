import { checkDirectoryAccess } from './fileAccess';
import { runtimePaths } from '../config/runtimePaths';

/**
 * 시작 시 데이터 디렉토리 권한 및 환경 체크
 */
export class StartupCheck {
  /**
   * 모든 시작 체크 실행
   */
  static async runAllChecks(): Promise<void> {
    console.log('\n🔍 Starting system checks...\n');

    await this.checkDataDirectoryPermissions();
    await this.checkDockerEnvironment();

    console.log('\n✅ System checks completed\n');
  }

  /**
   * 데이터 디렉토리 권한 체크
   */
  private static async checkDataDirectoryPermissions(): Promise<void> {
    const directories = [
      { name: 'Uploads', path: runtimePaths.uploadsDir },
      { name: 'Database', path: runtimePaths.databaseDir },
      { name: 'Logs', path: runtimePaths.logsDir },
      { name: 'Temp', path: runtimePaths.tempDir },
      { name: 'Models', path: runtimePaths.modelsDir },
      { name: 'RecycleBin', path: runtimePaths.recycleBinDir },
    ];

    let hasWarnings = false;

    for (const dir of directories) {
      const access = await checkDirectoryAccess(dir.path);

      if (!access.exists) {
        console.warn(`⚠️  ${dir.name} directory does not exist: ${dir.path}`);
        console.warn(`   This directory will be created automatically.`);
        hasWarnings = true;
        continue;
      }

      if (!access.readable) {
        console.error(`❌ ${dir.name} directory is not readable: ${dir.path}`);
        console.error(`   Error: ${access.error}`);
        hasWarnings = true;
      }

      if (!access.writable) {
        console.error(`❌ ${dir.name} directory is not writable: ${dir.path}`);
        console.error(`   Error: ${access.error}`);
        hasWarnings = true;
      }
    }

    if (!hasWarnings) {
      console.log('✓ All data directories are accessible');
    }
  }

  /**
   * 도커 환경 감지 및 권한 가이드 출력
   */
  private static async checkDockerEnvironment(): Promise<void> {
    const isDocker = this.isRunningInDocker();

    if (isDocker) {
      console.log('🐳 Running in Docker environment');

      // 데이터 디렉토리 권한 재확인 (도커 전용 경고)
      const uploadsAccess = await checkDirectoryAccess(runtimePaths.uploadsDir);

      if (!uploadsAccess.writable) {
        console.error('\n⚠️  Docker Volume Permission Issue Detected!\n');
        console.error('Troubleshooting steps:');
        console.error('1. Using named volume (recommended):');
        console.error('   - Docker should manage permissions automatically');
        console.error('   - Verify volume mount in docker-compose.yml');
        console.error('');
        console.error('2. Using bind mount:');
        console.error('   - Ensure host directory is owned by UID 1001 (appuser)');
        console.error('   - Run: sudo chown -R 1001:1001 /path/to/host/directory');
        console.error('');
        console.error('3. Network drive mount (Windows UNC path):');
        console.error('   - Check network share permissions');
        console.error('   - Ensure read/write access is granted');
        console.error('');
      } else {
        console.log('✓ Docker volume permissions are correct');
      }

      // UID/GID 정보 출력
      if (process.getuid && process.getgid) {
        const uid = process.getuid();
        const gid = process.getgid();
        console.log(`  Process UID: ${uid}, GID: ${gid}`);

        if (uid !== 1001) {
          console.warn(`  ⚠️  Expected UID 1001, but running as ${uid}`);
        }
      }
    } else {
      console.log('💻 Running in native environment');
    }
  }

  /**
   * 도커 환경에서 실행 중인지 감지
   */
  private static isRunningInDocker(): boolean {
    // 환경변수로 명시적 표시
    if (process.env.DOCKER === 'true') {
      return true;
    }

    // /.dockerenv 파일 존재 여부 체크
    try {
      const fs = require('fs');
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }
    } catch (error) {
      // 파일 체크 실패는 무시
    }

    // /proc/1/cgroup 체크 (Linux)
    try {
      const fs = require('fs');
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('kubepods')) {
        return true;
      }
    } catch (error) {
      // 파일 없음 또는 읽기 실패는 무시 (Windows 등)
    }

    return false;
  }
}
