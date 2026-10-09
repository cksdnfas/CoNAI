import { Router } from 'express'
import { createGraphWorkflowArtifactRoutes } from './graph-workflows/artifact-routes'
import { createGraphWorkflowCrudRoutes } from './graph-workflows/workflow-routes'
import { createGraphWorkflowExecutionRoutes } from './graph-workflows/execution-routes'
import { createGraphWorkflowFolderRoutes } from './graph-workflows/folder-routes'
import { createGraphWorkflowInputImageRoutes } from './graph-workflows/input-image-routes'
import { createGraphWorkflowNodeOptionRoutes } from './graph-workflows/node-option-routes'
import { createGraphWorkflowScheduleRoutes } from './graph-workflows/schedule-routes'

const router = Router()

router.use(createGraphWorkflowFolderRoutes())
router.use(createGraphWorkflowInputImageRoutes())
router.use(createGraphWorkflowNodeOptionRoutes())
router.use(createGraphWorkflowScheduleRoutes())
router.use(createGraphWorkflowExecutionRoutes())
router.use(createGraphWorkflowArtifactRoutes())
router.use(createGraphWorkflowCrudRoutes())

export const graphWorkflowRoutes = router
export default router
