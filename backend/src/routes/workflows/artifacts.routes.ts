import { Router, Request, Response } from 'express'
import AdmZip from 'adm-zip'
import fs from 'fs'
import path from 'path'
import { routeParam } from '../routeParam'
import { WorkflowModel } from '../../models/Workflow'
import { asyncHandler } from '../../middleware/errorHandler'
import { listWorkflowArtifacts, resolveWorkflowArtifactPath } from '../../services/workflowArtifactService'
import { WorkflowResponse } from '../../types/workflow'

const router = Router()

function parseWorkflowId(req: Request) {
  const id = parseInt(routeParam(routeParam(req.params.id)))
  return Number.isFinite(id) ? id : null
}

function loadArtifactWorkflow(req: Request, res: Response) {
  const id = parseWorkflowId(req)
  if (id === null) {
    res.status(400).json({ success: false, error: 'Invalid workflow ID' } as WorkflowResponse)
    return null
  }

  const workflow = WorkflowModel.findById(id)
  if (!workflow) {
    res.status(404).json({ success: false, error: 'Workflow not found' } as WorkflowResponse)
    return null
  }

  if (workflow.result_view_mode !== 'artifact_explorer') {
    res.status(400).json({ success: false, error: 'Workflow is not configured for artifact explorer results' } as WorkflowResponse)
    return null
  }

  return workflow
}

router.get('/:id/artifacts', asyncHandler(async (req: Request, res: Response) => {
  const workflow = loadArtifactWorkflow(req, res)
  if (!workflow) {
    return
  }

  try {
    const listing = await listWorkflowArtifacts(workflow, typeof req.query.path === 'string' ? req.query.path : '')
    return res.json({
      success: true,
      data: {
        workflowId: workflow.id,
        resultViewMode: workflow.result_view_mode,
        artifactDirectoryMode: workflow.artifact_directory_mode,
        relativePath: listing.relativePath,
        entries: listing.entries,
      },
    } as WorkflowResponse)
  } catch (error) {
    console.error('Error listing workflow artifacts:', error)
    return res.status(400).json({ success: false, error: 'Failed to list workflow artifacts' } as WorkflowResponse)
  }
}))

function contentDispositionValue(disposition: 'inline' | 'attachment', fileName: string) {
  return `${disposition}; filename="${fileName.replace(/"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

router.get('/:id/artifacts/archive', asyncHandler(async (req: Request, res: Response) => {
  const workflow = loadArtifactWorkflow(req, res)
  if (!workflow) {
    return
  }

  if (typeof req.query.path !== 'string' || req.query.path.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Artifact directory path is required' } as WorkflowResponse)
  }

  try {
    const resolved = resolveWorkflowArtifactPath(workflow, req.query.path)
    const stat = await fs.promises.stat(resolved.target)
    if (!stat.isDirectory()) {
      return res.status(404).json({ success: false, error: 'Artifact directory not found' } as WorkflowResponse)
    }

    const archiveName = `${path.basename(resolved.target) || 'artifacts'}.zip`
    const zip = new AdmZip()
    zip.addLocalFolder(resolved.target, path.basename(resolved.target) || 'artifacts')
    const archiveBuffer = zip.toBuffer()

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', contentDispositionValue('attachment', archiveName))
    res.setHeader('Content-Length', archiveBuffer.length)
    return res.send(archiveBuffer)
  } catch (error) {
    console.error('Error archiving workflow artifacts:', error)
    return res.status(404).json({ success: false, error: 'Artifact directory not found' } as WorkflowResponse)
  }
}))

router.get('/:id/artifacts/file', asyncHandler(async (req: Request, res: Response) => {
  const workflow = loadArtifactWorkflow(req, res)
  if (!workflow) {
    return
  }

  if (typeof req.query.path !== 'string' || req.query.path.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Artifact file path is required' } as WorkflowResponse)
  }

  try {
    const resolved = resolveWorkflowArtifactPath(workflow, req.query.path)
    const stat = await fs.promises.stat(resolved.target)
    if (!stat.isFile()) {
      return res.status(404).json({ success: false, error: 'Artifact file not found' } as WorkflowResponse)
    }

    const fileName = path.basename(resolved.target)
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', contentDispositionValue('attachment', fileName))
      return res.sendFile(resolved.target)
    }

    res.setHeader('Content-Disposition', contentDispositionValue('inline', fileName))
    return res.sendFile(resolved.target)
  } catch (error) {
    console.error('Error serving workflow artifact:', error)
    return res.status(404).json({ success: false, error: 'Artifact file not found' } as WorkflowResponse)
  }
}))

export default router
