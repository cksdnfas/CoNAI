import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner';
import { runLegacyAudioImport, type LegacyImportParams, type LegacyImportResult } from './audioLegacyImport';

/** One import at a time (admin only): reads the old SFX manager's data dir and adds what is new to audio.db. */

async function runLegacyImportJob(ctx: RuntimeJobContext<LegacyImportParams>): Promise<LegacyImportResult> {
  const result = await runLegacyAudioImport(ctx.params, {
    progress: (processed, total) => ctx.report({ processed, total }),
    phase: (phase) => ctx.flush({ phase }),
    throwIfCancelled: () => ctx.throwIfCancelled(),
    yield: () => ctx.yield(),
  });
  for (const warning of result.warnings.slice(0, 10)) ctx.recordWarning(warning);
  return result;
}

export function registerAudioLegacyImportJobHandlers(): void {
  RuntimeJobRunner.register<LegacyImportParams, LegacyImportResult>({
    kind: 'audio-legacy-import',
    singletonKey: () => 'audio-legacy-import',
    handler: runLegacyImportJob,
  });
}

