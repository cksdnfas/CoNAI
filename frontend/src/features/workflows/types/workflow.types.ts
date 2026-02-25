export interface ServerGenerationStatus {
  status: 'idle' | 'generating' | 'completed' | 'failed'
  historyId?: number
  progress?: number
  imageId?: number
  generatedImage?: unknown
  error?: string
  executionTime?: number
}

export interface ServerRepeatState {
  isRunning: boolean
  currentIteration: number
  totalIterations: number
  timeoutId: number | null
}

export interface ServerConnectionStatus {
  connected: boolean
  responseTime?: number
  error?: string
}
