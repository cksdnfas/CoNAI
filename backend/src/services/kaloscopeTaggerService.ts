import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { ChildProcess, spawn } from 'child_process';
import { runtimePaths } from '../config/runtimePaths';
import { settingsService } from './settingsService';
import { KaloscopeResult } from './autoTagsComposeService';
import { KaloscopeServerStatus, KaloscopeSettings } from '../types/settings';
import { VideoFrameExtractor } from './videoFrameExtractor';

interface KaloscopeServiceOptions {
  topk?: number;
}

interface KaloscopeDependencyStatus {
  available: boolean;
  missingPackages: string[];
  message: string;
  installCommand?: string;
}

interface KaloscopeModelCacheResult {
  success: boolean;
  message: string;
  path?: string;
  removedPaths?: string[];
}

interface KaloscopeRuntimeStatus {
  isRunning: boolean;
  modelLoaded: boolean;
  currentModel: string | null;
  currentDevice: string | null;
  lastUsedAt: string | null;
}

interface DaemonCommand {
  action: 'load_model' | 'unload_model' | 'tag_image' | 'get_status' | 'shutdown';
  repo?: string;
  model_file?: string;
  device?: string;
  cache_dir?: string;
  image_path?: string;
  topk?: number;
}

interface DaemonResponse {
  success: boolean;
  model?: string;
  device?: string;
  model_loaded?: boolean;
  current_model?: string;
  status?: string;
  error?: string;
  error_type?: string;
  [key: string]: any;
}

export class KaloscopeTaggerService {
  private readonly daemonScriptPath: string;
  private process: ChildProcess | null = null;
  private modelLoaded = false;
  private currentModel: string | null = null;
  private currentDevice: string | null = null;
  private lastUsedAt: Date | null = null;
  private autoUnloadTimer: NodeJS.Timeout | null = null;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private responseQueue: ((response: DaemonResponse) => void)[] = [];

  constructor() {
    this.daemonScriptPath = this.findDaemonScriptPath();
  }

  /** Resolve the Kaloscope Python daemon path across dev and compiled layouts. */
  private findDaemonScriptPath(): string {
    const possiblePaths = [
      path.join(__dirname, 'python', 'kaloscope_tagger_daemon.py'),
      path.join(__dirname, '..', '..', 'python', 'kaloscope_tagger_daemon.py'),
      path.join(__dirname, '..', '..', '..', '..', 'python', 'kaloscope_tagger_daemon.py'),
      path.join(__dirname, '..', '..', '..', 'python', 'kaloscope_tagger_daemon.py'),
      path.join(__dirname, '..', 'python', 'kaloscope_tagger_daemon.py'),
      path.join(process.cwd(), 'app', 'python', 'kaloscope_tagger_daemon.py'),
    ];

    const foundPath = possiblePaths.find((candidate) => fs.existsSync(candidate));
    return foundPath || possiblePaths[0];
  }

  private getKaloscopeSettings(): KaloscopeSettings {
    const settings = settingsService.loadSettings();
    return settings.kaloscope;
  }

  private getPythonPath(): string {
    const settings = settingsService.loadSettings();
    return settings.tagger.pythonPath || 'python';
  }

  private isEnabled(): boolean {
    return this.getKaloscopeSettings().enabled;
  }

  private getModelRepo(): string {
    return process.env.KALOSCOPE_MODEL_REPO || 'DraconicDragon/Kaloscope-onnx';
  }

  private getModelFile(): string {
    return process.env.KALOSCOPE_MODEL_FILE || 'v2.0/kaloscope_2-0.onnx';
  }

  private getCacheBasePaths(): string[] {
    const modelDirName = `models--${this.getModelRepo().replace('/', '--')}`;
    return [
      path.join(runtimePaths.modelsDir, modelDirName),
      path.join(runtimePaths.modelsDir, 'hub', modelDirName),
    ];
  }

  private getRequirementsPath(): string {
    return path.join(path.dirname(this.daemonScriptPath), 'requirements.txt');
  }

  private getInstallCommand(): string {
    return `"${this.getPythonPath()}" -m pip install -r "${this.getRequirementsPath()}"`;
  }

