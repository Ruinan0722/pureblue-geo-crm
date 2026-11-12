"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { chinaDateISO } from "@/shared/lib/datetime"
import { ArrowRight, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { DatePicker } from "@/shared/ui/date-picker"
import { CHANNEL_CONTRACT_STATUSES, CHANNEL_OPPORTUNITY_STAGES } from "@/modules/crm/lib/crm-data"
import { channelOpportunityUrl, createChannelResource, generateChannelOpportunity, moveChannelOpportunity, signChannelContract, type ChannelContact, type ChannelContract, type ChannelOpportunity } from "@/modules/crm/services/channel-management"
import { ChannelBadge, ChannelError, ChannelModal, Field, NativeSelect, SaveButton, useChannelFormId } from "./channel-ui"

import { CreateOpportunityDialog } from "../opportunity-actions"
import { fetchChannel, type ChannelPartner } from "@/modules/crm/services/channel-management"

export function ChannelResourceDialog(props: Parameters<typeof LegacyChannelResourceDialog>[0]) {
  return props.resource === "opportunities" ? <PartnerOpportunityDialog {...props} /> : <LegacyChannelResourceDialog {...props} />
}
function PartnerOpportunityDialog({ partnerId, onClose, onSaved }: Parameters<typeof LegacyChannelResourceDialog>[0]) {
  const router = useRouter()
  const [partner, setPartner] = useState<ChannelPartner | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { let active = true; void fetchChannel(partnerId).then((value) => { if (active) setPartner(value) }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "加载失败") }); return () => { active = false } }, [partnerId])
  if (!partner) return <ChannelModal open title="创建商机" onClose={onClose} footer={null}><ChannelError message={error} /><p className="text-sm text-muted-foreground">{error ? "请关闭后重试" : "正在加载客户资料…"}</p></ChannelModal>
  return <CreateOpportunityDialog customerId="" partner={partner} open onOpenChange={(open) => { if (!open) onClose() }} onCreated={(id) => { onSaved(); router.push("/opportunities/" + encodeURIComponent(id)) }} />
}

export type ChannelResource = "contacts" | "follow-ups" | "opportunities" | "contracts"
const RESOURCE_LABELS: Record<ChannelResource, string> = { contacts: "添加联系人", "follow-ups": "记录跟进", opportunities: "生成渠道商机", contracts: "新建渠道合同" }

