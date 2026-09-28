import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { runtimePaths } from '../config/runtimePaths';
import { settingsService } from './settingsService';
import type { TaggerModel, TaggerServerStatus } from '@conai/shared';

export interface TaggerResult {
  success: boolean;
  caption?: string;
  taglist?: string;
  rating?: Record<string, number>;
  general?: Record<string, number>;
  character?: Record<string, number>;
  model?: string;
  thresholds?: {
    general: number;
    character: number;
  };
  error?: string;
  error_type?: string;
}

interface DaemonCommand {
  action: 'load_model' | 'unload_model' | 'tag_image' | 'get_status' | 'shutdown';
  model?: TaggerModel;
  device?: string;
  cache_dir?: string;
  image_path?: string;
  gen_threshold?: number;
  char_threshold?: number;
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


const DAEMON_READY_TIMEOUT_MS = 120_000;
class TaggerDaemon {
  private process: ChildProcess | null = null;
  private modelLoaded = false;
  private currentModel: TaggerModel | null = null;
  private currentDevice: string | null = null;
  private lastUsedAt: Date | null = null;
  private autoUnloadTimer: NodeJS.Timeout | null = null;
  private scriptPath: string;
  private pythonPath: string;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;

  // Response queue management
  private responseQueue: ((response: DaemonResponse) => void)[] = [];

  constructor() {
    this.scriptPath = this.findScriptPath();
    this.pythonPath = this.getPythonPath();
  }

  /**
   * Find Python daemon script path
   */
  private findScriptPath(): string {
    const possiblePaths = [
      // Docker bundle: bundle.js at /app, python at /app/python
      path.join(__dirname, 'python', 'wdv3_tagger_daemon.py'),
      // Development: backend/src/services -> backend/python
      path.join(__dirname, '..', '..', 'python', 'wdv3_tagger_daemon.py'),
      // Compiled integrated build: backend/dist/backend/src/services -> backend/python
      path.join(__dirname, '..', '..', '..', '..', 'python', 'wdv3_tagger_daemon.py'),
      // Compiled build with bundled runtime assets: backend/dist/backend/src/services -> backend/dist/python
      path.join(__dirname, '..', '..', '..', 'python', 'wdv3_tagger_daemon.py'),
      // Portable build: dist/services -> app/python
      path.join(__dirname, '..', 'python', 'wdv3_tagger_daemon.py'),
      // Bundle build: relative to process.cwd()
      path.join(process.cwd(), 'app', 'python', 'wdv3_tagger_daemon.py')
    ];

    const foundPath = possiblePaths.find(p => fs.existsSync(p));
    if (!foundPath) {
      console.error('[TaggerDaemon] Script not found in any location:', possiblePaths);
      return possiblePaths[0]; // Return first path as fallback
    }

    return foundPath;
  }

  /**
   * Get Python executable path from settings
   */
  private getPythonPath(): string {
    const settings = settingsService.loadSettings();
    return settings.tagger.pythonPath || 'python';
  }

  /**
   * Start daemon process
   */
  async start(): Promise<void> {
    if (this.process && this.isReady) {
      console.log('[TaggerDaemon] Already running');
      return;
    }

    if (this.readyPromise) {
      console.log('[TaggerDaemon] Waiting for existing start operation...');
      return this.readyPromise;
    }

    console.log('[TaggerDaemon] Starting daemon process...');

    this.readyPromise = new Promise((resolve, reject) => {
      try {
        if (!fs.existsSync(this.scriptPath)) {
          reject(new Error(`Daemon script not found: ${this.scriptPath}`));
          return;
        }

        // Spawn Python daemon process
        const child = spawn(this.pythonPath, [this.scriptPath], {
          cwd: path.dirname(this.scriptPath),
          env: {
            ...process.env,
            HF_HOME: runtimePaths.modelsDir,
            HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
            TRANSFORMERS_CACHE: runtimePaths.modelsDir,
            PYTHONUNBUFFERED: '1', // Disable Python output buffering
            PYTHONIOENCODING: 'utf-8' // Force UTF-8 encoding for stdin/stdout
          }
        });
        this.process = child;
        const isCurrent = () => this.process === child;

        if (!child.stdout || !child.stderr) {
          reject(new Error('Failed to capture daemon process streams'));
          return;
        }

        // Setup stdout line reader
        const rl = readline.createInterface({
          input: child.stdout,
          crlfDelay: Infinity
        });

        rl.on('line', (line) => {
          try {
            if (!isCurrent()) {
              return;
            }
            const response: DaemonResponse = JSON.parse(line);

            // Handle ready signal
            if (response.status === 'ready' && !this.isReady) {
              this.isReady = true;
              console.log('[TaggerDaemon] Daemon is ready');
              resolve();
              return;
            }

            // Handle normal responses
            const callback = this.responseQueue.shift();
            if (callback) {
              callback(response);
            } else {
              console.warn('[TaggerDaemon] Received response without callback:', response);
            }
          } catch (error) {
            console.error('[TaggerDaemon] Failed to parse response:', line, error);
          }
        });

        // Handle stderr
        child.stderr.on('data', (data) => {
          console.error('[TaggerDaemon] stderr:', data.toString());
        });

        // Handle process exit
        child.on('exit', (code, signal) => {
          if (!isCurrent()) {
            return;
          }
          console.log('[TaggerDaemon] Process exited with code:', code, 'signal:', signal);
          this.isReady = false;
          this.process = null;
          this.readyPromise = null;
          this.modelLoaded = false;
          this.currentModel = null;
          this.currentDevice = null;
          this.failPendingResponses('Daemon exited');
        });

        // Handle process errors
        child.on('error', (error) => {
          if (!isCurrent()) {
            return;
          }
          console.error('[TaggerDaemon] Process error:', error);
          this.isReady = false;
          this.process = null;
          this.readyPromise = null;
          reject(error);
        });

        // A cold container (empty page cache, boot-time scans) can take well over 30s to import torch.
        setTimeout(() => {
          if (isCurrent() && !this.isReady) {
            console.error('[TaggerDaemon] Daemon did not become ready in time; stopping it so the next request retries cleanly');
            this.resetDaemonState();
            child.kill('SIGTERM');
            reject(new Error(`Daemon failed to become ready within ${DAEMON_READY_TIMEOUT_MS / 1000} seconds`));
          }
        }, DAEMON_READY_TIMEOUT_MS);

      } catch (error) {
        reject(error);
      }
    });

    return this.readyPromise;
  }

