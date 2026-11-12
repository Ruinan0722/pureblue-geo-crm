"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { clearFormDraft, loadFormDraft, saveFormDraft } from "@/shared/lib/form-draft"
import {
  clearUiSession,
  consumeUiSession,
  peekUiSession,
  registerDraftPublisher,
  setUiSession,
  unregisterDraftPublisher,
} from "@/shared/lib/form-draft-session"
import { isFeatureEnabled } from "@/shared/lib/geo-features"

type UseFormDraftOptions<T> = {
  /** Stable id, e.g. crm:create-customer or request-edit:abc */
  key: string
  /** Bump when form fields change incompatibly — old drafts are discarded. */
  schemaVersion?: number
  /** When true, restore once and keep autosaving */
  open: boolean
  value: T
  onRestore: (data: T) => void
  /**
   * When open and no draft, optionally reset to baseline (e.g. server record).
   * Skip for create dialogs that keep useState defaults.
   */
  getBaseline?: () => T
  /** Return false to skip save and clear any existing draft (empty shell). */
  shouldPersist?: (data: T) => boolean
  debounceMs?: number
  restoreToast?: boolean
  /**
   * Remember this dialog as open for soft-reload restore.
   * Default true.
   */
  trackUiSession?: boolean
}

/**
 * Autosave `value` to sessionStorage while `open`, restore on open.
 * Registers a publisher so version soft-reload can flush the latest keystrokes.
 * No-op when GEO_FEATURE FORM_DRAFT is disabled.
 */
export function useFormDraft<T>(options: UseFormDraftOptions<T>): {
  clearDraft: () => void
} {
  const {
    key,
    schemaVersion = 1,
    open,
    value,
    onRestore,
    getBaseline,
    shouldPersist,
    debounceMs = 400,
    restoreToast = true,
    trackUiSession = true,
  } = options

  const draftsEnabled = isFeatureEnabled("FORM_DRAFT")
  const restoredForOpenRef = useRef(false)
  const skipNextSaveRef = useRef(false)
  const valueRef = useRef(value)
  const onRestoreRef = useRef(onRestore)
  const getBaselineRef = useRef(getBaseline)
  const shouldPersistRef = useRef(shouldPersist)
  valueRef.current = value
  onRestoreRef.current = onRestore
  getBaselineRef.current = getBaseline
  shouldPersistRef.current = shouldPersist

  const persistNow = (data: T) => {
    if (!draftsEnabled) return
    const persist = shouldPersistRef.current
    if (persist && !persist(data)) {
      clearFormDraft(key)
      return
    }
    saveFormDraft(key, data, { schemaVersion })
  }

  // Restore once per open; track UI session while open
  useEffect(() => {
    if (!draftsEnabled) {
      restoredForOpenRef.current = false
      return
    }
    if (!open) {
      restoredForOpenRef.current = false
      if (trackUiSession) clearUiSession()
      return
    }

    if (trackUiSession) setUiSession(key)

    if (restoredForOpenRef.current) return
    restoredForOpenRef.current = true

    const draft = loadFormDraft<T>(key, { schemaVersion })
    skipNextSaveRef.current = true
    if (draft != null) {
      onRestoreRef.current(draft)
      if (restoreToast) {
        toast.message("已恢复未提交草稿", {
          id: `form-draft-restore:${key}`,
          description: "来自本次标签页的本地保存；保存成功后会自动清除。",
        })
      }
      return
    }
    if (getBaselineRef.current) {
      onRestoreRef.current(getBaselineRef.current())
    }
  }, [draftsEnabled, open, key, schemaVersion, restoreToast, trackUiSession])

  // Register publisher for flush-before-reload; flush on close/unmount
  useEffect(() => {
    if (!draftsEnabled || !open) return

    registerDraftPublisher({
      key,
      schemaVersion,
      getValue: () => valueRef.current,
      shouldPersist: shouldPersist
        ? (data) => shouldPersist(data as T)
        : undefined,
    })

    return () => {
      persistNow(valueRef.current)
      unregisterDraftPublisher(key)
    }
     
  }, [draftsEnabled, open, key, schemaVersion])

  // Debounced autosave while open
  useEffect(() => {
    if (!draftsEnabled || !open) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      persistNow(value)
    }, debounceMs)
    return () => window.clearTimeout(timer)
     
  }, [draftsEnabled, open, key, value, debounceMs, schemaVersion])

  // Tab close / refresh: best-effort sync flush
  useEffect(() => {
    if (!draftsEnabled || !open) return
    const onLeave = () => {
      persistNow(valueRef.current)
    }
    window.addEventListener("beforeunload", onLeave)
    window.addEventListener("pagehide", onLeave)
    return () => {
      window.removeEventListener("beforeunload", onLeave)
      window.removeEventListener("pagehide", onLeave)
    }
     
  }, [draftsEnabled, open, key, schemaVersion])

  return {
    clearDraft: () => {
      clearFormDraft(key)
      if (trackUiSession) clearUiSession()
    },
  }
}

/**
 * Open state that re-opens after soft-reload when UI session matches this dialog.
 */
export function useSessionRestoredOpen(
  matches: string | ((dialogKey: string) => boolean),
): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  const matchesRef = useRef(matches)
  matchesRef.current = matches

  useEffect(() => {
    if (!isFeatureEnabled("FORM_DRAFT")) return
    const session = peekUiSession()
    if (!session) return
    if (session.path && session.path !== window.location.pathname) return
    const m = matchesRef.current
    const ok = typeof m === "string" ? session.dialogKey === m : m(session.dialogKey)
    if (!ok) return
    consumeUiSession()
    setOpen(true)
  }, [])

  return [open, setOpen]
}
