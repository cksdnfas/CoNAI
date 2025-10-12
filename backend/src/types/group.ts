export interface GroupRecord {
  id: number;
  name: string;
  description?: string;
  color?: string;
  parent_id?: number;
  created_date: string;
  updated_date: string;

  // 자동수집 관련 필드
  auto_collect_enabled: boolean;
  auto_collect_conditions?: string;
  auto_collect_last_run?: string;
}

export interface ImageGroupRecord {
  id: number;
  group_id: number;
  image_id: number;
  added_date: string;
  order_index: number;

  // 자동수집 구분 필드
  collection_type: 'manual' | 'auto';
  auto_collected_date?: string;
}

export interface AutoCollectCondition {
  type: 'prompt_contains' | 'prompt_regex' |
        'negative_prompt_contains' | 'negative_prompt_regex' |
        'ai_tool' | 'model_name' |
        // 오토태그 관련 조건
        'auto_tag_rating' | 'auto_tag_general' |
        'auto_tag_character' | 'auto_tag_model' |
        'auto_tag_has_character' | 'auto_tag_exists';
  value: string | number | boolean;
  case_sensitive?: boolean;

  // 오토태그용 추가 필드
  min_score?: number;  // 최소 점수 (0.0 ~ 1.0)
  max_score?: number;  // 최대 점수 (0.0 ~ 1.0)
  rating_type?: 'general' | 'sensitive' | 'questionable' | 'explicit';  // rating 조건용
}

export interface GroupCreateData {
  name: string;
  description?: string;
  color?: string;
  parent_id?: number;
  auto_collect_enabled?: boolean;
  auto_collect_conditions?: AutoCollectCondition[];
}

export interface GroupUpdateData {
  name?: string;
  description?: string;
  color?: string;
  parent_id?: number;
  auto_collect_enabled?: boolean;
  auto_collect_conditions?: AutoCollectCondition[];
}

export interface GroupWithStats extends GroupRecord {
  image_count: number;
  auto_collected_count: number;
  manual_added_count: number;
}

export interface GroupResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface AutoCollectResult {
  group_id: number;
  group_name: string;
  images_added: number;
  images_removed: number;
  execution_time: number;
}