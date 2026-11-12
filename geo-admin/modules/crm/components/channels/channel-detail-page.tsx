"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/shared/ui/button"
import { fetchChannel, type ChannelPartner } from "@/modules/crm/services/channel-management"
import { ChannelDetailPanel, type ChannelTab } from "./channel-detail-panel"
import { ChannelError, ChannelLoading } from "./channel-ui"

const TABS: ChannelTab[] = ["overview", "contacts", "requirements", "execution", "follow-ups", "opportunities", "contracts", "history"]

export function ChannelDetailPage({ id, tab = "overview", partnerType = "channel" }: { id: string; tab?: string; partnerType?: "channel" | "strategic_ecosystem" }) {
  const router = useRouter()
  const [partner, setPartner] = useState<ChannelPartner | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestId = useRef(0)
  const load = useCallback(async (initial = false) => {
    const request = ++requestId.current
    if (initial) setLoading(true)
    setError("")
    try { const row = await fetchChannel(id); if (request === requestId.current) setPartner(row) }
    catch (caught) { if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载渠道详情失败。") }
    finally { if (request === requestId.current) setLoading(false) }
  }, [id])
  useEffect(() => { void load(true); return () => { requestId.current += 1 } }, [load])
  if (loading) return <ChannelLoading label="正在加载渠道详情…" />
  const base = partnerType === "strategic_ecosystem" ? "/ecosystems" : "/channels"
  if (!partner) return <div className="space-y-4 px-5 py-6 lg:px-8"><ChannelError message={error || "渠道不存在或当前账号无权访问。"} retry={() => void load(true)} /><Button variant="outline" onClick={() => router.push(base)}>返回列表</Button></div>
  return <>
    {error && <div className="px-5 pt-4 lg:px-8"><ChannelError message={error} retry={() => void load()} /></div>}
    <ChannelDetailPanel key={id} partner={partner} initialTab={TABS.includes(tab as ChannelTab) ? tab as ChannelTab : "overview"} onClose={() => router.push(base)} onSaved={(updated) => { setPartner(updated); void load() }} onChanged={() => void load()} />
  </>
}
