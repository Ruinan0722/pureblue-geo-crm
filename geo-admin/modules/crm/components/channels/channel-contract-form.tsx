"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { Input } from "@/shared/ui/input"
import { DatePicker } from "@/shared/ui/date-picker"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { useSalesNames } from "@/modules/crm/hooks/use-directory-options"
import { CHANNEL_REGIONS } from "@/modules/crm/lib/crm-data"
import { channelContractEndDate } from "@/modules/crm/lib/channel-contract-utils"
import { createChannelContract, updateChannelContract, fetchChannelResource, type ChannelContact, type ChannelPartner, type ChannelOpportunityRow, type ChannelContractRow } from "@/modules/crm/services/channel-management"
import { ChannelError, ChannelModal, Field, NativeSelect, SaveButton, useChannelFormId } from "./channel-ui"

type Form = { partnerId: string; opportunityId: string; name: string; contractNumber: string; channelSubject: string; contactName: string; contactPhone: string; contactEmail: string; region: string; signingSubject: string; signer: string; status: string; projectStatus: string; effectiveDate: string; doubleSignedDate: string; termMonths: string }

export function ChannelContractForm({ partners, opportunities, contract, partnerType = "channel", partnerId = "", opportunityId = "", onClose, onSaved }: {
  partners: ChannelPartner[]; opportunities: ChannelOpportunityRow[]; contract?: ChannelContractRow
  partnerType?: "channel" | "strategic_ecosystem"; partnerId?: string; opportunityId?: string; onClose: () => void; onSaved: (row: ChannelContractRow) => void
}) {
  const { user } = useAuth()
  const ecosystem = (contract?.partnerType || partnerType) === "strategic_ecosystem"
  const contractLabel = ecosystem ? "战略生态合同" : "渠道合同"
  const partnerLabel = ecosystem ? "生态客户" : "渠道伙伴"
  const contractSuffix = ecosystem ? "-战略生态合作协议" : "-渠道合作协议"
  const formId = useChannelFormId()
  const [initial] = useState<Form>(() => {
    const partner = partners.find((row) => row.id === (contract?.partnerId || partnerId))
    const opp = opportunities.find((row) => row.id === (contract?.opportunityId || opportunityId) && row.partnerId === partner?.id)
    return {
      partnerId: partner?.id || "", opportunityId: contract?.opportunityId || opp?.id || "",
      name: contract?.name || (opp ? opp.name + contractSuffix : partner ? partner.name + contractSuffix : ""),
      contractNumber: contract?.contractNumber || "", channelSubject: contract?.channelSubject || partner?.name || "",
      contactName: contract?.contactName || "", contactPhone: contract?.contactPhone || "", contactEmail: contract?.contactEmail || "",
      region: contract?.region || partner?.region || "", signingSubject: contract?.signingSubject || "", signer: contract?.signer || user?.name || "",
      status: contract?.status || "准备签约", projectStatus: contract?.projectStatus || "无",
      effectiveDate: contract?.effectiveDate || "", doubleSignedDate: contract?.doubleSignedDate || "", termMonths: contract ? String(contract.termMonths ?? "") : "12",
    }
  })
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [error, setError] = useState("")
  const submitting = useRef(false)
  const { names } = useSalesNames([form.signer, user?.name || ""])
  const signed = contract?.status === "是"
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const opps = opportunities.filter((row) => row.partnerId === form.partnerId && (row.stage !== "输单" || row.id === contract?.opportunityId))
  function patch(key: keyof Form, value: string) { setForm((current) => ({ ...current, [key]: value })) }
  function changePartner(id: string) {
    const partner = partners.find((row) => row.id === id)
    setForm((current) => ({ ...current, partnerId: id, opportunityId: "", channelSubject: partner?.name || "", region: partner?.region || "", name: partner ? partner.name + contractSuffix : "", contactName: "", contactPhone: "", contactEmail: "" }))
  }
  useEffect(() => {
    if (!form.partnerId || contract) return
    let alive = true
    setContactsLoading(true)
    fetchChannelResource<ChannelContact[]>(form.partnerId, "contacts").then((rows) => {
      if (!alive) return
      const contact = rows.find((row) => row.isPrimary) || rows[0]
      if (contact) setForm((current) => ({ ...current, contactName: current.contactName || contact.name, contactPhone: current.contactPhone || contact.phone || "", contactEmail: current.contactEmail || (contact.method?.includes("@") ? contact.method : "") }))
    }).catch(() => { if (alive) toast.error("联系人信息未能自动带入，请手动填写或重新选择合作方。") })
      .finally(() => { if (alive) setContactsLoading(false) })
    return () => { alive = false }
  }, [form.partnerId, contract])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!form.partnerId || !form.name.trim() || (!contract && !form.opportunityId)) { setError("请选择" + partnerLabel + "与关联商机，并填写合同名称。"); return }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) { setError("请填写有效的联系人邮箱。"); return }
    if (form.termMonths && (!Number.isInteger(Number(form.termMonths)) || Number(form.termMonths) < 1 || Number(form.termMonths) > 1200)) { setError("合同有效期需为 1 至 1200 的整数。"); return }
    submitting.current = true; setBusy(true); setError("")
    const { partnerId: targetPartner, termMonths, ...fields } = form
    const body = { ...fields, opportunityId: fields.opportunityId || null, effectiveDate: fields.effectiveDate || null, doubleSignedDate: fields.doubleSignedDate || null, termMonths: termMonths ? Number(termMonths) : null }
    try {
      const row = contract ? await updateChannelContract(contract.id, body) : await createChannelContract(targetPartner, body)
      toast.success(contractLabel + (contract ? "已更新" : "已创建"))
      onSaved(row)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，填写内容已保留。") }
    finally { submitting.current = false; setBusy(false) }
  }
  return <ChannelModal open wide title={(contract ? "编辑" : "新增") + contractLabel} description="登记合同基本信息、签约信息及合同周期。" onClose={onClose} busy={busy} dirty={dirty} footer={<SaveButton busy={busy || contactsLoading} form={formId} label="保存合同" />}>
    <form id={formId} onSubmit={submit} noValidate className="space-y-5"><ChannelError message={error} />
      <fieldset disabled={busy} className="space-y-5"><Tabs defaultValue="basic">
        <TabsList className="flex w-full justify-start gap-1"><TabsTrigger value="basic">基本信息</TabsTrigger><TabsTrigger value="sign">签约信息</TabsTrigger><TabsTrigger value="period">合同周期</TabsTrigger></TabsList>
        <TabsContent value="basic" className="mt-4 space-y-4">
          <Field label="合同名称" required><Input maxLength={255} value={form.name} onChange={(e) => patch("name", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={partnerLabel} required><SearchableSelect value={form.partnerId} disabled={Boolean(contract)} onChange={changePartner} options={partners.map((row) => ({ value: row.id, label: row.name }))} placeholder={"选择" + partnerLabel} /></Field>
            <Field label="关联商机" required={!contract}><NativeSelect label="关联商机" value={form.opportunityId} disabled={signed || !form.partnerId} onChange={(id) => { const opp = opps.find((row) => row.id === id); setForm((current) => ({ ...current, opportunityId: id, name: !contract && opp ? opp.name + contractSuffix : current.name })) }} options={opps.map((row) => ({ value: row.id, label: row.name + " · " + row.stage }))} placeholder={form.partnerId ? "选择关联商机" : "请先选择合作方"} /></Field>
            <Field label="合同编号"><Input maxLength={128} placeholder="填写合同编号" value={form.contractNumber} onChange={(e) => patch("contractNumber", e.target.value)} /></Field>
            <Field label="合同类型"><Input value={contractLabel} disabled /></Field>
            <Field label="区域"><NativeSelect label="合同区域" value={form.region} onChange={(v) => patch("region", v)} options={Object.keys(CHANNEL_REGIONS)} /></Field>
            <Field label="合同状态"><NativeSelect label="合同状态" value={form.status} disabled={signed} onChange={(v) => patch("status", v)} options={signed ? [{ value: "是", label: "已签订" }] : [{ value: "准备签约", label: "待签订" }, { value: "走入库流程了", label: "入库中" }]} /></Field>
            <Field label="项目状态"><NativeSelect label="项目状态" value={form.projectStatus} onChange={(v) => patch("projectStatus", v)} options={["有", "无"]} /></Field>
          </div>
        </TabsContent>
        <TabsContent value="sign" className="mt-4"><div className="grid gap-4 sm:grid-cols-2">
          <Field label="我方签约主体"><Input maxLength={255} placeholder="我方签约公司全称" value={form.signingSubject} onChange={(e) => patch("signingSubject", e.target.value)} /></Field>
          <Field label="合作方签约主体"><Input maxLength={255} value={form.channelSubject} onChange={(e) => patch("channelSubject", e.target.value)} /></Field>
          <Field label="联系人姓名" hint={contactsLoading ? "正在带入主要联系人…" : undefined}><Input maxLength={128} value={form.contactName} onChange={(e) => patch("contactName", e.target.value)} /></Field>
          <Field label="联系人电话"><Input type="tel" maxLength={64} value={form.contactPhone} onChange={(e) => patch("contactPhone", e.target.value)} /></Field>
          <Field label="联系人邮箱"><Input type="email" maxLength={255} value={form.contactEmail} onChange={(e) => patch("contactEmail", e.target.value)} /></Field>
          <Field label={ecosystem ? "合同经办人" : "合同签订人"}><SearchableSelect value={form.signer} onChange={(v) => patch("signer", v)} options={toSelectOptions([...new Set([...names, form.signer].filter(Boolean))])} placeholder={ecosystem ? "选择合同经办人" : "选择合同签订人"} /></Field>
          <Field label="双方签署日期"><DatePicker value={form.doubleSignedDate} onChange={(v) => patch("doubleSignedDate", v)} /></Field>
        </div></TabsContent>
        <TabsContent value="period" className="mt-4"><div className="grid gap-4 sm:grid-cols-2">
          <Field label="生效日期"><DatePicker value={form.effectiveDate} onChange={(v) => patch("effectiveDate", v)} /></Field>
          <Field label="合同有效期（月）"><Input type="number" min={1} max={1200} step={1} value={form.termMonths} onChange={(e) => patch("termMonths", e.target.value)} /></Field>
          <Field label="到期日期" hint="根据生效日期和有效期自动计算。"><Input readOnly value={channelContractEndDate(form.effectiveDate, Number(form.termMonths))} placeholder="设置生效日期及有效期后计算" /></Field>
        </div></TabsContent>
      </Tabs></fieldset>
    </form>
  </ChannelModal>
}
