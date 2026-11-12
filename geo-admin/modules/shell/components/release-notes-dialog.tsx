"use client"

import { useEffect, useId, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import { Sparkles } from "lucide-react"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { isFeatureEnabled } from "@/shared/lib/geo-features"
import {
  fetchReleaseNote,
  hasSeenReleaseNotes,
  markReleaseNotesSeen,
  shouldForceShowReleaseNotes,
  type ReleaseNotePayload,
} from "@/shared/lib/release-notes"
import { Button } from "@/shared/ui/button"
import { EnvVersionBadge } from "@/modules/shell/components/env-version-badge"

function currentAppVersion(): string {
  return (process.env.NEXT_PUBLIC_APP_VERSION || "").trim() || "dev"
}

/** Inline: **bold** and `code`. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(\*\*(.+?)\*\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index))
    }
    if (m[2] != null) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i++}`} className="font-semibold text-foreground">
          {m[2]}
        </strong>,
      )
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]"
        >
          {m[3]}
        </code>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : [text]
}

/**
 * Lightweight body renderer for release notes.
 * Supports: paragraphs, `-`/`*`/`•` lists, `#`–`######` headings, inline **bold** / `code`.
 */
function renderBodyBlocks(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let listItems: string[] = []
  let para: string[] = []
  let key = 0

  const flushList = () => {
    if (!listItems.length) return
    blocks.push(
      <ul key={`ul-${key++}`} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>,
    )
    listItems = []
  }

  const flushPara = () => {
    if (!para.length) return
    const text = para.join("\n")
    blocks.push(
      <p key={`p-${key++}`} className="text-sm leading-relaxed text-foreground/90">
        {renderInline(text, `p-${key}`)}
      </p>,
    )
    para = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushList()
      flushPara()
      const level = headingMatch[1].length
      const label = headingMatch[2].trim()
      const headingClass =
        level <= 3
          ? "text-sm font-semibold text-foreground pt-1"
          : "text-sm font-medium text-foreground/90 pt-1"
      blocks.push(
        <h4 key={`h-${key++}`} className={headingClass}>
          {renderInline(label, `h-${key}`)}
        </h4>,
      )
      continue
    }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/)
    if (bullet) {
      flushPara()
      listItems.push(bullet[1])
      continue
    }
    if (!line.trim()) {
      flushList()
      flushPara()
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushList()
  flushPara()
  return blocks
}

const FALLBACK_NOTE = (version: string): ReleaseNotePayload => ({
  version,
  title: "版本更新说明（预览回退）",
  body:
    "未能从接口加载更新说明，这是强制预览用的回退内容。\n\n- 若看到本弹窗，说明展示链路已通\n- 请检查 /api/release-notes/" +
    version,
  publishedAt: undefined,
})

/**
 * First visit to an app version → show release notes.
 * Force preview: /home?showReleaseNotes=1
 */
export function ReleaseNotesDialog() {
  const { loading, kind } = useAuth()
  const pathname = usePathname()
  const titleId = useId()
  const [note, setNote] = useState<ReleaseNotePayload | null>(null)
  const [open, setOpen] = useState(false)
  const [forceMode, setForceMode] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (loading) return
    if (kind !== "user") return
    if (pathname === "/login" || pathname === "/intake/need-link") return

    if (!isFeatureEnabled("RELEASE_NOTES")) return

    const version = currentAppVersion()
    const force = shouldForceShowReleaseNotes()
    if (!force && hasSeenReleaseNotes(version)) return

    // Only clear the timer on cleanup (Strict Mode). Do not abort an in-flight fetch
    // with a cancelled flag after the timer has already fired.
    const timer = window.setTimeout(() => {
      void (async () => {
        let payload: ReleaseNotePayload | null = null
        // A missing release note is a valid publishing state, not a transient
        // transport failure. In normal mode, request it once so a 404 does not
        // repeatedly pollute the browser console. Forced preview keeps its
        // retries because it is an explicit diagnostic workflow.
        for (let i = 0; i < (force ? 5 : 1); i += 1) {
          payload = await fetchReleaseNote(version)
          if (payload) break
          if (force) await new Promise((r) => setTimeout(r, 250 * (i + 1)))
        }

        if (!payload) {
          if (force) {
            console.warn("[release-notes] API empty, using fallback for", version)
            payload = FALLBACK_NOTE(version)
          } else {
            console.warn("[release-notes] no note for", version)
            return
          }
        } else {
          console.info("[release-notes] opening", payload.version, force ? "(force)" : "")
        }

        setForceMode(force)
        setNote(payload)
        setOpen(true)
      })()
    }, force ? 150 : 400)

    return () => {
      window.clearTimeout(timer)
    }
  }, [loading, kind, pathname])

  function dismiss() {
    if (open && note && !forceMode) {
      markReleaseNotesSeen(note.version || currentAppVersion())
    }
    setOpen(false)
    if (forceMode && typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href)
        if (url.searchParams.has("showReleaseNotes")) {
          url.searchParams.delete("showReleaseNotes")
          window.history.replaceState({}, "", url.pathname + url.search + url.hash)
        }
      } catch {
        // ignore
      }
    }
  }

  if (!mounted || !open || !note) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="关闭更新说明遮罩"
        className="absolute inset-0 bg-black/45"
        onClick={dismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[201] flex w-full max-w-xl flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      >
        <div className="space-y-3 border-b border-border/80 bg-muted/40 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1.5 pt-0.5">
              <h2 id={titleId} className="text-base font-semibold tracking-tight">
                版本更新说明
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <EnvVersionBadge version={note.version} />
                {note.publishedAt ? <span>{note.publishedAt}</span> : <span>本次发版内容一览</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto px-6 py-5">
          {note.title ? <h3 className="text-sm font-medium text-foreground">{note.title}</h3> : null}
          <div className="space-y-3">{renderBodyBlocks(note.body)}</div>
        </div>

        <div className="-mx-0 flex justify-end border-t bg-muted/50 px-6 py-4">
          <Button type="button" className="min-w-24" onClick={dismiss}>
            知道了
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
