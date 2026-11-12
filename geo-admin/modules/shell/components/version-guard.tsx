"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { hasAnyFormDraft } from "@/shared/lib/form-draft"
import { flushAllDraftPublishers } from "@/shared/lib/form-draft-session"
import { isFeatureEnabled } from "@/shared/lib/geo-features"
import { clearReleaseNotesSeen } from "@/shared/lib/release-notes"
import { initVersionGuard, safeReload } from "@/shared/lib/version-guard"

const TOAST_ID = "geo-admin-version-update"
const RELOAD_KEY = "seamless:version-guard:reloaded"

function reloadForVersion(remoteVersion: string): void {
  if (isFeatureEnabled("FORM_DRAFT")) {
    flushAllDraftPublishers()
  }
  safeReload(RELOAD_KEY, remoteVersion)
}

/** Open modal / active form interaction — defer soft reload so drafts are not wiped mid-keystroke. */
function isEditingBusy(): boolean {
  if (typeof document === "undefined") return false

  const openDialog =
    document.querySelector('[data-slot="dialog-content"][data-open]') ||
    document.querySelector('[data-slot="dialog-overlay"][data-open]') ||
    document.querySelector('[role="dialog"][data-open]')
  if (openDialog) return true

  for (const node of document.querySelectorAll('[data-slot="dialog-content"], [role="dialog"]')) {
    if (!(node instanceof HTMLElement)) continue
    if (node.getClientRects().length === 0) continue
    const style = getComputedStyle(node)
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
      continue
    }
    return true
  }

  const el = document.activeElement
  if (el instanceof HTMLElement) {
    if (el.closest("form")) return true
    const tag = el.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) {
      return true
    }
  }

  return false
}

function installReleaseNotesDevHelpers(): (() => void) | undefined {
  if (!isFeatureEnabled("RELEASE_NOTES_DEV_HELPERS")) return undefined
  const w = window as Window & {
    __geoClearReleaseNotesSeen?: () => void
    __geoShowReleaseNotes?: () => void
  }
  w.__geoClearReleaseNotesSeen = () => {
    clearReleaseNotesSeen()
    console.info("[release-notes] cleared seen keys on", window.location.origin)
  }
  w.__geoShowReleaseNotes = () => {
    clearReleaseNotesSeen()
    const url = new URL(window.location.href)
    if (url.pathname === "/login" || url.pathname === "/intake/need-link") {
      url.pathname = "/home"
    }
    url.searchParams.set("showReleaseNotes", "1")
    console.info("[release-notes] reloading:", url.toString())
    window.location.assign(url.toString())
  }
  console.info(
    "[release-notes] helpers ready — __geoShowReleaseNotes() / __geoClearReleaseNotesSeen()",
  )
  return () => {
    delete w.__geoClearReleaseNotesSeen
    delete w.__geoShowReleaseNotes
  }
}

/**
 * Soft-refresh when /version.json reports a newer deploy tag.
 * Flushes local drafts before reload; re-opens the dialog via UI session when applicable.
 */
export function VersionGuard() {
  useEffect(() => {
    if (!isFeatureEnabled("VERSION_SOFT_REFRESH")) return

    const current = (process.env.NEXT_PUBLIC_APP_VERSION || "").trim() || "dev"
    const w = window as Window & { __APP_VERSION__?: string }
    w.__APP_VERSION__ = current

    const disposeHelpers = installReleaseNotesDevHelpers()

    const handle = initVersionGuard({
      currentVersion: current,
      versionUrl: "/version.json",
      shouldDeferReload: isEditingBusy,
      onBeforeReload: () => {
        if (isFeatureEnabled("FORM_DRAFT")) flushAllDraftPublishers()
      },
      onDeferredUpdate: (remote) => {
        const draftsOn = isFeatureEnabled("FORM_DRAFT")
        const hasDraft = draftsOn && hasAnyFormDraft()
        toast.message("系统已更新", {
          id: TOAST_ID,
          description: hasDraft
            ? "你正在编辑中，内容已自动保存为草稿。关闭弹窗或离开表单后将自动刷新并尝试恢复；也可立即刷新。"
            : "你正在编辑中。关闭弹窗或离开表单后将自动刷新；也可立即刷新。",
          duration: Infinity,
          action: {
            label: "立即刷新",
            onClick: () => reloadForVersion(remote.version),
          },
        })
      },
      onUpdate: (remote) => {
        toast.dismiss(TOAST_ID)
        reloadForVersion(remote.version)
      },
    })
    return () => {
      toast.dismiss(TOAST_ID)
      handle.dispose()
      disposeHelpers?.()
    }
  }, [])

  return null
}
