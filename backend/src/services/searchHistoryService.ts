import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

export type SearchChipScope = 'positive' | 'negative' | 'auto' | 'rating';
export type SearchChipOperator = 'OR' | 'AND' | 'NOT';

export interface SearchHistoryChip {
  id: string;
  scope: SearchChipScope;
  operator: SearchChipOperator;
  label: string;
  value: string;
  minScore?: number;
  maxScore?: number | null;
  color?: string | null;
}

export interface SearchHistoryEntry {
  id: string;
  label: string;
  chips: SearchHistoryChip[];
  queryKey: string;
  createdAt: string;
  updatedAt: string;
}

interface SearchHistoryStore {
  entries: SearchHistoryEntry[];
}

const SEARCH_HISTORY_FILE_PATH = path.join(runtimePaths.databaseDir, 'search-history.json');
const MAX_SEARCH_HISTORY_ENTRIES = 50;

/** SearchHistoryService manages persisted gallery search history in a JSON file. */
export class SearchHistoryService {
  /** Ensure the history file exists before read/write operations. */
  private static ensureHistoryFile(): void {
    if (!fs.existsSync(runtimePaths.databaseDir)) {
      fs.mkdirSync(runtimePaths.databaseDir, { recursive: true });
    }

    if (!fs.existsSync(SEARCH_HISTORY_FILE_PATH)) {
      fs.writeFileSync(SEARCH_HISTORY_FILE_PATH, JSON.stringify({ entries: [] }, null, 2), 'utf-8');
    }
  }

  /** Load the history store from disk and recover safely from malformed JSON. */
  private static readStore(): SearchHistoryStore {
    this.ensureHistoryFile();

    try {
      const content = fs.readFileSync(SEARCH_HISTORY_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content) as Partial<SearchHistoryStore>;
      const entries = Array.isArray(parsed.entries) ? parsed.entries.filter((entry) => this.isValidEntry(entry)) : [];
      return { entries };
    } catch (error) {
      console.warn('[SearchHistoryService] Failed to read search history file. Resetting store.', error);
      const emptyStore: SearchHistoryStore = { entries: [] };
      fs.writeFileSync(SEARCH_HISTORY_FILE_PATH, JSON.stringify(emptyStore, null, 2), 'utf-8');
      return emptyStore;
    }
  }

  /** Persist the full history store to disk. */
  private static writeStore(store: SearchHistoryStore): void {
    this.ensureHistoryFile();
    fs.writeFileSync(SEARCH_HISTORY_FILE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  }

  /** Validate a single search history chip. */
  private static isValidChip(value: unknown): value is SearchHistoryChip {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const chip = value as Partial<SearchHistoryChip>;
    const validScopes: SearchChipScope[] = ['positive', 'negative', 'auto', 'rating'];
    const validOperators: SearchChipOperator[] = ['OR', 'AND', 'NOT'];

    return typeof chip.id === 'string'
      && validScopes.includes(chip.scope as SearchChipScope)
      && validOperators.includes(chip.operator as SearchChipOperator)
      && typeof chip.label === 'string'
      && typeof chip.value === 'string'
      && (chip.minScore === undefined || typeof chip.minScore === 'number')
      && (chip.maxScore === undefined || chip.maxScore === null || typeof chip.maxScore === 'number')
      && (chip.color === undefined || chip.color === null || typeof chip.color === 'string');
  }

  /** Validate a persisted history entry. */
  private static isValidEntry(value: unknown): value is SearchHistoryEntry {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const entry = value as Partial<SearchHistoryEntry>;
    return typeof entry.id === 'string'
      && typeof entry.label === 'string'
      && typeof entry.queryKey === 'string'
      && typeof entry.createdAt === 'string'
      && typeof entry.updatedAt === 'string'
      && Array.isArray(entry.chips)
      && entry.chips.every((chip) => this.isValidChip(chip));
  }

  /** Create a stable search key for deduping equivalent chip combinations. */
  private static buildQueryKey(chips: SearchHistoryChip[]): string {
    return JSON.stringify(
      chips.map((chip) => ({
        scope: chip.scope,
        operator: chip.operator,
        value: chip.value,
        minScore: chip.minScore ?? null,
        maxScore: chip.maxScore ?? null,
      })),
    );
  }

  /** Return all saved history entries sorted from newest to oldest. */
  static listEntries(): SearchHistoryEntry[] {
    const store = this.readStore();
    return store.entries
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** Save or update a history entry using a stable chip signature. */
  static saveEntry(input: { label: string; chips: SearchHistoryChip[] }): SearchHistoryEntry {
    const label = input.label.trim();
    const chips = input.chips.filter((chip) => this.isValidChip(chip));

    if (!label) {
      throw new Error('Search history label is required');
    }

    if (chips.length === 0) {
      throw new Error('At least one search chip is required');
    }

    const store = this.readStore();
    const now = new Date().toISOString();
    const queryKey = this.buildQueryKey(chips);
    const existingEntry = store.entries.find((entry) => entry.queryKey === queryKey);

    if (existingEntry) {
      const updatedEntry: SearchHistoryEntry = {
        ...existingEntry,
        label,
        chips,
        updatedAt: now,
      };

      const nextEntries = store.entries
        .filter((entry) => entry.id !== existingEntry.id)
        .concat(updatedEntry)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_SEARCH_HISTORY_ENTRIES);

      this.writeStore({ entries: nextEntries });
      return updatedEntry;
    }

    const newEntry: SearchHistoryEntry = {
      id: `search_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      label,
      chips,
      queryKey,
      createdAt: now,
      updatedAt: now,
    };

    const nextEntries = [newEntry, ...store.entries]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_SEARCH_HISTORY_ENTRIES);

    this.writeStore({ entries: nextEntries });
    return newEntry;
  }

  /** Delete a single saved history entry. */
  static deleteEntry(entryId: string): boolean {
    const store = this.readStore();
    const nextEntries = store.entries.filter((entry) => entry.id !== entryId);

    if (nextEntries.length === store.entries.length) {
      return false;
    }

    this.writeStore({ entries: nextEntries });
    return true;
  }

  /** Remove all saved history entries. */
  static clearEntries(): void {
    this.writeStore({ entries: [] });
  }
}