function LegacyChannelResourceDialog({ resource, partnerId, partnerName, partnerType = "channel", contacts, opportunities, onClose, onSaved }: {
  resource: ChannelResource; partnerId: string; partnerName: string; partnerType?: "channel" | "strategic_ecosystem"; contacts: ChannelContact[]; opportunities: ChannelOpportunity[]
  onClose: () => void; onSaved: () => void
}) {
  const formId = useChannelFormId()
  const router = useRouter()
  const { canAccess } = useAuth()
  const ecosystem = partnerType === "strategic_ecosystem"
  const [initialName] = useState(() => resource === "opportunities" ? partnerName.slice(0, 220) + (ecosystem ? "-战略生态合作-" : "-渠道合作-") + chinaDateISO().slice(0, 7).replace("-", "") : "")
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState("")
  const [method, setMethod] = useState("")
  const [department, setDepartment] = useState("")
  const [title, setTitle] = useState("")
  const [contactType, setContactType] = useState("strategic_ecosystem")
  const [primary, setPrimary] = useState(contacts.length === 0)
  const [content, setContent] = useState("")
  const [contactId, setContactId] = useState("")
  const [nextFollowAt, setNextFollowAt] = useState("")
  const [opportunityId, setOpportunityId] = useState("")
  const [status, setStatus] = useState("准备签约")
  const [contractNumber, setContractNumber] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)
  const dirty = Boolean(name !== initialName || phone || method || department || title || contactType !== "strategic_ecosystem" || content || contactId || nextFollowAt || opportunityId || contractNumber || status !== "准备签约" || primary !== (contacts.length === 0))
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!(resource === "follow-ups" ? content.trim() : name.trim())) {
      setError(resource === "follow-ups" ? "请填写本次跟进内容。" : "请填写名称。"); return
    }
    const body = resource === "contacts" ? { name: name.trim(), title: title.trim() || null, phone: phone.trim() || null, method: method.trim() || null, department: department.trim() || null, contactType: ecosystem ? contactType : "channel", isPrimary: primary }
      : resource === "follow-ups" ? { content: content.trim(), contactId: contactId || null, nextFollowAt: nextFollowAt || null }
      : resource === "opportunities" ? { name: name.trim() }
      : { name: name.trim(), status, opportunityId: opportunityId || null, contractNumber: contractNumber.trim() || null }
    submitting.current = true
    setBusy(true); setError("")
    try {
      let generatedOpportunityId: string | undefined
      if (resource === "opportunities") {
        const created = await generateChannelOpportunity(partnerId, name)
        generatedOpportunityId = created.id
        toast.success("商机已创建，已同步到商机管理", canAccess("opportunities") ? {
          duration: 8000,
          action: { label: "查看商机", onClick: () => router.push(channelOpportunityUrl(created.id, partnerType)) },
        } : undefined)
      } else {
        await createChannelResource(partnerId, resource, body)
        toast.success(resource === "follow-ups" ? "跟进已记录" : RESOURCE_LABELS[resource] + "成功")
      }
      onSaved()
      if (generatedOpportunityId && canAccess("opportunities")) {
        router.push(channelOpportunityUrl(generatedOpportunityId, partnerType))
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，填写内容已保留。") }
    finally { submitting.current = false; setBusy(false) }
  }
  return <ChannelModal open title={ecosystem && resource === "opportunities" ? "创建战略生态商机" : RESOURCE_LABELS[resource]} description={partnerName} onClose={onClose} dirty={dirty} busy={busy}
    footer={<SaveButton busy={busy} form={formId} label={resource === "follow-ups" ? "保存跟进" : resource === "opportunities" ? "创建商机" : "确认添加"} />}>
    <form id={formId} onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <ChannelError message={error} />
        {resource !== "follow-ups" && <Field label={resource === "contacts" ? "姓名" : resource === "opportunities" ? "商机名称" : "合同名称"} required>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={resource === "contacts" ? 128 : 255} required placeholder={resource === "contacts" ? "输入联系人姓名" : resource === "opportunities" ? "例如：华东区域代理合作" : "例如：年度渠道合作协议"} />
        </Field>}
        {resource === "contacts" && <>
          {ecosystem && <><div className="grid gap-4 sm:grid-cols-2"><Field label="联系人类型"><NativeSelect label="联系人类型" value={contactType} onChange={setContactType} options={[{ value: "direct", label: "直客对接" }, { value: "strategic_ecosystem", label: "战略生态对接" }]} /></Field><Field label="对接部门"><Input value={department} maxLength={128} placeholder="输入部门名称" onChange={(event) => setDepartment(event.target.value)} /></Field></div><Field label="职位"><Input value={title} maxLength={128} placeholder="输入职位" onChange={(event) => setTitle(event.target.value)} /></Field></>}
          <Field label="联系电话"><Input type="tel" value={phone} maxLength={64} placeholder="手机号或办公电话" onChange={(event) => setPhone(event.target.value)} /></Field>
          <Field label={ecosystem ? "邮箱" : "其他联系方式"}><Input type={ecosystem ? "email" : "text"} value={method} placeholder="微信、邮箱等" onChange={(event) => setMethod(event.target.value)} /></Field>
          <label className="flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm"><input className="size-4 accent-primary" type="checkbox" checked={primary} onChange={(event) => setPrimary(event.target.checked)} />设为主要联系人</label>
        </>}
        {resource === "follow-ups" && <>
          <Field label="跟进内容" required><Textarea autoFocus rows={5} className="min-h-32" value={content} required placeholder="记录沟通结果、合作意向和下一步行动…" onChange={(event) => setContent(event.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="沟通对象"><NativeSelect label="沟通对象" value={contactId} onChange={setContactId} placeholder={contacts.length ? "选择联系人（选填）" : "暂无联系人"} options={contacts.map((contact) => ({ value: contact.id, label: contact.name }))} /></Field>
            <Field label="下次跟进日期"><DatePicker aria-label="下次跟进日期" value={nextFollowAt} onChange={setNextFollowAt} placeholder="选择日期（选填）" /></Field>
          </div>
        </>}
        {resource === "opportunities" && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground"><p className="font-medium text-primary">生成后自动同步到商机管理</p><p>已关联{ecosystem ? "战略生态客户" : "渠道伙伴"}「{partnerName}」，初始阶段为「需求确认」。名称已自动填写，可按合作内容调整。</p></div>}
        {resource === "contracts" && <>
          <Field label="合同编号"><Input value={contractNumber} placeholder="选填" onChange={(event) => setContractNumber(event.target.value)} /></Field>
          <Field label="关联商机"><NativeSelect label="关联商机" value={opportunityId} onChange={setOpportunityId} placeholder="暂不关联" options={opportunities.map((item) => ({ value: item.id, label: item.name + " · " + item.stage }))} /></Field>
          <Field label="合同状态"><NativeSelect label="合同状态" value={status} onChange={setStatus} options={CHANNEL_CONTRACT_STATUSES.filter((item) => item !== "是" && item !== "否")} /></Field>
          <p className="text-xs leading-6 text-muted-foreground">签约后可在合同卡片中确认已签约，届时关联商机将更新为赢单。</p>
        </>}
      </fieldset>
    </form>
  </ChannelModal>
}

export type StageTarget = Pick<ChannelOpportunity, "id" | "name" | "stage"> & { partnerId: string }
export function ChannelStageDialog({ target, onClose, onSaved }: { target: StageTarget; onClose: () => void; onSaved: () => void }) {
  const index = CHANNEL_OPPORTUNITY_STAGES.findIndex((value) => value === target.stage)
  const initialStage = CHANNEL_OPPORTUNITY_STAGES[Math.min(index + 1, CHANNEL_OPPORTUNITY_STAGES.length - 1)] as string
  const [stage, setStage] = useState(initialStage)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const formId = useChannelFormId()
  const options = [...CHANNEL_OPPORTUNITY_STAGES.filter((value) => value !== target.stage && (value !== CHANNEL_OPPORTUNITY_STAGES[0] || index === 0)), "输单"]
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!stage || stage === target.stage) { setError("请选择新的商机阶段。"); return }
    if (stage === "输单" && !reason.trim()) { setError("请填写输单原因，方便后续复盘。"); return }
    setBusy(true); setError("")
    try {
      await moveChannelOpportunity(target.partnerId, target.id, { stage, lostReason: stage === "输单" ? reason.trim() : undefined })
      toast.success("商机阶段已更新为「" + stage + "」"); onSaved()
    } catch (caught) { setError(caught instanceof Error ? caught.message : "更新失败，请重试。") }
    finally { setBusy(false) }
  }
  return <ChannelModal open title="更新商机阶段" description={target.name} onClose={onClose} busy={busy} dirty={Boolean(reason || stage !== initialStage)}
    footer={<SaveButton busy={busy} form={formId} label="确认更新" />}>
    <form id={formId} onSubmit={submit} className="space-y-5">
      <ChannelError message={error} />
      <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-3"><ChannelBadge value={target.stage} kind="stage" /><ArrowRight className="size-4 text-muted-foreground" /><ChannelBadge value={stage} kind="stage" /></div>
      <Field label="目标阶段" required><NativeSelect label="目标阶段" value={stage} onChange={setStage} options={options} disabled={busy} required /></Field>
      {stage === "输单" && <Field label="输单原因" required><Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="例如：合作条件未达成一致…" required disabled={busy} /></Field>}
      {["赢单", "输单"].includes(stage) && <p className="text-xs leading-6 text-muted-foreground">该阶段表示商机结束，保存后将无法继续推进，请确认后提交。</p>}
    </form>
  </ChannelModal>
}

export function ChannelSignDialog({ contract, partnerId, partnerName, opportunityName, onClose, onSaved }: {
  contract: ChannelContract; partnerId: string; partnerName: string; opportunityName?: string; onClose: () => void; onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function sign() {
    if (busy) return
    setBusy(true); setError("")
    try { await signChannelContract(partnerId, contract.id); toast.success("已记录合同签约"); onSaved() }
    catch (caught) { setError(caught instanceof Error ? caught.message : "更新失败，请重试。") }
    finally { setBusy(false) }
  }
  return <ChannelModal open title="确认合同已签约" description="请在实际完成合同签署后确认。" busy={busy} onClose={onClose}
    footer={<Button onClick={() => void sign()} disabled={busy}><CheckCircle2 className="size-4" />{busy ? "正在保存…" : "确认已签约"}</Button>}>
    <div className="space-y-4">
      <ChannelError message={error} />
      <div className="space-y-3 rounded-xl border p-4"><h3 className="font-medium">{contract.name}</h3><p className="text-sm text-muted-foreground">{partnerName}</p>{contract.contractNumber && <p className="text-xs text-muted-foreground">合同编号：{contract.contractNumber}</p>}</div>
      <p className="text-sm leading-7 text-muted-foreground">确认后将记录签约时间{contract.opportunityId ? "，并将" + (opportunityName ? "「" + opportunityName + "」" : "关联商机") + "更新为赢单。" : "。"}</p>
    </div>
  </ChannelModal>
}

