/**
 * Version probe + ChunkLoad auto-reload for seamless soft refresh.
 *
 * Contract: public/version.json (and geo-api GET /api/version) follow
 * deploy/seamless/conventions/version.schema.json — version === Git tag.
 */

export type VersionPayload = {
  version: string
  buildId?: string
  builtAt?: string
}

export type VersionGuardOptions = {
  /** Version baked into the currently loaded shell. */
  currentVersion: string
  /** Absolute or same-origin path. Default: /version.json */
  versionUrl?: string
  /** Poll interval ms; 0 disables polling (still checks on focus). Default: 60_000 */
  intervalMs?: number
  /**
   * Called when a newer version is detected and reload is not deferred.
   * Default: location.reload().
   */
  onUpdate?: (remote: VersionPayload) => void
  /**
   * When true, skip reload for a version mismatch (e.g. open modal / focused input).
   * ChunkLoadError still forces reload — the shell is already broken.
   */
  shouldDeferReload?: () => boolean
  /** Called when an update is waiting because shouldDeferReload() returned true. */
  onDeferredUpdate?: (remote: VersionPayload) => void
  /**
   * While a deferred update is pending, poll this often so reload happens soon
   * after the user closes the dialog. Default: 3_000.
   */
  deferredIntervalMs?: number
  /**
   * Called immediately before any reload (version mismatch or ChunkLoadError).
   * Use to flush form drafts to sessionStorage.
   */
  onBeforeReload?: () => void
  /** sessionStorage key to prevent reload loops. */
  reloadGuardKey?: string
}

import { readRaw, removeRaw, writeRaw } from "@/shared/lib/storage"

const DEFAULT_VERSION_URL = "/version.json"
const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_DEFERRED_INTERVAL_MS = 3_000
const DEFAULT_RELOAD_KEY = "seamless:version-guard:reloaded"

function isChunkLoadMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes("chunkloaderror") ||
    m.includes("loading chunk") ||
    m.includes("failed to fetch dynamically imported module") ||
    m.includes("importing a module script failed")
  )
}

export function safeReload(key: string = DEFAULT_RELOAD_KEY, generation?: string): void {
  try {
    const marker = generation && generation.length > 0 ? generation : "1"
    if (readRaw("session", key) === marker) return
    writeRaw("session", key, marker)
  } catch {
    // private mode / blocked storage — still attempt one reload
  }
  location.reload()
}

function clearReloadGuard(key: string): void {
  removeRaw("session", key)
}

async function fetchVersion(url: string): Promise<VersionPayload | null> {
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin" })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<VersionPayload>
    if (!data || typeof data.version !== "string" || !data.version) return null
    return data as VersionPayload
  } catch {
    return null
  }
}

export type VersionGuardHandle = {
  check: () => Promise<void>
  dispose: () => void
}

/**
 * Start version checks + chunk-error listeners.
 * Returns a handle to stop timers/listeners (e.g. in tests or HMR).
 */
export function initVersionGuard(options: VersionGuardOptions): VersionGuardHandle {
  const versionUrl = options.versionUrl ?? DEFAULT_VERSION_URL
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const deferredIntervalMs = options.deferredIntervalMs ?? DEFAULT_DEFERRED_INTERVAL_MS
  const reloadKey = options.reloadGuardKey ?? DEFAULT_RELOAD_KEY
  const current = options.currentVersion

  const onUpdate =
    options.onUpdate ??
    ((remote: VersionPayload) => {
      options.onBeforeReload?.()
      safeReload(reloadKey, remote.version)
    })

  const reloadNow = (generation: string) => {
    options.onBeforeReload?.()
    safeReload(reloadKey, generation)
  }

  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight = false

  const armTimer = (ms: number) => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (ms > 0) {
      timer = setInterval(() => void check(), ms)
    }
  }

  const check = async () => {
    if (disposed || inFlight) return
    inFlight = true
    try {
      const remote = await fetchVersion(versionUrl)
      if (!remote || disposed) return
      if (remote.version !== current) {
        if (options.shouldDeferReload?.()) {
          options.onDeferredUpdate?.(remote)
          armTimer(deferredIntervalMs)
          return
        }
        onUpdate(remote)
        return
      }
      // Version matches — allow a future forced reload after a bad chunk cycle
      clearReloadGuard(reloadKey)
      if (intervalMs > 0) armTimer(intervalMs)
    } finally {
      inFlight = false
    }
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") void check()
  }

  const onScriptError = (event: ErrorEvent) => {
    const msg = String(event.message ?? event.error ?? "")
    if (isChunkLoadMessage(msg)) reloadNow(`chunk:${current}`)
  }

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    const msg =
      typeof reason === "string"
        ? reason
        : reason instanceof Error
          ? reason.message
          : String(reason ?? "")
    if (isChunkLoadMessage(msg)) reloadNow(`chunk:${current}`)
  }

  document.addEventListener("visibilitychange", onVisible)
  window.addEventListener("error", onScriptError)
  window.addEventListener("unhandledrejection", onRejection)

  void check()
  armTimer(intervalMs)

  return {
    check,
    dispose() {
      disposed = true
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("error", onScriptError)
      window.removeEventListener("unhandledrejection", onRejection)
      if (timer) clearInterval(timer)
    },
  }
}

/** Read version from window.__APP_VERSION__ if the host app set it. */
export function readEmbeddedAppVersion(): string | undefined {
  const w = window as Window & { __APP_VERSION__?: string }
  const v = w.__APP_VERSION__
  return typeof v === "string" && v.length > 0 ? v : undefined
}
