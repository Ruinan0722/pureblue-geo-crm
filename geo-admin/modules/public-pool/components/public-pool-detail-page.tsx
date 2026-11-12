"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { InfoRow, Pill } from "@/modules/crm/components/ui"
import { applyPublicPoolClaim, fetchPublicPoolDetail } from "@/modules/public-pool/services/public-pool-api"
import type { PublicPoolItem } from "@/modules/public-pool/types"

function money(value: number): string {
  if (!value) return "—"
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
}

function statusMeta(item: PublicPoolItem) {
  if (item.status === "pending_review") return { label: "待审核", tone: "warning" }
  if (item.status === "rejected") return { label: "已驳回", tone: "danger" }
  return { label: "可认领", tone: "info" }
}

export function PublicPoolDetailPage({ entryId }: { entryId: string }) {
  const [item, setItem] = useState<PublicPoolItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [claimOpen, setClaimOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setItem(await fetchPublicPoolDetail(entryId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载公海客户详情失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [entryId])

  async function submitClaim() {
    setSubmitting(true)
    try {
      await applyPublicPoolClaim(entryId)
      toast.success("认领申请已提交，等待销售运营审核")
      setClaimOpen(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交认领申请失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">正在加载公海客户详情…</div>
  if (!item) return <div className="p-8"><Link href="/public-pool" className="text-sm text-primary hover:underline">返回公海池</Link></div>
  const meta = statusMeta(item)

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 lg:px-8">
      <Link href="/public-pool" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回公海池</Link>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Building2 className="size-5 text-primary" />{item.companyName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{item.region} · {item.city || "未填写城市"} · {[item.industryL1, item.industryL2].filter(Boolean).join(" / ") || "未填写行业"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={meta.label} tone={meta.tone} />
          {item.canClaim ? <Button onClick={() => setClaimOpen(true)}>{item.status === "rejected" ? "重新认领" : "申请认领"}</Button> : null}
          {item.canReview && item.pendingApplication ? <Button variant="outline" asChild><Link href={`/public-pool?review=${encodeURIComponent(item.pendingApplication.id)}`}><ShieldCheck />审核申请</Link></Button> : null}
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">客户概览</TabsTrigger>
          <TabsTrigger value="enterprise">企业信息</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <dl>
              <InfoRow label="公司名称">{item.companyName}</InfoRow>
              <InfoRow label="品牌名称">{item.brandName || "—"}</InfoRow>
              <InfoRow label="所属区域">{item.region}</InfoRow>
              <InfoRow label="所在城市">{item.city || "—"}</InfoRow>
              <InfoRow label="所属行业">{[item.industryL1, item.industryL2].filter(Boolean).join(" / ") || "—"}</InfoRow>
              <InfoRow label="客户来源">{[item.source, item.sourceDetail].filter(Boolean).join(" / ") || "—"}</InfoRow>
              <InfoRow label="释放原因">{item.releaseReason || "—"}</InfoRow>
              {item.status === "rejected" && item.myApplication?.reviewReason ? <InfoRow label="驳回原因"><span className="text-destructive">{item.myApplication.reviewReason}</span></InfoRow> : null}
              <InfoRow label="联系人信息"><span className="text-muted-foreground">认领成功后可见</span></InfoRow>
              <InfoRow label="附件"><span className="text-muted-foreground">认领成功后可见</span></InfoRow>
            </dl>
          </div>
        </TabsContent>
        <TabsContent value="enterprise" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <dl>
              <InfoRow label="成立日期">{item.foundedDate || "—"}</InfoRow>
              <InfoRow label="统一信用代码">{item.creditCode || "—"}</InfoRow>
              <InfoRow label="注册资本">{money(item.registeredCapital)}</InfoRow>
              <InfoRow label="公司规模">{item.scale || "—"}</InfoRow>
              <InfoRow label="年营业收入">{money(item.annualRevenue)}</InfoRow>
              <InfoRow label="公司性质">{item.nature || "—"}</InfoRow>
            </dl>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent><DialogHeader><DialogTitle>申请认领客户</DialogTitle><DialogDescription>申请将提交给销售运营审核，通过后客户及联系人会转入你的客户管理。</DialogDescription></DialogHeader>
          <div className="rounded-lg bg-muted p-3 font-medium">{item.companyName}</div>
          <DialogFooter><Button variant="outline" onClick={() => setClaimOpen(false)}>取消</Button><Button onClick={() => void submitClaim()} disabled={submitting}>{submitting ? "提交中…" : "确认申请"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