  /**
   * Stop daemon process
   */
  async stop(): Promise<void> {
    console.log('[TaggerDaemon] Stopping daemon...');

    this.clearAutoUnloadTimer();

    if (this.process) {
      try {
        // Send shutdown command
        await this.sendCommand({ action: 'shutdown' });
      } catch (error) {
        console.error('[TaggerDaemon] Error sending shutdown command:', error);
      }

      // Wait a bit then kill if still running
      const stoppingProcess = this.process;
      setTimeout(() => {
        if (stoppingProcess && stoppingProcess.exitCode === null) {
          stoppingProcess.kill('SIGTERM');
        }
      }, 1000);
    }

    this.resetDaemonState();
  }

  /** Forget the current process; late events from it are ignored by the per-process guards. */
  private resetDaemonState(): void {
    this.isReady = false;
    this.process = null;
    this.readyPromise = null;
    this.modelLoaded = false;
    this.currentModel = null;
    this.currentDevice = null;
    this.failPendingResponses('Daemon stopped');
  }

  /** Answer every queued request so callers fail fast instead of waiting for the command timeout. */
  private failPendingResponses(reason: string): void {
    const pending = this.responseQueue.splice(0);
    pending.forEach((callback) => callback({ success: false, error: reason } as DaemonResponse));
  }

  /**
   * Send command to daemon
   */
  private async sendCommand(command: DaemonCommand): Promise<DaemonResponse> {
    if (!this.isReady || !this.process || !this.process.stdin) {
      throw new Error('Daemon is not running');
    }

    return new Promise((resolve, reject) => {
      const child = this.process!;
      const callback = (response: DaemonResponse) => {
        clearTimeout(timeout);
        resolve(response);
      };
      const timeout = setTimeout(() => {
        const index = this.responseQueue.indexOf(callback);
        if (index >= 0) {
          this.responseQueue.splice(index, 1);
        }
        reject(new Error('Daemon command timeout'));
        if (this.process === child) {
          console.error('[TaggerDaemon] Command timed out; restarting the daemon to resync responses');
          this.resetDaemonState();
          child.kill('SIGTERM');
        }
      }, 120000);

      this.responseQueue.push(callback);

      // Send command
      const commandJson = JSON.stringify(command) + '\n';
      this.process!.stdin!.write(commandJson);
    });
  }

