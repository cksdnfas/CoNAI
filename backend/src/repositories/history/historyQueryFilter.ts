import type { GenerationHistoryFilterOptions } from '../../types/generationHistory';

export type HistoryFilterBinding = string | number;

export interface HistoryFilterBuildOptions {
  tableAlias?: string;
  /**
   * `GenerationHistoryModel.findAll({ ids })` historically ignored `ids` even
   * though the richer list surface accepted it. The compatibility facade keeps
   * that observable behavior deliberately until callers can migrate separately.
   */
  includeIds?: boolean;
}

export interface HistoryFilterClause {
  sql: string;
  params: HistoryFilterBinding[];
}

/** Build the shared WHERE suffix and binding order for history queries. */
export function buildHistoryFilterClause(
  filters: Omit<GenerationHistoryFilterOptions, 'limit' | 'offset'>,
  options: HistoryFilterBuildOptions = {},
): HistoryFilterClause {
  const prefix = options.tableAlias ? `${options.tableAlias}.` : '';
  const clauses: string[] = [];
  const params: HistoryFilterBinding[] = [];

  if (options.includeIds !== false && filters.ids && filters.ids.length > 0) {
    clauses.push(`${prefix}id IN (${filters.ids.map(() => '?').join(',')})`);
    params.push(...filters.ids);
  }

  if (filters.service_type) {
    clauses.push(`${prefix}service_type = ?`);
    params.push(filters.service_type);
  }

  if (filters.generation_status) {
    clauses.push(`${prefix}generation_status = ?`);
    params.push(filters.generation_status);
  }

  if (filters.workflow_id !== undefined) {
    clauses.push(`${prefix}workflow_id = ?`);
    params.push(filters.workflow_id);
  }

  if (filters.queue_job_id !== undefined) {
    clauses.push(`${prefix}queue_job_id = ?`);
    params.push(filters.queue_job_id);
  }

  if (filters.requested_by_account_id !== undefined) {
    clauses.push(`${prefix}requested_by_account_id = ?`);
    params.push(filters.requested_by_account_id);
  }

  if (filters.requested_by_account_type !== undefined) {
    clauses.push(`${prefix}requested_by_account_type = ?`);
    params.push(filters.requested_by_account_type);
  }

  if (filters.server_id !== undefined) {
    clauses.push(`${prefix}server_id = ?`);
    params.push(filters.server_id);
  }

  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params,
  };
}

/** Append the shared filter clause without changing existing caller-owned SQL. */
export function appendHistoryFilterConditions(
  sql: string,
  params: HistoryFilterBinding[],
  filters: Omit<GenerationHistoryFilterOptions, 'limit' | 'offset'>,
  options: HistoryFilterBuildOptions = {},
): string {
  const built = buildHistoryFilterClause(filters, options);
  params.push(...built.params);
  return sql + built.sql;
}
