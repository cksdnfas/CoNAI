import chokidar, { FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import { isImageExtension } from '../constants/supportedExtensions';
import { runtimePaths } from '../config/runtimePaths';
import { WebPConversionService } from './webpConversionService';
import { BackupSource, BackupSourceService, ensureBackupTargetDirectory } from './backupSourceService';

type WatcherState = 'initializing' | 'watching' | 'error' | 'stopped';

interface BackupWatcherEntry {
  sourceId: number;
  sourcePath: string;
  displayName: string;
  targetFolderName: string;
  importMode: 'copy_original' | 'convert_webp';
  webpQuality: number;
  watcher: FSWatcher;
  state: WatcherState;
}

function normalizeComparePath(inputPath: string): string {
  return path.resolve(inputPath).replace(/[\\/]+$/, '').toLowerCase();
}

/** Build a unique target path without overwriting an existing file. */
function buildUniqueTargetPath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  let index = 1;

  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

/** Wait until a newly created file is readable and stable enough to import. */
async function waitForFileWrite(filePath: string): Promise<void> {
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const statsA = await fs.promises.stat(filePath);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const statsB = await fs.promises.stat(filePath);

      if (statsA.size === statsB.size && statsB.size > 0) {
        await fs.promises.access(filePath, fs.constants.R_OK);
        return;
      }
    } catch {
      // Retry until the file is stable.
    }
  }

  throw new Error(`파일 쓰기 완료를 확인하지 못했습니다: ${filePath}`);
}

/** Compute the destination path under uploads for one imported file. */
function buildTargetPath(source: BackupSource, sourceFilePath: string): string {
  const targetRoot = ensureBackupTargetDirectory(source.target_folder_name);
  const relativePath = path.relative(source.source_path, sourceFilePath);
  const relativeDirectory = path.dirname(relativePath);
  const targetDirectory = relativeDirectory === '.' ? targetRoot : path.join(targetRoot, relativeDirectory);

  fs.mkdirSync(targetDirectory, { recursive: true });

  if (source.import_mode === 'convert_webp') {
    const baseName = path.parse(sourceFilePath).name;
    return buildUniqueTargetPath(path.join(targetDirectory, `${baseName}.webp`));
  }

  return buildUniqueTargetPath(path.join(targetDirectory, path.basename(sourceFilePath)));
}

export class BackupSourceWatcherService {
  private static watcherRegistry = new Map<number, BackupWatcherEntry>();

  /** Start all enabled backup source watchers on boot. */
  static async initialize(): Promise<void> {
    console.log('📥 BackupSourceWatcherService 초기화 중...');

    const sources = await BackupSourceService.listSources({ active_only: true });

    for (const source of sources) {
      if (source.watcher_enabled !== 1) {
        continue;
      }

      try {
        await this.startWatcher(source.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`⚠️  백업 소스 워처 시작 실패: ${source.display_name || source.source_path}`);
        BackupSourceService.updateWatcherState(source.id, 'error', message);
      }
    }

    console.log(`✅ BackupSourceWatcherService 초기화 완료: ${this.watcherRegistry.size}개 워처 실행 중`);
  }

  /** Start a watcher for one backup source. */
  static async startWatcher(sourceId: number): Promise<void> {
    const existing = this.watcherRegistry.get(sourceId);
    if (existing && existing.state === 'watching') {
      return;
    }

    if (existing) {
      await this.stopWatcher(sourceId);
    }

    const source = await BackupSourceService.getSource(sourceId);
    if (!source || source.is_active !== 1) {
      throw new Error(`백업 소스를 찾을 수 없거나 비활성화됨: ${sourceId}`);
    }

    ensureBackupTargetDirectory(source.target_folder_name);
    fs.accessSync(source.source_path, fs.constants.R_OK);

    const normalizedUploads = normalizeComparePath(runtimePaths.uploadsDir);
    const normalizedSource = normalizeComparePath(source.source_path);
    if (normalizedUploads === normalizedSource) {
      throw new Error('source_path는 uploads와 동일할 수 없습니다');
    }

    const isNetworkPath = source.source_path.startsWith('\\\\') || source.source_path.startsWith('//');
    const usePolling = source.watcher_polling_interval != null || isNetworkPath;
    const pollingInterval = source.watcher_polling_interval ?? (isNetworkPath ? 5000 : undefined);

    const watcher = chokidar.watch(source.source_path, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 100,
      },
      depth: source.recursive === 1 ? undefined : 0,
      usePolling,
      interval: pollingInterval,
    });

    const entry: BackupWatcherEntry = {
      sourceId,
      sourcePath: source.source_path,
      displayName: source.display_name || path.basename(source.source_path),
      targetFolderName: source.target_folder_name,
      importMode: source.import_mode,
      webpQuality: source.webp_quality,
      watcher,
      state: 'initializing',
    };

    this.watcherRegistry.set(sourceId, entry);
    BackupSourceService.updateWatcherState(sourceId, 'initializing', null);

    watcher.on('add', (filePath) => {
      void this.handleAddEvent(sourceId, filePath);
    });

    watcher.on('error', (error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      entry.state = 'error';
      BackupSourceService.updateWatcherState(sourceId, 'error', message);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('백업 소스 워처 초기화 타임아웃')), 10000);

      watcher.once('ready', () => {
        clearTimeout(timeout);
        entry.state = 'watching';
        BackupSourceService.updateWatcherState(sourceId, 'watching', null);
        resolve();
      });

      watcher.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /** Stop a watcher for one backup source. */
  static async stopWatcher(sourceId: number): Promise<void> {
    const entry = this.watcherRegistry.get(sourceId);
    if (!entry) {
      BackupSourceService.updateWatcherState(sourceId, 'stopped', null);
      return;
    }

    await entry.watcher.close();
    this.watcherRegistry.delete(sourceId);
    BackupSourceService.updateWatcherState(sourceId, 'stopped', null);
  }

  /** Restart a watcher for one backup source. */
  static async restartWatcher(sourceId: number): Promise<void> {
    await this.stopWatcher(sourceId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await this.startWatcher(sourceId);
  }

  /** Import a newly added image into uploads. */
  private static async handleAddEvent(sourceId: number, filePath: string): Promise<void> {
    try {
      if (!isImageExtension(path.extname(filePath))) {
        return;
      }

      const source = await BackupSourceService.getSource(sourceId);
      if (!source || source.is_active !== 1) {
        return;
      }

      await waitForFileWrite(filePath);

      const relativePath = path.relative(source.source_path, filePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return;
      }

      const targetPath = buildTargetPath(source, filePath);

      if (source.import_mode === 'convert_webp') {
        const converted = await WebPConversionService.convertFileToWebPBuffer(filePath, {
          quality: source.webp_quality,
          sourcePathForMetadata: filePath,
          originalFileName: path.basename(filePath),
        });
        await fs.promises.writeFile(targetPath, converted.buffer);
      } else {
        await fs.promises.copyFile(filePath, targetPath);
      }

      BackupSourceService.updateWatcherLastEvent(sourceId);
      BackupSourceService.updateWatcherState(sourceId, 'watching', null);

      console.log(`📥 [BackupSource] ${path.basename(filePath)} -> ${targetPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      BackupSourceService.updateWatcherState(sourceId, 'error', message);
      console.error(`❌ [BackupSource] 파일 가져오기 실패: ${filePath}`, error);
    }
  }
}
