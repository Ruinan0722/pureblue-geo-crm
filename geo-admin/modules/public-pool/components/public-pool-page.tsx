"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { RefreshCw, Search, ShieldCheck } from "lucide-react"
import { useAuth } from "@/modules/auth"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { ListPagination } from "@/shared/ui/list-pagination"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table"
import { FilterChips, FilterField, FilterGrid, FilterSelect, PageHeader, Pill, StatCards } from "@/modules/crm/components/ui"
import {
  applyPublicPoolClaim,
  fetchPublicPool,
  fetchPublicPoolStats,
  reviewPublicPoolClaim,
} from "@/modules/public-pool/services/public-pool-api"
import type { PublicPoolItem, PublicPoolList, PublicPoolStats } from "@/modules/public-pool/types"

const PAGE_SIZE = 20
const EMPTY_LIST: PublicPoolList = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, allowedRegions: [], regionConfigured: true }
const EMPTY_STATS: PublicPoolStats = { total: 0, pending_review: 0, claimed_this_month: 0 }

function PoolStatus({ item }: { item: PublicPoolItem }) {
  if (item.status === "pending_review") return <Pill label="待审核" tone="warning" />
  if (item.status === "claimed") return <Pill label="已认领" tone="success" />
  if (item.status === "rejected") return <Pill label="已驳回" tone="danger" />
  return <Pill label="可认领" tone="info" />
}

