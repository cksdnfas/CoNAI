import { Router, type Request, type Response } from 'express'
import {
  copyGraphWorkflowArtifactsToWatchedFolder,
  deleteGraphExecutionArtifacts,
  deleteGraphWorkflowArtifactsInScope,
} from '../../services/graphWorkflowOutputManagementService'
import { asyncHandler } from '../../middleware/errorHandler'
import { requireAdmin } from '../../middleware/authMiddleware'
import { sendRouteBadRequest } from '../routeValidation'
import type { ModuleGraphResponse } from '../../types/moduleGraph'

export function createGraphWorkflowArtifactRoutes() {
  const router = Router()

  router.post('/artifacts/copy-to-folder', asyncHandler(async (req: Request, res: Response) => {
    const folderId = Number(req.body?.folder_id)
    const sourcePaths: string[] = Array.isArray(req.body?.source_paths)
      ? Array.from(new Set<string>(req.body.source_paths
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0)))
      : []

    if (!Number.isFinite(folderId)) {
      return sendRouteBadRequest(res, 'folder_id is required')
    }

    if (sourcePaths.length === 0) {
      return sendRouteBadRequest(res, 'source_paths is required')
    }

    try {
      const copyResult = await copyGraphWorkflowArtifactsToWatchedFolder(folderId, sourcePaths)
      if (!copyResult) {
        return res.status(404).json({ success: false, error: 'Watched folder not found' } as ModuleGraphResponse)
      }

      return res.json({ success: true, data: copyResult } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error copying graph workflow artifacts to watched folder:', error)
      return res.status(500).json({ success: false, error: 'Failed to copy graph workflow artifacts to watched folder' } as ModuleGraphResponse)
    }
  }))

  router.post('/artifacts/delete', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const artifactIds: number[] = Array.isArray(req.body?.artifact_ids)
      ? Array.from(new Set<number>(req.body.artifact_ids
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value))))
      : []

    if (artifactIds.length === 0) {
      return sendRouteBadRequest(res, 'artifact_ids is required')
    }

    try {
      return res.json({ success: true, data: await deleteGraphExecutionArtifacts(artifactIds) } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error deleting graph workflow artifacts:', error)
      return res.status(500).json({ success: false, error: 'Failed to delete graph workflow artifacts' } as ModuleGraphResponse)
    }
  }))

  router.post('/artifacts/delete-scope', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const folderId = req.body?.folder_id === null || req.body?.folder_id === undefined
      ? null
      : Number(req.body.folder_id)
    const kind = req.body?.kind
    const artifactTypeFilter = typeof req.body?.artifact_type === 'string' ? req.body.artifact_type : null
    const searchTerm = typeof req.body?.search === 'string' ? req.body.search : null

    if (folderId !== null && !Number.isFinite(folderId)) {
      return sendRouteBadRequest(res, 'folder_id must be a number or null')
    }

    if (kind !== 'outputs' && kind !== 'artifacts') {
      return sendRouteBadRequest(res, 'kind must be outputs or artifacts')
    }

    try {
      return res.json({
        success: true,
        data: await deleteGraphWorkflowArtifactsInScope({
          folderId,
          kind,
          artifactTypeFilter,
          searchTerm,
        }),
      } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error deleting graph workflow artifacts in scope:', error)
      return res.status(500).json({ success: false, error: 'Failed to delete graph workflow artifacts in scope' } as ModuleGraphResponse)
    }
  }))

  return router
}
