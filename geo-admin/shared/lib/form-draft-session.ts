/**
 * In-memory draft publishers (flush before reload) + UI session (re-open dialog after reload).
 */

import {
  clearFormDraft,
  saveFormDraft,
  type DraftStorage,
} from "@/shared/lib/form-draft"
import { storageArea } from "@/shared/lib/storage"

const UI_SESSION_KEY = "geo-admin:ui-session:v1"

export type UiSession = {
  v: 1
  dialogKey: string
  path: string
}

export type DraftPublisher = {
  key: string
  schemaVersion: number
  getValue: () => unknown
  shouldPersist?: (data: unknown) => boolean
}

const publishers = new Map<string, DraftPublisher>()

function sessionStore(): DraftStorage | null {
  return storageArea("session") as DraftStorage | null
}

export function registerDraftPublisher(publisher: DraftPublisher): void {
  publishers.set(publisher.key, publisher)
}

export function unregisterDraftPublisher(key: string): void {
  publishers.delete(key)
}

/** Synchronously persist every open dialog's current value (call before reload). */
export function flushAllDraftPublishers(): void {
  for (const p of publishers.values()) {
    const value = p.getValue()
    if (p.shouldPersist && !p.shouldPersist(value)) {
      clearFormDraft(p.key)
      continue
    }
    saveFormDraft(p.key, value, { schemaVersion: p.schemaVersion })
  }
}

export function setUiSession(dialogKey: string, path?: string): void {
  const store = sessionStore()
  if (!store || !dialogKey) return
  const payload: UiSession = {
    v: 1,
    dialogKey,
    path: path ?? (typeof window !== "undefined" ? window.location.pathname : ""),
  }
  try {
    store.setItem(UI_SESSION_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function peekUiSession(): UiSession | null {
  const store = sessionStore()
  if (!store) return null
  try {
    const raw = store.getItem(UI_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UiSession>
    if (!parsed || parsed.v !== 1 || typeof parsed.dialogKey !== "string" || !parsed.dialogKey) {
      store.removeItem(UI_SESSION_KEY)
      return null
    }
    return {
      v: 1,
      dialogKey: parsed.dialogKey,
      path: typeof parsed.path === "string" ? parsed.path : "",
    }
  } catch {
    return null
  }
}

export function clearUiSession(): void {
  const store = sessionStore()
  if (!store) return
  try {
    store.removeItem(UI_SESSION_KEY)
  } catch {
    // ignore
  }
}

/** Read and clear — used once after soft-reload to re-open the dialog. */
export function consumeUiSession(): UiSession | null {
  const session = peekUiSession()
  if (session) clearUiSession()
  return session
}