  /**
   * Load model into memory
   */
  async loadModel(model?: TaggerModel, device?: string): Promise<void> {
    await this.ensureStarted();

    const settings = settingsService.loadSettings();
    const targetModel = model || settings.tagger.model;
    const targetDevice = device || settings.tagger.device || 'auto';

    console.log(`[TaggerDaemon] Loading model: ${targetModel} on device: ${targetDevice}`);

    const response = await this.sendCommand({
      action: 'load_model',
      model: targetModel,
      device: targetDevice,
      cache_dir: runtimePaths.modelsDir
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to load model');
    }

    this.modelLoaded = true;
    this.currentModel = targetModel;
    this.currentDevice = response.device || null;
    this.lastUsedAt = new Date();

    console.log(`[TaggerDaemon] Model loaded: ${targetModel} on ${response.device}`);
  }

  /**
   * Unload model from memory
   */
  async unloadModel(): Promise<void> {
    if (!this.modelLoaded) {
      console.log('[TaggerDaemon] Model not loaded, nothing to unload');
      return;
    }

    console.log('[TaggerDaemon] Unloading model...');

    this.clearAutoUnloadTimer();

    const response = await this.sendCommand({
      action: 'unload_model'
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to unload model');
    }

    this.modelLoaded = false;
    this.currentModel = null;
    this.currentDevice = null;

    console.log('[TaggerDaemon] Model unloaded');
  }

  /**
   * Tag a single image
   */
  async tagImage(imagePath: string): Promise<TaggerResult> {
    try {
      await this.ensureStarted();

      const settings = settingsService.loadSettings();

      // Auto-load model if not loaded
      if (!this.modelLoaded) {
        console.log('[TaggerDaemon] Auto-loading model for tagging...');
        try {
          await this.loadModel();
          console.log('[TaggerDaemon] Model loaded successfully');
        } catch (loadError) {
          const message = loadError instanceof Error ? loadError.message : 'Unknown error';
          console.error('[TaggerDaemon] Failed to load model:', message);
          return {
            success: false,
            error: `Failed to load model: ${message}`,
            error_type: 'ModelLoadError'
          };
        }
      }

      // Update last used time
      this.lastUsedAt = new Date();

      // console.log('[TaggerDaemon] Sending tag command for:', imagePath);

      // Send tag command
      const response = await this.sendCommand({
        action: 'tag_image',
        image_path: imagePath,
        gen_threshold: settings.tagger.generalThreshold,
        char_threshold: settings.tagger.characterThreshold
      });

      /*
      console.log('[TaggerDaemon] Tag command response:', {
        success: response.success,
        hasError: !!response.error,
        errorType: response.error_type
      });
      */

      // Reset auto-unload timer
      this.resetAutoUnloadTimer();

      return response as TaggerResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TaggerDaemon] tagImage exception:', message);
      return {
        success: false,
        error: message,
        error_type: 'DaemonException'
      };
    }
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<TaggerServerStatus> {
    if (!this.isReady || !this.process) {
      return {
        isRunning: false,
        modelLoaded: false,
        currentModel: null,
        currentDevice: null,
        lastUsedAt: null
      };
    }

    try {
      const response = await this.sendCommand({ action: 'get_status' });

      return {
        isRunning: true,
        modelLoaded: response.model_loaded || false,
        currentModel: (response.current_model as TaggerModel) || null,
        currentDevice: response.device || null,
        lastUsedAt: this.lastUsedAt ? this.lastUsedAt.toISOString() : null
      };
    } catch (error) {
      console.error('[TaggerDaemon] Failed to get status:', error);
      return {
        isRunning: false,
        modelLoaded: false,
        currentModel: null,
        currentDevice: null,
        lastUsedAt: null
      };
    }
  }

  /**
   * Ensure daemon is started
   */
  private async ensureStarted(): Promise<void> {
    if (!this.isReady) {
      console.log('[TaggerDaemon] Daemon not running, starting...');
      try {
        await this.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[TaggerDaemon] Failed to start daemon:', message);
        throw new Error(`Failed to start tagger daemon: ${message}. Check Python installation and dependencies.`);
      }
    }
  }

  /**
   * Reset auto-unload timer
   */
  private resetAutoUnloadTimer(): void {
    this.clearAutoUnloadTimer();

    const settings = settingsService.loadSettings();

    if (settings.tagger.keepModelLoaded) {
      // 모델을 메모리에 계속 두는 설정이면 자동 언로드하지 않는다.
      return;
    }

    if (settings.tagger.autoUnloadMinutes > 0) {
      const timeoutMs = settings.tagger.autoUnloadMinutes * 60 * 1000;
      // console.log(`[TaggerDaemon] Setting auto-unload timer for ${settings.tagger.autoUnloadMinutes} minutes`);

      this.autoUnloadTimer = setTimeout(async () => {
        console.log('[TaggerDaemon] Auto-unload timer triggered');
        try {
          await this.unloadModel();
        } catch (error) {
          console.error('[TaggerDaemon] Auto-unload failed:', error);
        }
      }, timeoutMs);
    }
  }

  /**
   * Clear auto-unload timer
   */
  private clearAutoUnloadTimer(): void {
    if (this.autoUnloadTimer) {
      clearTimeout(this.autoUnloadTimer);
      this.autoUnloadTimer = null;
    }
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return this.isReady && this.process !== null;
  }
}

// Export singleton instance
export const taggerDaemon = new TaggerDaemon();
