"use client"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Copy, Download, ExternalLink, Link2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { copyToClipboard } from "@/shared/lib/copy-to-clipboard"
import { LeadNavigation } from "./lead-navigation"

export function ChannelProfileShare() {
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/channel-intake/share", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || body.detail || "获取分享链接失败")
      setUrl(body.url)
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "获取分享链接失败") })
    return () => controller.abort()
  }, [])
  return <div className="px-5 py-6 lg:px-8"><LeadNavigation active="profile" />
    <div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">渠道资料单</h1><p className="mt-2 text-sm text-muted-foreground">分享渠道合作资料收集表，客户提交后自动进入渠道线索。</p></div>
    {error && <p role="alert" className="mb-5 text-sm text-destructive">{error}</p>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-xl border bg-card p-6"><h2 className="flex items-center gap-2 text-base font-semibold"><Link2 className="size-4 text-primary" />固定填写链接</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">客户无需登录即可填写。链接长期有效，可直接发送至客户群。</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row"><input readOnly aria-label="渠道资料单固定链接" value={url} placeholder="正在获取链接…" className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2 text-sm" /><Button disabled={!url} className="gap-2" onClick={async () => { if (await copyToClipboard(url)) toast.success("固定链接已复制"); else toast.error("复制失败，请手动复制链接") }}><Copy className="size-4" />复制链接</Button></div>
        <div className="mt-4 flex flex-wrap gap-3">{url && <Button asChild variant="outline" className="gap-2"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />预览填写页</a></Button>}<Button asChild variant="ghost"><Link href="/leads/channels">查看渠道线索 →</Link></Button></div>
        <div className="mt-7 border-t pt-5"><h3 className="text-sm font-medium">收集内容</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">公司名称、联系人、联系方式、职位、城市、行业、渠道类型、签约方式。</p><p className="mt-3 text-xs leading-6 text-muted-foreground">提交的线索默认待分配，由 SDR 分配渠道销售。疑似重复资料会显示标记，便于核实处理。</p></div>
      </section>
      <section className="rounded-xl border bg-card p-6 text-center"><h2 className="text-base font-semibold">扫码填写</h2>{url ? <><div className="mx-auto my-4 w-52 rounded-xl border bg-white p-2"><img src="/api/channel-intake/qr" width={208} height={208} alt="渠道资料单填写二维码" /></div><p className="text-xs text-muted-foreground">客户扫码即可填写渠道合作资料</p><Button asChild variant="outline" className="mt-5 gap-2"><a href="/api/channel-intake/qr" download="渠道资料单二维码.svg"><Download className="size-4" />下载二维码</a></Button></> : <p className="py-16 text-sm text-muted-foreground">{error ? "二维码暂不可用" : "正在生成二维码…"}</p>}</section>
    </div>
  </div>
}
