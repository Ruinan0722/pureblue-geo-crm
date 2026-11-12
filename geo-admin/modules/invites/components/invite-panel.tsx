"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, Link2 } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { useAuth } from "@/modules/auth"
import { toast } from "sonner"
import { cn } from "@/shared/lib/utils"

type GeoVariant = "overseas" | "domestic"

interface FixedInvite {
  id: string
  url: string | null
  geoVariant: GeoVariant
}

async function loadFixedInvites(): Promise<FixedInvite[]> {
  const res = await fetch("/api/invites", { cache: "no-store" })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
    throw new Error(data?.error ?? data?.detail ?? `加载失败 (${res.status})`)
  }
  const body = (await res.json()) as { invites?: FixedInvite[] }
  return body.invites ?? []
}

export function InvitePanel() {
  const { can, user } = useAuth()
  const canViewInvites = can("invite:manage")
  const overseasOnly = user?.role === "overseas"

  const [invites, setInvites] = useState<FixedInvite[]>([])
  const [variant, setVariant] = useState<GeoVariant>("overseas")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setInvites(await loadFixedInvites())
  }, [])

  useEffect(() => {
    if (!canViewInvites) {
      setLoading(false)
      return
    }
    // 严格模式双挂载 / 快速切换用户时，丢弃过期响应，避免并发重复请求与串号
    let cancelled = false
    setLoading(true)
    load()
      .catch((error) =>
        { if (!cancelled) toast.error(error instanceof Error ? error.message : "加载邀请链接失败") },
      )
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load, canViewInvites, user?.id])

  if (!canViewInvites) return null
  if (loading) return <p className="text-sm text-muted-foreground">加载邀请链接…</p>

  const variants: GeoVariant[] = overseasOnly ? ["overseas"] : ["overseas", "domestic"]
  const activeVariant: GeoVariant = invites.some((i) => i.geoVariant === variant)
    ? variant
    : invites[0]?.geoVariant ?? "overseas"
  const shown = invites.find((i) => i.geoVariant === activeVariant)

  async function copy() {
    if (!shown?.url) {
      toast.error("未获取到链接")
      return
    }
    const copied = await copyToClipboard(shown.url)
    if (copied) toast.success("已复制")
    else toast.error("复制失败，请手动复制")
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-primary" />
        <h2 className="text-base font-semibold">客户需求填报链接</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        每位销售自动拥有固定的国内/海外各一条邀请链接，链接长期有效、无需手动生成；客户提交的需求将归属到您。
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="inline-flex shrink-0 items-stretch gap-1 rounded-lg border border-border p-1">
          {variants.map((v) => (
            <button
              key={v}
              type="button"
              className={cn(
                "flex flex-1 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors",
                activeVariant === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
              onClick={() => setVariant(v)}
            >
              {v === "overseas" ? "海外表单" : "国内表单"}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border p-3">
          <p className="min-w-0 flex-1 break-all font-mono text-xs">
            {shown?.url ?? "正在获取固定链接…"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1"
            onClick={() => void copy()}
            disabled={!shown?.url}
          >
            <Copy className="size-3.5" />
            复制
          </Button>
        </div>
      </div>
    </div>
  )
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === "undefined") return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}
