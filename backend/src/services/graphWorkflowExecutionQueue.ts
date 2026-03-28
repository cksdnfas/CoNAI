import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphWorkflowExecutor } from './graphWorkflowExecutor'
import { writeExecutionLog } from './graph-workflow-executor/shared'

type QueuedExecutionJob = {
  executionId: number
  workflowId: number
  inputValues?: Record<string, unknown>
}

type CancelExecutionResult = {
  success: boolean
  status?: 'draft' | 'queued' | 'running' | 'cancelled' | 'completed' | 'failed' | 'not_found'
  message: string
}

/** Manage graph workflow executions through a simple in-memory background queue. */
export class GraphWorkflowExecutionQueue {
  private static queue: QueuedExecutionJob[] = []
  private static runningExecutionId: number | null = null
  private static cancelRequestedExecutionIds = new Set<number>()

  /** Enqueue a workflow execution and start the worker if idle. */
  static enqueue(workflowId: number, inputValues?: Record<string, unknown>) {
    const workflow = GraphWorkflowModel.findById(workflowId)
    if (!workflow) {
      throw new Error('Graph workflow not found')
    }

    const executionId = GraphExecutionModel.create({
      graph_workflow_id: workflow.id,
      graph_version: workflow.version,
      status: 'queued',
      execution_plan: null,
      started_at: null,
    })

    writeExecutionLog({
      executionId,
      eventType: 'execution_queued',
      message: `Graph execution queued: ${workflow.name}`,
      details: {
        workflowId: workflow.id,
        version: workflow.version,
        inputKeys: Object.keys(inputValues ?? {}),
      },
    })

    this.queue.push({ executionId, workflowId, inputValues })
    void this.processNext()

    return {
      executionId,
      status: 'queued' as const,
    }
  }

  /** Request cancellation for a queued or running execution. */
  static cancel(executionId: number): CancelExecutionResult {
    const execution = GraphExecutionModel.findById(executionId)
    if (!execution) {
      return {
        success: false,
        status: 'not_found',
        message: 'Execution not found',
      }
    }

    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
      return {
        success: false,
        status: execution.status,
        message: `Execution is already ${execution.status}`,
      }
    }

    const queuedIndex = this.queue.findIndex((job) => job.executionId === executionId)
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1)
      GraphExecutionModel.updateStatus(executionId, 'cancelled')
      writeExecutionLog({
        executionId,
        eventType: 'execution_cancelled',
        message: 'Queued execution cancelled before start',
      })
      return {
        success: true,
        status: 'cancelled',
        message: 'Queued execution cancelled',
      }
    }

    if (this.runningExecutionId === executionId) {
      this.cancelRequestedExecutionIds.add(executionId)
      writeExecutionLog({
        executionId,
        level: 'warn',
        eventType: 'execution_cancel_requested',
        message: 'Cancellation requested for running execution',
      })
      return {
        success: true,
        status: 'running',
        message: 'Cancellation requested',
      }
    }

    return {
      success: false,
      status: execution.status,
      message: `Execution is already ${execution.status}`,
    }
  }

  /** Read runtime queue metadata for an execution row. */
  static getExecutionRuntimeState(executionId: number) {
    const queuedIndex = this.queue.findIndex((job) => job.executionId === executionId)
    return {
      queue_position: queuedIndex !== -1 ? queuedIndex + 1 : null,
      cancel_requested: this.cancelRequestedExecutionIds.has(executionId),
    }
  }

  /** Check whether an execution has a pending cancellation request. */
  static isCancellationRequested(executionId: number) {
    return this.cancelRequestedExecutionIds.has(executionId)
  }

  /** Start the next queued execution when no job is running. */
  private static async processNext() {
    if (this.runningExecutionId !== null) {
      return
    }

    const nextJob = this.queue.shift()
    if (!nextJob) {
      return
    }

    this.runningExecutionId = nextJob.executionId

    try {
      GraphExecutionModel.updateStatus(nextJob.executionId, 'running')
      await GraphWorkflowExecutor.execute(nextJob.workflowId, {
        executionId: nextJob.executionId,
        runtimeInputValues: nextJob.inputValues,
        shouldCancel: () => this.cancelRequestedExecutionIds.has(nextJob.executionId),
      })
    } catch (error) {
      console.error('Background graph execution failed:', error)
    } finally {
      this.cancelRequestedExecutionIds.delete(nextJob.executionId)
      this.runningExecutionId = null
      void this.processNext()
    }
  }
}
