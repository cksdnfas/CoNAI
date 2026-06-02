import { closeDatabase } from '../database/init';
import { GroupModel } from '../models/Group';
import { AutoCollectionService } from '../services/autoCollectionService';
import { AutoFolderGroupService } from '../services/autoFolderGroupService';
import {
  GroupRematchJobKind,
  GroupRematchJobService,
} from '../services/groupRematchJobService';

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function requireArg(name: string): string {
  const value = readArg(name);
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function parseKind(value: string): GroupRematchJobKind {
  if (value === 'group-auto-collect' || value === 'all-auto-collect' || value === 'auto-folder-rebuild') {
    return value;
  }
  throw new Error(`Unsupported group rematch job kind: ${value}`);
}

function parseGroupId(): number {
  const raw = requireArg('--group-id');
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid group id: ${raw}`);
  }
  return id;
}

async function runGroupAutoCollect(jobId: string): Promise<void> {
  const groupId = parseGroupId();
  GroupRematchJobService.markRunning(jobId, {
    total: 1,
    completed: 0,
    current_label: `group:${groupId}`,
  });

  const result = await AutoCollectionService.runAutoCollectionForGroup(groupId);
  GroupRematchJobService.markCompleted(jobId, result, {
    total: 1,
    completed: 1,
    current_label: result.group_name,
  });
}

async function runAllAutoCollect(jobId: string): Promise<void> {
  const groups = GroupModel.findAutoCollectEnabled();
  const results = [];

  GroupRematchJobService.markRunning(jobId, {
    total: groups.length,
    completed: 0,
    failed: 0,
    current_label: groups[0]?.name ?? null,
  });

  let completed = 0;
  let failed = 0;

  for (const group of groups) {
    try {
      GroupRematchJobService.markRunning(jobId, {
        total: groups.length,
        completed,
        failed,
        current_label: group.name,
      });

      const result = await AutoCollectionService.runAutoCollectionForGroup(group.id);
      results.push(result);
      completed++;
    } catch (error) {
      console.error(`Auto collection failed for group ${group.name} (${group.id}):`, error);
      results.push({
        group_id: group.id,
        group_name: group.name,
        images_added: 0,
        images_removed: 0,
        execution_time: 0,
      });
      failed++;
    }

    GroupRematchJobService.markRunning(jobId, {
      total: groups.length,
      completed,
      failed,
      current_label: group.name,
    });
  }

  const result = {
    results,
    total_groups: results.length,
    total_images_added: results.reduce((sum, item) => sum + item.images_added, 0),
    total_images_removed: results.reduce((sum, item) => sum + item.images_removed, 0),
  };

  GroupRematchJobService.markCompleted(jobId, result, {
    total: groups.length,
    completed,
    failed,
    current_label: null,
  });
}

async function runAutoFolderRebuild(jobId: string): Promise<void> {
  GroupRematchJobService.markRunning(jobId, {
    total: 1,
    completed: 0,
    current_label: 'auto-folder-rebuild',
  });

  const result = await AutoFolderGroupService.rebuildAllFolderGroups();
  if (!result.success) {
    throw new Error(result.error || 'Failed to rebuild auto-folder groups');
  }

  GroupRematchJobService.markCompleted(jobId, result, {
    total: 1,
    completed: 1,
    current_label: null,
  });
}

async function main(): Promise<void> {
  const jobId = requireArg('--job-id');
  const kind = parseKind(requireArg('--kind'));

  try {
    if (kind === 'group-auto-collect') {
      await runGroupAutoCollect(jobId);
      return;
    }

    if (kind === 'all-auto-collect') {
      await runAllAutoCollect(jobId);
      return;
    }

    await runAutoFolderRebuild(jobId);
  } catch (error) {
    GroupRematchJobService.markFailed(
      jobId,
      error instanceof Error ? error.message : 'Group rematch job failed'
    );
    throw error;
  } finally {
    closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
