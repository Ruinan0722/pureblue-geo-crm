"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, History, Pencil, Upload } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Button } from "@/shared/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { InfoRow } from "../ui"
import { AttachmentUploadDialog } from "../attachment-upload-dialog"
import { CrmAttachmentRow } from "../attachment-row"
import { fetchChannelContract, fetchChannelResource, fetchChannels, fetchAllChannelOpportunities, attachChannelContractFiles, channelOpportunityUrl, subscribeChannelContractChanges, type ChannelContractRow, type ChannelPartner, type ChannelOpportunityRow, type ChannelHistory } from "@/modules/crm/services/channel-management"
import { ChannelContractForm } from "./channel-contract-form"
import { ChannelSignDialog } from "./channel-action-dialogs"
import { ChannelBadge, ChannelError, ChannelLoading, displayDate } from "./channel-ui"

export function ChannelContractDetail({ id, partnerType = "channel" }: { id: string; partnerType?: "channel" | "strategic_ecosystem" }) {
  const { user, canAccess, loading: authLoading } = useAuth()
  const allowed = canAccess("contracts") && canAccess("channels")
  const canWrite = Boolean(user?.permissions.includes("channels:write"))
  const canViewOpportunities = canAccess("opportunities")
  const canViewContracts = canAccess("contracts")
  const [row, setRow] = useState<ChannelContractRow | null>(null)
  const [partners, setPartners] = useState<ChannelPartner[]>([])
  const [opportunities, setOpportunities] = useState<ChannelOpportunityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [history, setHistory] = useState<ChannelHistory[]>([])
  const [historyError, setHistoryError] = useState("")
  const historyPartnerId = row?.partnerId
  const historyName = row?.name
  const historyUpdatedAt = row?.updatedAt
  useEffect(() => {
    if (!historyPartnerId || !historyName) return
    let active = true
    setHistoryError("")
    void fetchChannelResource<ChannelHistory[]>(historyPartnerId, "history").then((events) => {
      if (active) setHistory(events.filter((event) => event.action.startsWith("contract") && event.detail?.includes(historyName)))
    }).catch((caught) => { if (active) setHistoryError(caught instanceof Error ? caught.message : "历史记录加载失败") })
    return () => { active = false }
  }, [historyPartnerId, historyName, historyUpdatedAt])
  const requestId = useRef(0)
  const load = useCallback(async (initial = false) => {
    const request = ++requestId.current
    if (initial) setLoading(true)
    setError("")
    try {
      const [contract, channels, opps] = await Promise.all([fetchChannelContract(id), fetchChannels(partnerType), (canViewOpportunities ? fetchAllChannelOpportunities(partnerType) : Promise.resolve([]))])
      if (contract.partnerType !== partnerType) throw new Error("合同不属于当前分类。")
      if (request === requestId.current) { setRow(contract); setPartners(channels); setOpportunities(opps) }
    } catch (caught) { if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载合同失败。") }
    finally { if (request === requestId.current) setLoading(false) }
  }, [id, partnerType, canViewOpportunities, canViewContracts])
  useEffect(() => { if (!authLoading && allowed) void load(true); return () => { requestId.current += 1 } }, [load, allowed, authLoading])
  useEffect(() => { if (allowed) return subscribeChannelContractChanges(() => void load()) }, [load, allowed])
  if (authLoading) return <ChannelLoading />
  if (!allowed) return <div className="px-5 py-6 lg:px-8"><ChannelError message="当前账号需要合同管理及合作伙伴管理的访问权限。" /></div>
  if (loading) return <ChannelLoading label={partnerType === "strategic_ecosystem" ? "正在加载战略生态合同…" : "正在加载渠道合同…"} />
  const ecosystem = partnerType === "strategic_ecosystem"
  const contractsUrl = ecosystem ? "/contracts/ecosystems" : "/contracts/channels"
  const partnersUrl = ecosystem ? "/ecosystems/" : "/channels/"
  const partnerLabel = ecosystem ? "生态客户" : "渠道伙伴"
  const contractLabel = ecosystem ? "战略生态合同" : "渠道合同"
  const back = <Link href={contractsUrl} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回{ecosystem ? "战略生态" : "渠道"}合同</Link>
  if (!row) return <div className="space-y-4 px-5 py-6 lg:px-8">{back}<ChannelError message={error || "渠道合同不存在或无权访问。"} retry={() => void load(true)} /></div>
  const files = row.attachments || []
  return <div className="relative mx-auto max-w-5xl px-5 py-6 pb-24 lg:px-8">
    {back}<ChannelError message={error} retry={() => void load()} />
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight">{row.name}<ChannelBadge value={row.status} kind="contract" /></h1><p className="mt-1 font-mono text-sm text-muted-foreground">{row.contractNumber || "待补充合同编号"}</p></div><div className="flex flex-wrap gap-2">{canWrite && <><Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="size-4" />编辑合同</Button><Button variant="outline" className="gap-1.5" onClick={() => setUploading(true)}><Upload className="size-4" />上传附件</Button>{row.status !== "是" && <Button className="gap-1.5" onClick={() => setSigning(true)}><CheckCircle2 className="size-4" />完成签署</Button>}</>}</div></div>
    <Tabs defaultValue="basic" className="mt-6"><TabsList className="flex w-full flex-wrap justify-start gap-1"><TabsTrigger value="basic">基本信息</TabsTrigger><TabsTrigger value="signing">签约信息</TabsTrigger><TabsTrigger value="related">合同周期</TabsTrigger><TabsTrigger value="files">附件 ({files.length})</TabsTrigger><TabsTrigger value="history"><History className="size-3.5 opacity-70" />历史操作记录</TabsTrigger></TabsList>
      <TabsContent value="basic" className="mt-4"><div className="rounded-2xl border border-border bg-card p-5"><dl>
        <InfoRow label="合同名称">{row.name}</InfoRow><InfoRow label="合同编号">{row.contractNumber || "—"}</InfoRow>
        <InfoRow label={partnerLabel}><Link href={partnersUrl + encodeURIComponent(row.partnerId)} className="text-primary hover:underline">{row.channelSubject || row.partnerName}</Link></InfoRow>
        <InfoRow label="所在地区">{row.region || "—"}</InfoRow><InfoRow label="合同类型">{contractLabel}</InfoRow><InfoRow label="合同状态"><ChannelBadge value={row.status} kind="contract" /></InfoRow><InfoRow label="项目状态">{row.projectStatus || "无"}</InfoRow>
        <InfoRow label="关联商机">{row.opportunityId && canAccess("opportunities") ? <Link href={channelOpportunityUrl(row.opportunityId, partnerType)} className="text-primary hover:underline">{row.opportunityName || "查看关联商机"}</Link> : row.opportunityName || "未关联"}</InfoRow><InfoRow label="客户负责人">{row.ownerName || "—"}</InfoRow><InfoRow label="创建时间">{displayDate(row.createdAt, true)}</InfoRow>
      </dl></div></TabsContent>
      <TabsContent value="signing" className="mt-4"><div className="rounded-2xl border border-border bg-card p-5"><dl>
        <InfoRow label="我方签约主体">{row.signingSubject || "—"}</InfoRow><InfoRow label="合作方签约主体">{row.channelSubject || row.partnerName}</InfoRow><InfoRow label={ecosystem ? "合同经办人" : "合同签订人"}>{row.signer || "—"}</InfoRow>
        <InfoRow label="联系人姓名">{row.contactName || "—"}</InfoRow><InfoRow label="联系人电话">{row.contactPhone ? <a href={"tel:" + row.contactPhone} className="text-primary">{row.contactPhone}</a> : "—"}</InfoRow><InfoRow label="联系人邮箱">{row.contactEmail ? <a href={"mailto:" + row.contactEmail} className="break-all text-primary">{row.contactEmail}</a> : "—"}</InfoRow>
        <InfoRow label="双方签署日期">{displayDate(row.doubleSignedDate)}</InfoRow><InfoRow label="确认签约时间">{displayDate(row.signedAt, true)}</InfoRow>
      </dl></div></TabsContent>
      <TabsContent value="related" className="mt-4"><div className="rounded-2xl border border-border bg-card p-5"><dl><InfoRow label="生效日期">{displayDate(row.effectiveDate)}</InfoRow><InfoRow label="合同有效期">{row.termMonths ? row.termMonths + " 个月" : "—"}</InfoRow><InfoRow label="到期日期">{displayDate(row.endDate)}</InfoRow></dl></div></TabsContent>
      <TabsContent value="files" className="mt-4"><section className="rounded-2xl border border-border bg-card p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">合同附件</h2><p className="mt-1 text-xs text-muted-foreground">保存签署后的合同文件，支持查看和下载。</p></div>{canWrite && <Button variant="outline" onClick={() => setUploading(true)}><Upload className="size-4" />上传附件</Button>}</div>{files.length ? <div className="space-y-3">{files.map((file) => <CrmAttachmentRow key={file.id} attachment={{ ...file, size: file.size || 0, uploadedAt: displayDate(file.uploadedAt, true), uploadedBy: file.uploadedBy || "—" }} badge={{ label: contractLabel }} />)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">暂无扫描件，可点击「上传附件」添加。</p>}</section></TabsContent>
      <TabsContent value="history" className="mt-4"><div className="rounded-2xl border border-border bg-card p-5"><h2 className="mb-5 text-sm font-semibold">历史操作记录</h2><ChannelError message={historyError} /><ol className="ml-1 border-l pl-5">{history.map((event) => <li key={event.id} className="relative pb-6"><span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-primary/60" /><p className="whitespace-pre-wrap text-sm leading-6">{event.detail || event.action}</p><p className="mt-2 text-xs text-muted-foreground">{event.actorName} · {displayDate(event.createdAt, true)}</p></li>)}{!history.some((event) => ["contract_created", "contract_auto_created"].includes(event.action)) && <li className="relative"><span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-primary/60" /><p className="text-sm">创建合同</p><p className="mt-2 text-xs text-muted-foreground">{displayDate(row.createdAt, true)}</p></li>}</ol></div></TabsContent>
    </Tabs>
    {editing && <ChannelContractForm contract={row} partnerType={partnerType} partners={partners} opportunities={opportunities} onClose={() => setEditing(false)} onSaved={(updated) => { setRow(updated); setEditing(false); void load() }} />}
    {signing && <ChannelSignDialog contract={row} partnerId={row.partnerId} partnerName={row.partnerName} opportunityName={row.opportunityName || undefined} onClose={() => setSigning(false)} onSaved={() => { setSigning(false); void load() }} />}
    <AttachmentUploadDialog open={uploading} onOpenChange={setUploading} title={"上传" + contractLabel + "附件"} description="上传实际签署文件，并填写版本或用途说明。" onUploaded={async (items) => { try { const updated = await attachChannelContractFiles(row.id, items.map((item) => ({ id: item.id, description: item.description }))); setRow(updated); toast.success("合同扫描件已保存"); void load() } catch (caught) { toast.error(caught instanceof Error ? caught.message : "保存扫描件失败"); throw caught } }} />
  </div>
}

