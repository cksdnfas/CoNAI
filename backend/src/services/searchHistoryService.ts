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
  /** Owner account; null for the local owner before accounts exist. Entries saved before history was per account have none. */
  accountId?: number | null;
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

/** Whose history a request reads and writes. Administrators also see entries saved before history was per account. */
export interface SearchHistoryOwner {
  accountId: number | null;
  isAdmin: boolean;
}

function ownsEntry(owner: SearchHistoryOwner, entry: SearchHistoryEntry): boolean {
  return entry.accountId === undefined ? owner.isAdmin : entry.accountId === owner.accountId;
}

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

  /** Return the owner's saved history entries sorted from newest to oldest. */
  static listEntries(owner: SearchHistoryOwner): SearchHistoryEntry[] {
    const store = this.readStore();
    return store.entries
      .filter((entry) => ownsEntry(owner, entry))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** Keep each owner's newest entries within the cap without touching other owners'. */
  private static capEntries(owner: SearchHistoryOwner, entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
    const sorted = entries.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const kept = new Set(sorted.filter((entry) => entry.accountId === owner.accountId).slice(0, MAX_SEARCH_HISTORY_ENTRIES));
    return sorted.filter((entry) => entry.accountId !== owner.accountId || kept.has(entry));
  }

  /** Save or update a history entry using a stable chip signature. */
  static saveEntry(owner: SearchHistoryOwner, input: { label: string; chips: SearchHistoryChip[] }): SearchHistoryEntry {
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
    const existingEntry = store.entries.find((entry) => entry.accountId === owner.accountId && entry.queryKey === queryKey);

    if (existingEntry) {
      const updatedEntry: SearchHistoryEntry = {
        ...existingEntry,
        label,
        chips,
        updatedAt: now,
      };

      this.writeStore({ entries: this.capEntries(owner, store.entries.filter((entry) => entry.id !== existingEntry.id).concat(updatedEntry)) });
      return updatedEntry;
    }

    const newEntry: SearchHistoryEntry = {
      id: `search_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      accountId: owner.accountId,
      label,
      chips,
      queryKey,
      createdAt: now,
      updatedAt: now,
    };

    this.writeStore({ entries: this.capEntries(owner, [newEntry, ...store.entries]) });
    return newEntry;
  }

  /** Delete one of the owner's saved history entries. */
  static deleteEntry(owner: SearchHistoryOwner, entryId: string): boolean {
    const store = this.readStore();
    const nextEntries = store.entries.filter((entry) => entry.id !== entryId || !ownsEntry(owner, entry));

    if (nextEntries.length === store.entries.length) {
      return false;
    }

    this.writeStore({ entries: nextEntries });
    return true;
  }

  /** Remove all of the owner's saved history entries. */
  static clearEntries(owner: SearchHistoryOwner): void {
    const store = this.readStore();
    this.writeStore({ entries: store.entries.filter((entry) => !ownsEntry(owner, entry)) });
  }
}
