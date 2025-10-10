import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

export interface TaggerConfig {
  modelName: 'vit' | 'swinv2' | 'convnext';
  generalThreshold: number;
  characterThreshold: number;
  pythonPath: string;
  timeout: number; // milliseconds
}

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

export class ImageTaggerService {
  private config: TaggerConfig;
  private scriptPath: string;

  constructor(config?: Partial<TaggerConfig>) {
    this.config = {
      modelName: config?.modelName || (process.env.TAGGER_MODEL as any) || 'vit',
      generalThreshold: config?.generalThreshold || parseFloat(process.env.TAGGER_GEN_THRESHOLD || '0.35'),
      characterThreshold: config?.characterThreshold || parseFloat(process.env.TAGGER_CHAR_THRESHOLD || '0.75'),
      pythonPath: config?.pythonPath || process.env.PYTHON_PATH || 'python',
      timeout: config?.timeout || 120000 // 2 minutes default
    };

    // Python script path - handle both development and portable builds
    const possiblePaths = [
      // Development: backend/src/services -> backend/python
      path.join(__dirname, '..', '..', 'python', 'wdv3_tagger.py'),
      // Compiled: backend/dist/services -> backend/python
      path.join(__dirname, '..', '..', '..', 'python', 'wdv3_tagger.py'),
      // Portable build: dist/services -> app/python
      path.join(__dirname, '..', 'python', 'wdv3_tagger.py'),
      // Bundle build: relative to process.cwd()
      path.join(process.cwd(), 'app', 'python', 'wdv3_tagger.py')
    ];

    // Find first existing path
    this.scriptPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];

    console.log('[ImageTagger] Script path:', this.scriptPath);
    console.log('[ImageTagger] Script exists:', fs.existsSync(this.scriptPath));
  }

  /**
   * Check if Python and required packages are available
   */
  async checkPythonDependencies(): Promise<{ available: boolean; message: string }> {
    return new Promise((resolve) => {
      const checkScript = `
import sys
try:
    import torch
    import timm
    import huggingface_hub
    import PIL
    import pandas
    import numpy
    print("OK")
except ImportError as e:
    print(f"MISSING:{e}")
    sys.exit(1)
`;

      const pythonProcess = spawn(this.config.pythonPath, ['-c', checkScript]);
      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0 && output.includes('OK')) {
          resolve({
            available: true,
            message: 'All Python dependencies are available'
          });
        } else {
          resolve({
            available: false,
            message: `Missing Python dependencies: ${errorOutput || output}`
          });
        }
      });

      pythonProcess.on('error', (error) => {
        resolve({
          available: false,
          message: `Python not found or error: ${error.message}`
        });
      });
    });
  }

  /**
   * Tag a single image
   */
  async tagImage(imagePath: string): Promise<TaggerResult> {
    return new Promise((resolve, reject) => {
      const args = [
        this.scriptPath,
        imagePath,
        this.config.modelName,
        this.config.generalThreshold.toString(),
        this.config.characterThreshold.toString(),
        runtimePaths.modelsDir
      ];

      console.log(`[ImageTagger] Running: ${this.config.pythonPath} ${args.join(' ')}`);
      console.log(`[ImageTagger] Models directory: ${runtimePaths.modelsDir}`);

      const pythonProcess = spawn(this.config.pythonPath, args, {
        cwd: path.dirname(this.scriptPath),
        env: {
          ...process.env,
          HF_HOME: runtimePaths.modelsDir,
          HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
          TRANSFORMERS_CACHE: runtimePaths.modelsDir
        }
      });

      let stdoutData = '';
      let stderrData = '';
      let timedOut = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        pythonProcess.kill('SIGTERM');
        reject(new Error(`Tagging timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      pythonProcess.on('close', (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          return; // Already rejected
        }

        if (code !== 0) {
          console.error('[ImageTagger] Process exited with code:', code);
          console.error('[ImageTagger] stderr:', stderrData);
          resolve({
            success: false,
            error: `Python process exited with code ${code}: ${stderrData}`,
            error_type: 'ProcessError'
          });
          return;
        }

        try {
          // Parse JSON output
          console.log('[ImageTagger] Raw stdout length:', stdoutData.length);
          console.log('[ImageTagger] Raw stdout preview:', stdoutData.substring(0, 200));

          const result: TaggerResult = JSON.parse(stdoutData);

          console.log('[ImageTagger] Parsed result success:', result.success);
          console.log('[ImageTagger] Parsed result has caption:', !!result.caption);
          console.log('[ImageTagger] Parsed result has general tags:', !!result.general);

          resolve(result);
        } catch (error) {
          console.error('[ImageTagger] Failed to parse JSON:', stdoutData);
          console.error('[ImageTagger] stderr:', stderrData);
          const message = error instanceof Error ? error.message : 'Unknown error';
          resolve({
            success: false,
            error: `Failed to parse tagging result: ${message}`,
            error_type: 'ParseError'
          });
        }
      });

      pythonProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        console.error('[ImageTagger] Process error:', error);
        resolve({
          success: false,
          error: `Failed to start Python process: ${error.message}`,
          error_type: 'SpawnError'
        });
      });
    });
  }

  /**
   * Tag multiple images in batch
   */
  async tagImageBatch(imagePaths: string[]): Promise<TaggerResult[]> {
    const results: TaggerResult[] = [];

    // Process sequentially to avoid resource exhaustion
    for (const imagePath of imagePaths) {
      try {
        const result = await this.tagImage(imagePath);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          success: false,
          error: message,
          error_type: 'BatchError'
        });
      }
    }

    return results;
  }

  /**
   * Convert TaggerResult to database-compatible format
   */
  static formatForDatabase(result: TaggerResult): string | null {
    if (!result.success) {
      return null;
    }

    const formatted = {
      caption: result.caption || '',
      taglist: result.taglist || '',
      rating: result.rating || {},
      general: result.general || {},
      character: result.character || {},
      model: result.model || 'unknown',
      thresholds: result.thresholds || { general: 0.35, character: 0.75 },
      tagged_at: new Date().toISOString()
    };

    return JSON.stringify(formatted);
  }

  /**
   * Get model information
   */
  getModelInfo(): { model: string; thresholds: { general: number; character: number } } {
    return {
      model: this.config.modelName,
      thresholds: {
        general: this.config.generalThreshold,
        character: this.config.characterThreshold
      }
    };
  }
}

// Export singleton instance with default config
export const imageTaggerService = new ImageTaggerService();
