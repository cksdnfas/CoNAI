import { Router, type Request, type Response } from 'express'
import { GraphWorkflowModel } from '../../models/GraphWorkflow'
import { GraphWorkflowScheduleService } from '../../services/graphWorkflowScheduleService'
import {
  buildGraphWorkflowBrowseContent,
  parseStoredGraphWorkflow,
} from '../../services/graphWorkflowViewService'
import { asyncHandler } from '../../middleware/errorHandler'
import { sendRouteBadRequest } from '../routeValidation'
import type {
  GraphWorkflowCreateData,
  GraphWorkflowUpdateData,
  ModuleGraphResponse,
} from '../../types/moduleGraph'
import {
  findGraphWorkflowFolderOrRespond,
  parseGraphRouteInteger,
} from './route-helpers'

export function createGraphWorkflowCrudRoutes() {
  const router = Router()

  router.get('/', asyncHandler(async (req: Request, res: Response) => {
    try {
      const activeOnly = req.query.active === 'true'
      const workflows = GraphWorkflowModel.findAll(activeOnly).map(parseStoredGraphWorkflow)
      return res.json({ success: true, data: workflows } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflows:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflows' } as ModuleGraphResponse)
    }
  }))

  router.get('/browse-content', asyncHandler(async (req: Request, res: Response) => {
    const folderIdParam = typeof req.query.folder_id === 'string' ? Number(req.query.folder_id) : null
    const folderId = folderIdParam !== null && Number.isFinite(folderIdParam) ? folderIdParam : null

    if (folderId !== null && !findGraphWorkflowFolderOrRespond(res, folderId)) {
      return
    }

    try {
      const includeOutputs = req.query.include_outputs !== 'false'
      return res.json({ success: true, data: buildGraphWorkflowBrowseContent(folderId, { includeOutputs }) } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow browse content:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow browse content' } as ModuleGraphResponse)
    }
  }))

  router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const workflow = GraphWorkflowModel.findById(id)
      if (!workflow) {
        return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
      }

      return res.json({ success: true, data: parseStoredGraphWorkflow(workflow) } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error getting graph workflow:', error)
      return res.status(500).json({ success: false, error: 'Failed to get graph workflow' } as ModuleGraphResponse)
    }
  }))

  router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const { name, description, graph, folder_id, version, is_active } = req.body
    if (!name || !graph) {
      return sendRouteBadRequest(res, 'name and graph are required')
    }

    try {
      const createData: GraphWorkflowCreateData = {
        name,
        description,
        graph,
        folder_id: typeof folder_id === 'number' ? folder_id : null,
        version,
        is_active,
      }

      const id = GraphWorkflowModel.create(createData)
      return res.status(201).json({ success: true, data: { id, message: 'Graph workflow created successfully' } } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error creating graph workflow:', error)
      return res.status(500).json({ success: false, error: 'Failed to create graph workflow' } as ModuleGraphResponse)
    }
  }))

  router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const existing = GraphWorkflowModel.findById(id)
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
      }

      const updateData: GraphWorkflowUpdateData = {
        name: req.body.name,
        description: req.body.description,
        graph: req.body.graph,
        folder_id: typeof req.body.folder_id === 'number' ? req.body.folder_id : req.body.folder_id === null ? null : undefined,
        version: req.body.version,
        is_active: req.body.is_active,
      }

      const updated = GraphWorkflowModel.update(id, updateData)
      const shouldPauseSchedulesForReview = Boolean(updateData.graph !== undefined || updateData.version !== undefined)
      const scheduleMaintenance = updated && shouldPauseSchedulesForReview
        ? GraphWorkflowScheduleService.pauseSchedulesForWorkflowChange(id)
        : null
      return res.json({
        success: updated,
        data: {
          id,
          message: updated ? 'Graph workflow updated successfully' : 'No changes applied',
          schedule_maintenance: scheduleMaintenance,
        },
      } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error updating graph workflow:', error)
      return res.status(500).json({ success: false, error: 'Failed to update graph workflow' } as ModuleGraphResponse)
    }
  }))

  router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseGraphRouteInteger(req.params.id)
    if (isNaN(id)) {
      return sendRouteBadRequest(res, 'Invalid graph workflow ID')
    }

    try {
      const scheduleMaintenance = GraphWorkflowScheduleService.deleteSchedulesForWorkflowDeletion(id)
      const deleted = GraphWorkflowModel.delete(id)
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Graph workflow not found' } as ModuleGraphResponse)
      }

      return res.json({
        success: true,
        data: {
          message: 'Graph workflow deleted successfully',
          schedule_maintenance: scheduleMaintenance,
        },
      } as ModuleGraphResponse)
    } catch (error) {
      console.error('Error deleting graph workflow:', error)
      return res.status(500).json({ success: false, error: 'Failed to delete graph workflow' } as ModuleGraphResponse)
    }
  }))

  return router
}
