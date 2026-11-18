import { createStore, del, get, set } from 'idb-keyval'
import type { CiStatus } from '@/github/types'

/** IndexedDB is only a cache + outbox: the journal text in the repo stays the source of truth. */
const store = createStore('ledger', 'kv')

export interface Settings {
  mode: 'github' | 'local' | ''
  token: string
  owner: string
  repo: string
  branch: string
  /** YYYY-MM-DD, entered at setup (docs/03) */
  tokenExpiry: string
}

export const emptySettings: Settings = { mode: '', token: '', owner: '', repo: 'ledger-data', branch: 'main', tokenExpiry: '' }

export interface CachedFile {
  sha: string
  text: string
}

export interface FileCache {
  /** backend identity the cache belongs to (mode:owner/repo@branch) */
  source: string
  headSha: string
  files: Record<string, CachedFile>
  syncedAt: string
}

export interface OutboxItem {
  /** ULID of the transaction */
  id: string
  date: string
  /** formatted transaction text */
  text: string
  createdAt: string
  error?: string
}

export interface LastCommit extends CiStatus {
  sha: string
  message: string
  /** ISO time of the commit */
  at: string
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

export const db = {
  getSettings: () => safe(async () => ({ ...emptySettings, ...((await get<Settings>('settings', store)) ?? {}) }), { ...emptySettings }),
  setSettings: (s: Settings) => safe(() => set('settings', { ...s }, store), undefined),
  getCache: () => safe(() => get<FileCache>('files', store), undefined),
  setCache: (c: FileCache) => safe(() => set('files', c, store), undefined),
  clearCache: () => safe(() => del('files', store), undefined),
  getOutbox: () => safe(async () => (await get<OutboxItem[]>('outbox', store)) ?? [], [] as OutboxItem[]),
  setOutbox: (items: OutboxItem[]) => safe(() => set('outbox', items, store), undefined),
  getLastCommit: () => safe(() => get<LastCommit>('lastCommit', store), undefined),
  setLastCommit: (c: LastCommit) => safe(() => set('lastCommit', JSON.parse(JSON.stringify(c)), store), undefined)
}

/** Per-device UI conveniences (last used account, category…). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`ledger:${key}`)
      return v === null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`ledger:${key}`, JSON.stringify(value))
    } catch {
      /* storage unavailable */
    }
  }
}
