/**
 * 프롬프트 그룹 관련 타입 정의
 */

export interface PromptGroupRecord {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface NegativePromptGroupRecord {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PromptGroupData {
  group_name: string;
  display_order?: number;
  is_visible?: boolean;
  parent_id?: number | null;
}

export interface PromptGroupWithPrompts {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  parent_id: number | null;
  prompt_count: number;
  created_at: string;
  updated_at: string;
}

export interface GroupReassignmentResult {
  success: boolean;
  reassigned_groups: { old_id: number; new_id: number; group_name: string }[];
  updated_prompts: number;
  message: string;
}

export interface GroupImportData {
  id?: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  parent_id: number | null;
}

export interface GroupExportData {
  groups: GroupImportData[];
  metadata: {
    export_date: string;
    total_groups: number;
    type: 'positive' | 'negative' | 'auto';
  };
}

export interface PromptItem {
  id: number;
  prompt: string;
  usage_count: number;
  synonyms?: string[];
}

export interface GroupedPrompts {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  parent_id: number | null;
  prompts: PromptItem[];
}

export interface GroupedPromptsResult {
  groups: GroupedPrompts[];
  unclassified_prompts: PromptItem[];
}

export interface PromptGroupResponse {
  success: boolean;
  data?: PromptGroupRecord | PromptGroupRecord[] | PromptGroupWithPrompts[] | GroupReassignmentResult | GroupExportData | GroupedPromptsResult | any;
  error?: string;
}