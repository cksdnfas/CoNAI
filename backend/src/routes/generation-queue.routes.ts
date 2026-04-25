import express from 'express'
import { createGenerationQueueActionRoutes } from './generation-queue/queue-action-routes'
import { createGenerationQueueReadRoutes } from './generation-queue/queue-read-routes'

const router = express.Router()

router.use(createGenerationQueueReadRoutes())
router.use(createGenerationQueueActionRoutes())

export default router
