export type ServiceType = 'comfyui' | 'novelai';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';
export interface GenerationHistoryRecord {
    id: number;
    service_type: ServiceType;
    generation_status: GenerationStatus;
    created_at: string;
    completed_at?: string;
    comfyui_workflow?: string;
    comfyui_prompt_id?: string;
    workflow_id?: number;
    workflow_name?: string;
    nai_model?: string;
    nai_sampler?: string;
    nai_seed?: number;
    nai_steps?: number;
    nai_scale?: number;
    nai_parameters?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    width?: number;
    height?: number;
    original_path?: string;
    file_size?: number;
    composite_hash?: string;
    error_message?: string;
    metadata?: string;
}
export interface GenerationHistoryFilters {
    service_type?: ServiceType;
    generation_status?: GenerationStatus;
    workflow_id?: number;
    limit?: number;
    offset?: number;
}
export interface GenerationHistoryResponse {
    success: boolean;
    records: GenerationHistoryRecord[];
    total: number;
    limit?: number;
    offset?: number;
}
export interface GenerationHistoryStatistics {
    total: number;
    comfyui: number;
    novelai: number;
    completed: number;
    failed: number;
    pending: number;
}
export interface CreateComfyUIHistoryRequest {
    workflow: object;
    workflowId: number;
    workflowName: string;
    promptId: string;
    positivePrompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    metadata?: object;
}
export interface CreateNAIHistoryRequest {
    model: string;
    sampler: string;
    seed: number;
    steps: number;
    scale: number;
    parameters: object;
    positivePrompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    metadata?: object;
}
//# sourceMappingURL=generationHistory.d.ts.map