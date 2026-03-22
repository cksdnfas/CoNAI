import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { WildcardService } from '../services/wildcardService';
import { WildcardCreateData } from '../models/Wildcard';
import { routeParam } from './routeParam';

const router = Router();

router.post('/parse', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { text, tool, count = 1 } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    if (!tool || (tool !== 'comfyui' && tool !== 'nai')) {
      return res.status(400).json({ success: false, error: 'Valid tool is required (comfyui or nai)' });
    }

    const parsedCount = Math.min(Math.max(parseInt(count) || 1, 1), 10);
    const results = WildcardService.parseMultiple(text, tool, parsedCount);

    return res.json({
      success: true,
      data: {
        original: text,
        results,
        usedWildcards: WildcardService.extractWildcardNames(text)
      }
    });
  } catch (error) {
    console.error('Error parsing wildcards:', error);
    return res.status(500).json({ success: false, error: 'Failed to parse wildcards' });
  }
}));

router.post('/scan-lora-folder', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { loraFiles, loraWeight = 1.0, duplicateHandling = 'number' } = req.body;

    if (!Array.isArray(loraFiles) || loraFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'LORA files array is required' });
    }

    if (typeof loraWeight !== 'number' || loraWeight < 0.1 || loraWeight > 2.0) {
      return res.status(400).json({ success: false, error: 'Invalid lora weight (must be between 0.1 and 2.0)' });
    }

    if (duplicateHandling !== 'number' && duplicateHandling !== 'parent') {
      return res.status(400).json({ success: false, error: 'Invalid duplicate handling method' });
    }

    const db = (await import('../database/userSettingsDb')).getUserSettingsDb();
    const { WildcardModel } = await import('../models/Wildcard');
    db.prepare('DELETE FROM wildcards WHERE is_auto_collected = 1').run();

    interface LoraFileData {
      folderName: string;
      loraName: string;
      promptLines: string[];
    }

    interface FolderGroup {
      folderName: string;
      displayName: string;
      loras: LoraFileData[];
      level: number;
      pathParts: string[];
    }

    const folderMap = new Map<string, LoraFileData[]>();

    for (const file of loraFiles as LoraFileData[]) {
      if (!folderMap.has(file.folderName)) {
        folderMap.set(file.folderName, []);
      }
      folderMap.get(file.folderName)!.push(file);
    }

    const leafFolders: FolderGroup[] = Array.from(folderMap.entries()).map(([folderName, loras]) => ({
      folderName,
      displayName: folderName.split('/').pop() || folderName,
      loras,
      level: 1,
      pathParts: folderName.split('/')
    }));

    const parentFoldersSet = new Set<string>();
    const maxDepth = Math.max(...leafFolders.map(f => f.pathParts.length));

    for (const folder of leafFolders) {
      const parts = folder.pathParts;
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join('/');
        parentFoldersSet.add(parentPath);
      }
    }

    const parentFolders: FolderGroup[] = Array.from(parentFoldersSet).map(parentPath => {
      const parts = parentPath.split('/');
      const level = maxDepth - parts.length + 1;

      return {
        folderName: parentPath,
        displayName: parts[parts.length - 1],
        loras: [],
        level,
        pathParts: parts
      };
    });

    const allFolders = [...leafFolders, ...parentFolders].sort((a, b) => a.level - b.level);
    const createdWildcards: any[] = [];
    const usedNames = new Set<string>();
    const pathToWildcardId = new Map<string, number>();
    const levelCounters = new Map<number, number>();

    for (const folder of allFolders) {
      let wildcardName = folder.displayName;

      if (usedNames.has(wildcardName)) {
        if (duplicateHandling === 'number') {
          let counter = 2;
          while (usedNames.has(`${wildcardName}_${counter}`)) {
            counter++;
          }
          wildcardName = `${wildcardName}_${counter}`;
        } else {
          const parts = folder.pathParts;
          if (parts.length > 1) {
            wildcardName = parts[parts.length - 2] + '_' + wildcardName;
          }
          if (usedNames.has(wildcardName)) {
            let counter = 2;
            while (usedNames.has(`${wildcardName}_${counter}`)) {
              counter++;
            }
            wildcardName = `${wildcardName}_${counter}`;
          }
        }
      }

      usedNames.add(wildcardName);
      const parentPath = folder.pathParts.length > 1 ? folder.pathParts.slice(0, -1).join('/') : null;
      const currentCounter = (levelCounters.get(folder.level) || 0) + 1;
      levelCounters.set(folder.level, currentCounter);
      const customId = folder.level * 100000 + currentCounter;

      const items: string[] = [];

      if (folder.level === 1) {
        for (const lora of folder.loras) {
          const loraTag = `<lora:${lora.loraName}:${loraWeight}>`;
          if (lora.promptLines && lora.promptLines.length > 0) {
            for (const line of lora.promptLines) {
              if (line.trim()) {
                items.push(`${loraTag}, ${line.trim()}`);
              }
            }
          } else {
            items.push(loraTag);
          }
        }
      }

      const wildcardData: WildcardCreateData = {
        name: wildcardName,
        description: `Auto-generated from ${folder.folderName}`,
        items: {
          comfyui: items.map(content => ({ content, weight: 1.0 })),
          nai: []
        },
        customId,
        parent_id: null,
        include_children: 1
      };

      const wildcard = WildcardModel.create(wildcardData);
      pathToWildcardId.set(folder.folderName, wildcard.id);

      db.prepare(`
        UPDATE wildcards
        SET is_auto_collected = 1, source_path = NULL, lora_weight = ?
        WHERE id = ?
      `).run(loraWeight, wildcard.id);

      createdWildcards.push({
        id: wildcard.id,
        name: wildcardName,
        itemCount: items.length,
        folderName: folder.folderName,
        level: folder.level,
        parentPath
      });
    }

    for (const created of createdWildcards) {
      if (created.parentPath) {
        const parentId = pathToWildcardId.get(created.parentPath);
        if (parentId) {
          db.prepare('UPDATE wildcards SET parent_id = ? WHERE id = ?').run(parentId, created.id);
        }
      }
    }

    db.prepare('DELETE FROM user_preferences WHERE key = ?').run('last_lora_scan_log');

    const scanLog = {
      timestamp: new Date().toISOString(),
      loraWeight,
      duplicateHandling,
      totalWildcards: createdWildcards.length,
      totalItems: createdWildcards.reduce((sum, wc) => sum + wc.itemCount, 0),
      wildcards: createdWildcards
    };

    db.prepare('INSERT INTO user_preferences (key, value) VALUES (?, ?)').run(
      'last_lora_scan_log',
      JSON.stringify(scanLog)
    );

    return res.json({
      success: true,
      data: {
        created: createdWildcards.length,
        log: scanLog
      }
    });
  } catch (error) {
    console.error('Error scanning LORA folder:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to scan LORA folder: ${(error as Error).message}`
    });
  }
}));

export { router as wildcardUtilityRoutes };
