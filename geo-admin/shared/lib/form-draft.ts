/**
 * Local form drafts for soft-refresh / accidental close recovery.
 * Storage: sessionStorage (cleared when the tab is closed).
 */

import { storageArea } from "@/shared/lib/storage"

export const FORM_DRAFT_PREFIX = "geo-admin:form-draft:v1:"

export type FormDraftEnvelope<T> = {
  v: 1
  key: string
  /** Form shape version; bump when fields change incompatibly. */
  schemaVersion: number
  savedAt: number
  appVersion: string
  data: T
}

export type DraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key?(index: number): string | null
  length?: number
}

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function defaultStorage(): DraftStorage | null {
  return storageArea("session") as DraftStorage | null
}

function appVersion(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_VERSION) {
    return process.env.NEXT_PUBLIC_APP_VERSION.trim() || "dev"
  }
  return "dev"
}

export function formDraftStorageKey(key: string): string {
  return `${FORM_DRAFT_PREFIX}${key}`
}

export type SaveFormDraftOptions = {
  schemaVersion?: number
  storage?: DraftStorage | null
}

export function saveFormDraft<T>(
  key: string,
  data: T,
  options?: SaveFormDraftOptions | DraftStorage | null,
): boolean {
  // Back-compat: third arg used to be storage directly
  const opts: SaveFormDraftOptions =
    options && typeof options === "object" && "getItem" in options
      ? { storage: options }
      : ((options as SaveFormDraftOptions | undefined) ?? {})
  const store = opts.storage === undefined ? defaultStorage() : opts.storage
  if (!store || !key) return false
  const schemaVersion = opts.schemaVersion ?? 1
  const envelope: FormDraftEnvelope<T> = {
    v: 1,
    key,
    schemaVersion,
    savedAt: Date.now(),
    appVersion: appVersion(),
    data,
  }
  try {
    store.setItem(formDraftStorageKey(key), JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

export type LoadFormDraftOptions = {
  /** When set, mismatched drafts are discarded. */
  schemaVersion?: number
  maxAgeMs?: number
  storage?: DraftStorage | null
}

export function loadFormDraft<T>(key: string, options?: LoadFormDraftOptions): T | null {
  const store = options?.storage === undefined ? defaultStorage() : options.storage
  if (!store || !key) return null
  try {
    const raw = store.getItem(formDraftStorageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FormDraftEnvelope<T>>
    if (!parsed || parsed.v !== 1 || typeof parsed.savedAt !== "number") {
      store.removeItem(formDraftStorageKey(key))
      return null
    }
    const expectedSchema = options?.schemaVersion
    const actualSchema = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1
    if (expectedSchema != null && actualSchema !== expectedSchema) {
      store.removeItem(formDraftStorageKey(key))
      return null
    }
    const maxAge = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    if (Date.now() - parsed.savedAt > maxAge) {
      store.removeItem(formDraftStorageKey(key))
      return null
    }
    return (parsed.data ?? null) as T | null
  } catch {
    try {
      store.removeItem(formDraftStorageKey(key))
    } catch {
      // ignore
    }
    return null
  }
}

export function clearFormDraft(key: string, storage?: DraftStorage | null): void {
  const store = storage === undefined ? defaultStorage() : storage
  if (!store || !key) return
  try {
    store.removeItem(formDraftStorageKey(key))
  } catch {
    // ignore
  }
}

/** True if any geo-admin form draft exists in sessionStorage. */
export function hasAnyFormDraft(storage?: DraftStorage | null): boolean {
  const store = storage === undefined ? defaultStorage() : storage
  if (!store || typeof store.length !== "number" || typeof store.key !== "function") {
    return false
  }
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k?.startsWith(FORM_DRAFT_PREFIX)) return true
    }
  } catch {
    return false
  }
  return false
}
