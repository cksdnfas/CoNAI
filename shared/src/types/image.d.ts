export interface ImageRecord {
    composite_hash: string;
    first_seen_date: string;
    file_id: number | null;
    original_file_path: string | null;
    file_size: number | null;
    mime_type: string;
    file_status?: 'active' | 'deleted';
    file_type: 'image' | 'video' | 'animated';
    width: number | null;
    height: number | null;
    thumbnail_path: string;
    ai_tool: string | null;
    model_name: string | null;
    lora_models: string | null;
    steps: number | null;
    cfg_scale: number | null;
    sampler: string | null;
    seed: number | null;
    scheduler: string | null;
    prompt: string | null;
    negative_prompt: string | null;
    denoise_strength: number | null;
    generation_time: number | null;
    batch_size: number | null;
    batch_index: number | null;
    auto_tags: string | null;
    rating_score: number | null;
    perceptual_hash: string | null;
    dhash: string | null;
    ahash: string | null;
    color_histogram: string | null;
    duration: number | null;
    fps: number | null;
    video_codec: string | null;
    audio_codec: string | null;
    bitrate: number | null;
}
export interface ImageMetadata {
    [key: string]: any;
    ai_info?: {
        ai_tool?: string;
        model?: string;
        lora_models?: string[];
        steps?: number;
        cfg_scale?: number;
        sampler?: string;
        seed?: number;
        scheduler?: string;
        prompt?: string;
        negative_prompt?: string;
        denoise_strength?: number;
        generation_time?: number;
        batch_size?: number;
        batch_index?: number;
        controlnet?: string;
        style?: string;
        quality?: string;
    };
    extractedAt?: string;
    error?: string;
}
export type AITool = 'ComfyUI' | 'NovelAI' | 'Stable Diffusion' | 'Automatic1111' | 'InvokeAI' | 'Midjourney' | 'DALL-E' | 'Unknown';
export interface LoRAModel {
    name: string;
    strength?: number;
    version?: string;
}
export interface UploadResponse {
    success: boolean;
    data?: {
        composite_hash: string;
        original_file_path: string;
        thumbnail_url: string;
        file_size: number;
        mime_type: string;
        width: number | null;
        height: number | null;
        first_seen_date: string;
    };
    error?: string;
}
export interface ImageListResponse {
    success: boolean;
    data?: {
        images: ImageRecord[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
    error?: string;
}
export type UploadProgressEventType = 'start' | 'processing' | 'stage' | 'complete' | 'error';
export type UploadStage = 'upload' | 'metadata' | 'thumbnail' | 'auto-collect' | 'auto-tag';
export interface UploadProgressEvent {
    type: UploadProgressEventType;
    currentFile: number;
    totalFiles: number;
    filename: string;
    stage?: UploadStage;
    message?: string;
    compositeHash?: string;
    error?: string;
    timestamp: string;
}
//# sourceMappingURL=image.d.ts.map