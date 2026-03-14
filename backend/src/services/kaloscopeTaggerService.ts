import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { runtimePaths } from '../config/runtimePaths';
import { settingsService } from './settingsService';
import { KaloscopeResult } from './autoTagsComposeService';
import { KaloscopeSettings } from '../types/settings';

interface KaloscopeServiceOptions {
  topk?: number;
}

interface KaloscopeDependencyStatus {
  available: boolean;
  missingPackages: string[];
  message: string;
  installCommand?: string;
}

export class KaloscopeTaggerService {
  private readonly scriptPath: string;

  constructor() {
    this.scriptPath = path.join(__dirname, '..', '..', 'python', 'kaloscope_tagger.py');
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

  async checkDependencies(): Promise<KaloscopeDependencyStatus> {
    const pythonPath = this.getPythonPath();
    const requirementsPath = path.join(path.dirname(this.scriptPath), 'requirements.txt');
    const installCommand = `"${pythonPath}" -m pip install -r "${requirementsPath}"`;

    return await new Promise<KaloscopeDependencyStatus>((resolve) => {
      const child = spawn(pythonPath, ['-c', 'import importlib.util; import json; mods=["onnxruntime","numpy","PIL","huggingface_hub"]; missing=[m for m in mods if importlib.util.find_spec(m) is None]; print(json.dumps({"missing": missing}))'], {
        cwd: path.dirname(this.scriptPath),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8'
        }
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

  async tagImage(imagePath: string, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: 'Kaloscope integration disabled by KALOSCOPE_ENABLED',
        error_type: 'Disabled'
      };
    }

    if (!fs.existsSync(this.scriptPath)) {
      return {
        success: false,
        error: `Kaloscope script not found: ${this.scriptPath}`,
        error_type: 'ScriptNotFound'
      };
    }

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        error: `Image not found: ${imagePath}`,
        error_type: 'FileNotFound'
      };
    }

    const dependencyStatus = await this.checkDependencies();
    if (!dependencyStatus.available) {
      return {
        success: false,
        error: `${dependencyStatus.message}${dependencyStatus.installCommand ? `\n해결: ${dependencyStatus.installCommand}` : ''}`,
        error_type: 'MissingDependency'
      };
    }

    const pythonPath = this.getPythonPath();
    const kaloscopeSettings = this.getKaloscopeSettings();
    const args = [
      this.scriptPath,
      '--image', imagePath,
      '--repo', this.getModelRepo(),
      '--model-file', this.getModelFile(),
      '--topk', String(options?.topk || kaloscopeSettings.topK),
      '--device', kaloscopeSettings.device,
      '--cache-dir', runtimePaths.modelsDir
    ];

    return await new Promise<KaloscopeResult>((resolve) => {
      const child = spawn(pythonPath, args, {
        cwd: path.dirname(this.scriptPath),
        env: {
          ...process.env,
          HF_HOME: runtimePaths.modelsDir,
          HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
          TRANSFORMERS_CACHE: runtimePaths.modelsDir,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8'
        }
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      child.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
          error_type: 'SpawnError'
        });
      });

      child.on('close', (code) => {
        const raw = stdout.trim();
        if (!raw) {
          resolve({
            success: false,
            error: stderr.trim() || `Kaloscope exited with code ${code}`,
            error_type: 'EmptyOutput'
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
            error_type: 'ParseError'
          });
        }
      });
    });
  }
}

export const kaloscopeTaggerService = new KaloscopeTaggerService();