  private createPythonEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      ...extraEnv,
    };
  }

  isModelCached(): boolean {
    const modelFile = this.getModelFile();
    const modelFileName = path.basename(modelFile);

    for (const basePath of this.getCacheBasePaths()) {
      const snapshotsPath = path.join(basePath, 'snapshots');
      if (!fs.existsSync(snapshotsPath)) {
        continue;
      }

      try {
        const snapshots = fs.readdirSync(snapshotsPath);
        for (const snapshot of snapshots) {
          const snapshotPath = path.join(snapshotsPath, snapshot);
          if (!fs.statSync(snapshotPath).isDirectory()) {
            continue;
          }

          if (fs.existsSync(path.join(snapshotPath, modelFile)) || fs.existsSync(path.join(snapshotPath, modelFileName))) {
            return true;
          }
        }
      } catch {
        // Ignore cache read errors and treat as not cached.
      }
    }

    return false;
  }

  async getServerStatus(): Promise<KaloscopeServerStatus> {
    const settings = this.getKaloscopeSettings();
    const dependencyStatus = await this.checkDependencies();
    const runtimeStatus = await this.getStatus();

    return {
      enabled: settings.enabled,
      autoTagOnUpload: settings.autoTagOnUpload,
      currentDevice: runtimeStatus.currentDevice,
      currentModel: runtimeStatus.currentModel,
      modelLoaded: runtimeStatus.modelLoaded,
      isRunning: runtimeStatus.isRunning,
      lastUsedAt: runtimeStatus.lastUsedAt,
      topK: settings.topK,
      keepModelLoaded: settings.keepModelLoaded,
      autoUnloadMinutes: settings.autoUnloadMinutes,
      scriptExists: fs.existsSync(this.daemonScriptPath),
      modelCached: this.isModelCached(),
      modelRepo: this.getModelRepo(),
      modelFile: this.getModelFile(),
      dependenciesAvailable: dependencyStatus.available,
      missingPackages: dependencyStatus.missingPackages,
      statusMessage: dependencyStatus.message,
      installCommand: dependencyStatus.installCommand,
    };
  }

  async checkDependencies(): Promise<KaloscopeDependencyStatus> {
    const pythonPath = this.getPythonPath();
    const installCommand = this.getInstallCommand();

    return await new Promise<KaloscopeDependencyStatus>((resolve) => {
      const child = spawn(
        pythonPath,
        ['-c', 'import importlib.util; import json; mods=["onnxruntime","numpy","PIL","huggingface_hub"]; missing=[m for m in mods if importlib.util.find_spec(m) is None]; print(json.dumps({"missing": missing}))'],
        {
          cwd: path.dirname(this.daemonScriptPath),
          env: this.createPythonEnv(),
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        resolve({
          available: false,
          missingPackages: ['python'],
          message: `Python 실행 실패: ${error.message}`,
          installCommand,
        });
      });

      child.on('close', () => {
        const raw = stdout.trim();
        if (!raw) {
          resolve({
            available: false,
            missingPackages: ['unknown'],
            message: stderr.trim() || 'Kaloscope Python 의존성 확인에 실패했습니다.',
            installCommand,
          });
          return;
        }

        try {
          const parsed = JSON.parse(raw) as { missing?: string[] };
          const missingPackages = Array.isArray(parsed.missing) ? parsed.missing : [];
          if (missingPackages.length === 0) {
            resolve({
              available: true,
              missingPackages: [],
              message: 'Kaloscope Python 의존성이 모두 준비되었습니다.',
              installCommand,
            });
            return;
          }

          resolve({
            available: false,
            missingPackages,
            message: `Kaloscope 실행에 필요한 Python 패키지가 없습니다: ${missingPackages.join(', ')}`,
            installCommand,
          });
        } catch {
          resolve({
            available: false,
            missingPackages: ['unknown'],
            message: stderr.trim() || `Kaloscope Python 의존성 확인 결과를 해석하지 못했습니다: ${raw.slice(0, 300)}`,
            installCommand,
          });
        }
      });
    });
  }

  async ensureModelCached(): Promise<KaloscopeModelCacheResult> {
    const dependencyStatus = await this.checkDependencies();
    if (!dependencyStatus.available) {
      return {
        success: false,
        message: dependencyStatus.message,
      };
    }

    const pythonPath = this.getPythonPath();
    const repoId = this.getModelRepo();
    const modelFile = this.getModelFile();

    return await new Promise<KaloscopeModelCacheResult>((resolve) => {
      const child = spawn(
        pythonPath,
        [
          '-c',
          'from huggingface_hub import snapshot_download; import sys; path = snapshot_download(repo_id=sys.argv[1], allow_patterns=[sys.argv[2]], cache_dir=sys.argv[3]); print(path)',
          repoId,
          modelFile,
          runtimePaths.modelsDir,
        ],
        {
          cwd: path.dirname(this.daemonScriptPath),
          env: this.createPythonEnv({
            HF_HOME: runtimePaths.modelsDir,
            HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
            TRANSFORMERS_CACHE: runtimePaths.modelsDir,
          }),
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          message: `Kaloscope 모델 캐시 실패: ${error.message}`,
        });
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            message: stderr.trim() || `Kaloscope model cache exited with code ${code}`,
          });
          return;
        }

        resolve({
          success: true,
          message: 'Kaloscope 모델을 캐시에 준비했어.',
          path: stdout.trim() || undefined,
        });
      });
    });
  }

  clearModelCache(): KaloscopeModelCacheResult {
    const removedPaths: string[] = [];

    for (const cachePath of this.getCacheBasePaths()) {
      if (!fs.existsSync(cachePath)) {
        continue;
      }

      fs.rmSync(cachePath, { recursive: true, force: true });
      removedPaths.push(cachePath);
    }

    return {
      success: true,
      message: removedPaths.length > 0 ? 'Kaloscope 모델 캐시를 제거했어.' : '제거할 Kaloscope 캐시가 없었어.',
      removedPaths,
    };
  }

  /** Validate the common preconditions before running Kaloscope tagging. */
  private async ensureReady(targetPath: string, targetLabel: 'Image' | 'Video'): Promise<KaloscopeResult | null> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: 'Kaloscope integration disabled by KALOSCOPE_ENABLED',
        error_type: 'Disabled',
      };
    }

    if (!fs.existsSync(this.daemonScriptPath)) {
      return {
        success: false,
        error: `Kaloscope daemon script not found: ${this.daemonScriptPath}`,
        error_type: 'ScriptNotFound',
      };
    }

    if (!fs.existsSync(targetPath)) {
      return {
        success: false,
        error: `${targetLabel} not found: ${targetPath}`,
        error_type: 'FileNotFound',
      };
    }

    const dependencyStatus = await this.checkDependencies();
    if (!dependencyStatus.available) {
      return {
        success: false,
        error: `${dependencyStatus.message}${dependencyStatus.installCommand ? `\n해결: ${dependencyStatus.installCommand}` : ''}`,
        error_type: 'MissingDependency',
      };
    }

    return null;
  }

  /** Resolve the requested top-k with the current settings as fallback. */
  private getEffectiveTopk(options?: KaloscopeServiceOptions): number {
    return options?.topk || this.getKaloscopeSettings().topK;
  }

  /** Start daemon process. */
  async startDaemon(): Promise<void> {
    if (this.process && this.isReady) {
      return;
    }

    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise((resolve, reject) => {
      try {
        if (!fs.existsSync(this.daemonScriptPath)) {
          reject(new Error(`Daemon script not found: ${this.daemonScriptPath}`));
          return;
        }

        this.process = spawn(this.getPythonPath(), [this.daemonScriptPath], {
          cwd: path.dirname(this.daemonScriptPath),
          env: this.createPythonEnv({
            HF_HOME: runtimePaths.modelsDir,
            HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
            TRANSFORMERS_CACHE: runtimePaths.modelsDir,
          }),
        });

        if (!this.process.stdout || !this.process.stderr) {
          reject(new Error('Failed to capture daemon process streams'));
          return;
        }

        const rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          try {
            const response: DaemonResponse = JSON.parse(line);

            if (response.status === 'ready' && !this.isReady) {
              this.isReady = true;
              resolve();
              return;
            }

            const callback = this.responseQueue.shift();
            if (callback) {
              callback(response);
            }
          } catch (error) {
            console.error('[KaloscopeDaemon] Failed to parse response:', line, error);
          }
        });

        this.process.stderr.on('data', (data) => {
          console.error('[KaloscopeDaemon] stderr:', data.toString());
        });

        this.process.on('exit', (code, signal) => {
          console.log('[KaloscopeDaemon] Process exited with code:', code, 'signal:', signal);
          this.isReady = false;
          this.process = null;
          this.readyPromise = null;
          this.modelLoaded = false;
          this.currentModel = null;
          this.currentDevice = null;
        });

        this.process.on('error', (error) => {
          console.error('[KaloscopeDaemon] Process error:', error);
          this.isReady = false;
          this.process = null;
          this.readyPromise = null;
          reject(error);
        });

        setTimeout(() => {
          if (!this.isReady) {
            reject(new Error('Daemon failed to become ready within 30 seconds'));
          }
        }, 30000);
      } catch (error) {
        reject(error);
      }
    });

    return this.readyPromise;
  }

  /** Stop daemon process. */
  async stopDaemon(): Promise<void> {
    this.clearAutoUnloadTimer();

    if (this.process) {
      try {
        await this.sendCommand({ action: 'shutdown' });
      } catch (error) {
        console.error('[KaloscopeDaemon] Error sending shutdown command:', error);
      }

      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGTERM');
        }
      }, 1000);
    }

    this.isReady = false;
    this.process = null;
    this.readyPromise = null;
    this.modelLoaded = false;
    this.currentModel = null;
    this.currentDevice = null;
  }

  /** Send command to daemon. */
  private async sendCommand(command: DaemonCommand): Promise<DaemonResponse> {
    if (!this.isReady || !this.process || !this.process.stdin) {
      throw new Error('Daemon is not running');
    }

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Daemon command timeout'));
      }, 120000);

      this.responseQueue.push((response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.process!.stdin!.write(`${JSON.stringify(command)}\n`);
    });
  }

  /** Ensure daemon is started. */
  private async ensureStarted(): Promise<void> {
    if (!this.isReady) {
      try {
        await this.startDaemon();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to start Kaloscope daemon: ${message}. Check Python installation and dependencies.`);
      }
    }
  }

  /** Load model into memory. */
  async loadModel(device?: string): Promise<void> {
    await this.ensureStarted();

    const targetDevice = device || this.getKaloscopeSettings().device || 'auto';
    const response = await this.sendCommand({
      action: 'load_model',
      repo: this.getModelRepo(),
      model_file: this.getModelFile(),
      device: targetDevice,
      cache_dir: runtimePaths.modelsDir,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to load Kaloscope model');
    }

    this.modelLoaded = true;
    this.currentModel = response.model || 'kaloscope-onnx';
    this.currentDevice = response.device || null;
    this.lastUsedAt = new Date();
  }

  /** Unload model from memory. */
  async unloadModel(): Promise<void> {
    if (!this.modelLoaded || !this.isReady) {
      return;
    }

    this.clearAutoUnloadTimer();

    const response = await this.sendCommand({ action: 'unload_model' });
    if (!response.success) {
      throw new Error(response.error || 'Failed to unload Kaloscope model');
    }

    this.modelLoaded = false;
    this.currentModel = null;
    this.currentDevice = null;
  }

  /** Run the Kaloscope daemon for a single image file. */
  async tagImage(imagePath: string, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    const readyError = await this.ensureReady(imagePath, 'Image');
    if (readyError) {
      return readyError;
    }

    try {
      await this.ensureStarted();

      if (!this.modelLoaded) {
        await this.loadModel();
      }

      this.lastUsedAt = new Date();

      const response = await this.sendCommand({
        action: 'tag_image',
        image_path: imagePath,
        topk: this.getEffectiveTopk(options),
      });

      this.resetAutoUnloadTimer();
      return response as KaloscopeResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
        error_type: 'DaemonException',
      };
    }
  }

  /** Merge multiple frame-level Kaloscope results into one video-level result. */
  private mergeVideoResults(results: KaloscopeResult[], topk: number): KaloscopeResult {
    const successfulResults = results.filter((result) => result.success && result.artists && Object.keys(result.artists).length > 0);

    if (successfulResults.length === 0) {
      const firstFailure = results.find((result) => !result.success);
      return {
        success: false,
        error: firstFailure?.error || 'All Kaloscope frame tagging attempts failed',
        error_type: firstFailure?.error_type || 'MergeError',
      };
    }

    const artistAccumulator: Record<string, { sum: number; count: number }> = {};
    for (const result of successfulResults) {
      for (const [artist, score] of Object.entries(result.artists || {})) {
        if (!artistAccumulator[artist]) {
          artistAccumulator[artist] = { sum: 0, count: 0 };
        }
        artistAccumulator[artist].sum += score;
        artistAccumulator[artist].count += 1;
      }
    }

    const mergedArtists = Object.fromEntries(
      Object.entries(artistAccumulator)
        .map(([artist, value]) => [artist, value.sum / value.count] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topk),
    );

    if (Object.keys(mergedArtists).length === 0) {
      return {
        success: false,
        error: 'No Kaloscope artist predictions were produced from video frames',
        error_type: 'MergeError',
      };
    }

    return {
      success: true,
      model: successfulResults[0].model || 'kaloscope-onnx',
      topk,
      artists: mergedArtists,
      taglist: Object.keys(mergedArtists).join(', '),
      tagged_at: new Date().toISOString(),
    };
  }

  async tagVideo(videoPath: string, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    const readyError = await this.ensureReady(videoPath, 'Video');
    if (readyError) {
      return readyError;
    }

    const topk = this.getEffectiveTopk(options);
    let framePaths: string[] = [];

    try {
      framePaths = await VideoFrameExtractor.extractFramesForTagging(videoPath);
      const frameResults: KaloscopeResult[] = [];

      for (const framePath of framePaths) {
        frameResults.push(await this.tagImage(framePath, { topk }));
      }

      return this.mergeVideoResults(frameResults, topk);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown Kaloscope video tagging error',
        error_type: 'VideoTagError',
      };
    } finally {
      if (framePaths.length > 0) {
        await VideoFrameExtractor.cleanupTempFrames(framePaths);
      }
    }
  }

  async getStatus(): Promise<KaloscopeRuntimeStatus> {
    if (!this.isReady || !this.process) {
      return {
        isRunning: false,
        modelLoaded: false,
        currentModel: null,
        currentDevice: null,
        lastUsedAt: null,
      };
    }

    try {
      const response = await this.sendCommand({ action: 'get_status' });
      return {
        isRunning: true,
        modelLoaded: response.model_loaded || false,
        currentModel: typeof response.current_model === 'string' ? response.current_model : this.currentModel,
        currentDevice: response.device || this.currentDevice,
        lastUsedAt: this.lastUsedAt ? this.lastUsedAt.toISOString() : null,
      };
    } catch {
      return {
        isRunning: false,
        modelLoaded: false,
        currentModel: null,
        currentDevice: null,
        lastUsedAt: null,
      };
    }
  }

  /** Reload configuration. Daemon restarts lazily on next use. */
  async reloadConfig(): Promise<void> {
    if (this.isReady) {
      await this.stopDaemon();
    }
  }

  /** Reset auto-unload timer using the same semantics as WD tagger. */
  private resetAutoUnloadTimer(): void {
    this.clearAutoUnloadTimer();

    const settings = this.getKaloscopeSettings();
    if (!settings.keepModelLoaded) {
      return;
    }

    if (settings.autoUnloadMinutes > 0) {
      const timeoutMs = settings.autoUnloadMinutes * 60 * 1000;
      this.autoUnloadTimer = setTimeout(async () => {
        try {
          await this.unloadModel();
        } catch (error) {
          console.error('[KaloscopeDaemon] Auto-unload failed:', error);
        }
      }, timeoutMs);
    }
  }

  private clearAutoUnloadTimer(): void {
    if (this.autoUnloadTimer) {
      clearTimeout(this.autoUnloadTimer);
      this.autoUnloadTimer = null;
    }
  }
}

export const kaloscopeTaggerService = new KaloscopeTaggerService();