export function PublicPoolPage() {
  const { can } = useAuth()
  const [data, setData] = useState(EMPTY_LIST)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<"active" | "available" | "pending_review">("active")
  const [draft, setDraft] = useState({ companyName: "", industry: "", region: "all", source: "" })
  const [filters, setFilters] = useState(draft)
  const [claimTarget, setClaimTarget] = useState<PublicPoolItem | null>(null)
  const [reviewTarget, setReviewTarget] = useState<PublicPoolItem | null>(null)
  const [reviewReason, setReviewReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, summary] = await Promise.all([
        fetchPublicPool({ ...filters, status, page, pageSize: PAGE_SIZE }),
        fetchPublicPoolStats(),
      ])
      setData(list)
      setStats(summary)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载公海池失败")
    } finally {
      setLoading(false)
    }
  }, [filters, page, status])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!can("public_pool:review") || data.items.length === 0) return
    const claimId = new URLSearchParams(window.location.search).get("review")
    if (!claimId) return
    const match = data.items.find((item) => item.pendingApplication?.id === claimId)
    if (match) setReviewTarget(match)
  }, [can, data.items])

  const regionOptions = useMemo(() => [
    { value: "all", label: "全部区域" },
    ...data.allowedRegions.map((region) => ({ value: region, label: region })),
  ], [data.allowedRegions])

  function search() {
    setPage(1)
    setFilters({ ...draft })
  }

  async function submitClaim() {
    if (!claimTarget) return
    setSubmitting(true)
    try {
      await applyPublicPoolClaim(claimTarget.id)
      toast.success("认领申请已提交，等待销售运营审核")
      setClaimTarget(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReview(approved: boolean) {
    const claim = reviewTarget?.pendingApplication
    if (!claim) return
    if (!approved && !reviewReason.trim()) {
      toast.error("审核不通过时必须填写原因")
      return
    }
    setSubmitting(true)
    try {
      await reviewPublicPoolClaim(claim.id, approved, reviewReason.trim())
      toast.success(approved ? "已通过认领，客户已转入申请销售名下" : "已驳回认领申请")
      setReviewTarget(null)
      setReviewReason("")
      window.history.replaceState(null, "", "/public-pool")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "审核失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="公海池" desc="按销售区域展示可认领客户；认领成功前不展示联系人与附件。" action={
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />刷新</Button>
      } />
      <main className="space-y-5 p-5 lg:p-8">
        <StatCards cols={3} dense items={[
          { label: "公海客户总数", value: stats.total },
          { label: "待认领审核", value: stats.pending_review, tone: "text-amber-600" },
          { label: "本月已认领", value: stats.claimed_this_month, tone: "text-emerald-600" },
        ]} />

        {!data.regionConfigured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">当前账号尚未配置华北、华东或华南销售区域，暂时无法查看公海客户，请联系管理员。</div>
        ) : null}

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <FilterChips value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={[
            { value: "active", label: "全部公海客户" },
            { value: "available", label: "可认领" },
            { value: "pending_review", label: "待审核" },
          ]} />
          <FilterGrid className="xl:grid-cols-5">
            <FilterField label="公司名称"><Input value={draft.companyName} onChange={(e) => setDraft((v) => ({ ...v, companyName: e.target.value }))} placeholder="搜索公司名称" onKeyDown={(e) => { if (e.key === "Enter") search() }} /></FilterField>
            <FilterField label="行业"><Input value={draft.industry} onChange={(e) => setDraft((v) => ({ ...v, industry: e.target.value }))} placeholder="输入一级/二级行业" /></FilterField>
            <FilterField label="区域"><FilterSelect value={draft.region} onChange={(region) => setDraft((v) => ({ ...v, region }))} options={regionOptions} /></FilterField>
            <FilterField label="客户来源"><Input value={draft.source} onChange={(e) => setDraft((v) => ({ ...v, source: e.target.value }))} placeholder="输入客户来源" /></FilterField>
            <div className="flex items-end"><Button className="w-full" onClick={search}><Search />查询</Button></div>
          </FilterGrid>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <Table className="min-w-[1180px]">
            <TableHeader><TableRow>
              <TableHead>公司名称</TableHead><TableHead>区域</TableHead><TableHead>城市</TableHead><TableHead>行业/子行业</TableHead>
              <TableHead>来源/二级来源</TableHead><TableHead>联系人信息</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium"><Link href={`/public-pool/${encodeURIComponent(item.id)}`} className="text-primary underline-offset-4 hover:underline">{item.companyName}</Link></TableCell><TableCell>{item.region}</TableCell><TableCell>{item.city || "—"}</TableCell>
                  <TableCell>{[item.industryL1, item.industryL2].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell>{[item.source, item.sourceDetail].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell><span className="text-muted-foreground">认领成功后可见</span></TableCell>
                  <TableCell><PoolStatus item={item} /></TableCell>
                  <TableCell>
                    {item.canReview && item.pendingApplication ? <Button size="sm" onClick={() => { setReviewTarget(item); setReviewReason("") }}><ShieldCheck />审核</Button> : null}
                    {item.canClaim ? <Button size="sm" variant="outline" onClick={() => setClaimTarget(item)}>{item.status === "rejected" ? "重新认领" : "申请认领"}</Button> : null}
                    {!item.canReview && !item.canClaim ? <span className="text-xs text-muted-foreground">{item.myApplication?.status === "pending_review" ? "已申请" : "—"}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && data.items.length === 0 ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">暂无符合条件的公海客户</TableCell></TableRow> : null}
              {loading ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">加载中…</TableCell></TableRow> : null}
            </TableBody>
          </Table>
          <div className="border-t p-4"><ListPagination total={data.total} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} loading={loading} /></div>
        </section>
      </main>

      <Dialog open={Boolean(claimTarget)} onOpenChange={(open) => { if (!open) setClaimTarget(null) }}>
        <DialogContent><DialogHeader><DialogTitle>申请认领客户</DialogTitle><DialogDescription>申请将提交给销售运营审核，通过后客户和联系人会转入你的客户管理。</DialogDescription></DialogHeader>
          <div className="rounded-lg bg-muted p-3"><p className="font-medium">{claimTarget?.companyName}</p><p className="mt-1 text-xs text-muted-foreground">{claimTarget?.region} · {claimTarget?.industryL1 || "未填行业"}</p></div>
          <DialogFooter><Button variant="outline" onClick={() => setClaimTarget(null)}>取消</Button><Button onClick={() => void submitClaim()} disabled={submitting}>{submitting ? "提交中…" : "确认申请"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => { if (!open) setReviewTarget(null) }}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>审核认领申请</DialogTitle><DialogDescription>申请销售：{reviewTarget?.pendingApplication?.applicantName || "—"}；客户：{reviewTarget?.companyName || "—"}</DialogDescription></DialogHeader>
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="review-reason">审核说明 <span className="text-muted-foreground">（驳回时必填）</span></label><Textarea id="review-reason" value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="请填写审核说明或驳回原因" rows={4} /></div>
          <DialogFooter><Button variant="destructive" onClick={() => void submitReview(false)} disabled={submitting}>驳回</Button><Button onClick={() => void submitReview(true)} disabled={submitting}>{submitting ? "处理中…" : "通过并分配客户"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
