import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
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

export class KaloscopeTaggerService {
  private readonly scriptPath: string;

  constructor() {
    this.scriptPath = this.findScriptPath();
  }

  /** Resolve the Kaloscope Python script path across dev and compiled layouts. */
  private findScriptPath(): string {
    const possiblePaths = [
      path.join(__dirname, 'python', 'kaloscope_tagger.py'),
      path.join(__dirname, '..', '..', 'python', 'kaloscope_tagger.py'),
      path.join(__dirname, '..', '..', '..', '..', 'python', 'kaloscope_tagger.py'),
      path.join(__dirname, '..', '..', '..', 'python', 'kaloscope_tagger.py'),
      path.join(__dirname, '..', 'python', 'kaloscope_tagger.py'),
      path.join(process.cwd(), 'app', 'python', 'kaloscope_tagger.py'),
    ];

    const foundPath = possiblePaths.find((candidate) => fs.existsSync(candidate));
    if (!foundPath) {
      console.error('[Kaloscope] Script not found in any location:', possiblePaths);
      return possiblePaths[0];
    }

    return foundPath;
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
    return path.join(path.dirname(this.scriptPath), 'requirements.txt');
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

    return {
      enabled: settings.enabled,
      autoTagOnUpload: settings.autoTagOnUpload,
      currentDevice: settings.device,
      topK: settings.topK,
      scriptExists: fs.existsSync(this.scriptPath),
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
          cwd: path.dirname(this.scriptPath),
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
          cwd: path.dirname(this.scriptPath),
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

    if (!fs.existsSync(this.scriptPath)) {
      return {
        success: false,
        error: `Kaloscope script not found: ${this.scriptPath}`,
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

  /** Run the Python Kaloscope tagger for a single image file. */
  private async runTagImage(imagePath: string, topk: number): Promise<KaloscopeResult> {
    const pythonPath = this.getPythonPath();
    const kaloscopeSettings = this.getKaloscopeSettings();
    const args = [
      this.scriptPath,
      '--image', imagePath,
      '--repo', this.getModelRepo(),
      '--model-file', this.getModelFile(),
      '--topk', String(topk),
      '--device', kaloscopeSettings.device,
      '--cache-dir', runtimePaths.modelsDir,
    ];

    return await new Promise<KaloscopeResult>((resolve) => {
      const child = spawn(pythonPath, args, {
        cwd: path.dirname(this.scriptPath),
        env: this.createPythonEnv({
          HF_HOME: runtimePaths.modelsDir,
          HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
          TRANSFORMERS_CACHE: runtimePaths.modelsDir,
        }),
      });

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
          error: error.message,
          error_type: 'SpawnError',
        });
      });

      child.on('close', (code) => {
        const raw = stdout.trim();
        if (!raw) {
          resolve({
            success: false,
            error: stderr.trim() || `Kaloscope exited with code ${code}`,
            error_type: 'EmptyOutput',
          });
          return;
        }

        try {
          const parsed = JSON.parse(raw) as KaloscopeResult;
          resolve(parsed);
        } catch {
          resolve({
            success: false,
            error: stderr.trim() || `Invalid Kaloscope output: ${raw.slice(0, 300)}`,
            error_type: 'ParseError',
          });
        }
      });
    });
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

  async tagImage(imagePath: string, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    const readyError = await this.ensureReady(imagePath, 'Image');
    if (readyError) {
      return readyError;
    }

    return await this.runTagImage(imagePath, this.getEffectiveTopk(options));
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
        frameResults.push(await this.runTagImage(framePath, topk));
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
}

export const kaloscopeTaggerService = new KaloscopeTaggerService();
