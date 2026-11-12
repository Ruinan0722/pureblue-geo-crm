"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Input } from "@/shared/ui/input"
import { Button } from "@/shared/ui/button"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { INDUSTRIES } from "../../lib/crm-data"
import { fetchStaffDirectoryMembers } from "../../services/crm-directory"
import { createChannel, updateChannel, type ChannelPartner } from "../../services/channel-management"
import { ChannelError, ChannelModal, Field, NativeSelect, SaveButton, useChannelFormId } from "./channel-ui"

import { ECOSYSTEM_SOURCES, ecosystemSource } from "../../lib/ecosystem-sources"
const blankContact = { name: "", phone: "", email: "" }

export function EcosystemPartnerDialog({ partner, onClose, onSaved }: {
  partner?: ChannelPartner | null; onClose: () => void; onSaved: (row: ChannelPartner) => void
}) {
  const formId = useChannelFormId()
  const [initial] = useState(() => ({
    brandName: partner?.brandName || "", name: partner?.name || "", city: partner?.city || "",
    industry: partner?.industries[0] || "", ...ecosystemSource(partner?.source, partner?.sourceDetail),
    ecosystemDepartment: partner?.ecosystemDepartment || "", bdUserIds: partner?.bdUserIds || [],
  }))
  const [form, setForm] = useState(initial)
  const secondaryOptions = ECOSYSTEM_SOURCES[form.source] || []
  const [contacts, setContacts] = useState([blankContact])
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [directoryError, setDirectoryError] = useState(false)
  useEffect(() => {
    let active = true
    void fetchStaffDirectoryMembers().then((rows) => { if (active) setMembers(rows) }).catch(() => { if (active) setDirectoryError(true) })
    return () => { active = false }
  }, [])
  const bdOptions = new Map((partner?.bdUserIds || []).map((id, index) => [id, partner?.bdNames?.[index] || id]))
  members.forEach((member) => bdOptions.set(member.id, member.name))
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }))
    setError("")
  }
  function setContact(index: number, field: keyof typeof blankContact, value: string) {
    setContacts((previous) => previous.map((contact, i) => i === index ? { ...contact, [field]: value } : contact))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!form.brandName.trim() || !form.industry || !form.source || (secondaryOptions.length > 0 && !form.sourceDetail.trim()) || !form.ecosystemDepartment.trim() || !form.bdUserIds.length) {
      setError("请填写品牌、行业、项目来源、BD 负责人和对接部门。")
      return
    }
    if (!partner && contacts.some((contact) => !contact.name.trim())) {
      setError("请填写每位对接人的姓名，或移除空白对接人。")
      return
    }
    setBusy(true); setError("")
    try {
      const body = {
        partnerType: "strategic_ecosystem", brandName: form.brandName.trim(), name: form.name.trim(),
        industries: [form.industry], city: form.city.trim() || null, source: form.source,
        sourceDetail: form.sourceDetail.trim() || null, ecosystemDepartment: form.ecosystemDepartment.trim(),
        bdUserIds: form.bdUserIds, ...(!partner ? { ecosystemContacts: contacts } : {}),
      }
      const saved = partner ? await updateChannel(partner.id, body) : await createChannel(body)
      onSaved(partner ? { ...saved, contractStatus: partner.contractStatus } : saved)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，请重试。") }
    finally { setBusy(false) }
  }
  return <ChannelModal open wide onClose={onClose} busy={busy}
    dirty={JSON.stringify(initial) !== JSON.stringify(form) || JSON.stringify(contacts) !== JSON.stringify([blankContact])}
    title={partner ? "编辑生态客户" : "新建生态客户"}
    description={partner ? "战略生态对接人可在详情的「对接人」页维护。" : "填写基本档案和战略生态对接人。"}
    footer={<SaveButton form={formId} busy={busy} label={partner ? "保存修改" : "创建生态客户"} />}>
    <form id={formId} onSubmit={submit}>
      <fieldset disabled={busy} className="space-y-5">
        <ChannelError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="品牌名称" required><Input autoFocus required maxLength={255} value={form.brandName} onChange={(e) => set("brandName", e.target.value)} /></Field>
          <Field label="公司名称（选填）"><Input maxLength={255} value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="行业" required><SearchableSelect value={form.industry} onChange={(v) => set("industry", v)} options={toSelectOptions([...new Set([...Object.keys(INDUSTRIES), ...Object.values(INDUSTRIES).flat(), ...(initial.industry ? [initial.industry] : [])])])} placeholder="选择行业" /></Field>
          <Field label="城市（选填）"><Input maxLength={128} value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="项目来源（一级）" required><NativeSelect label="项目来源（一级）" value={form.source} options={Object.keys(ECOSYSTEM_SOURCES)} required onChange={(source) => {
            setForm((current) => ({ ...current, source, sourceDetail: current.source ? "" : current.sourceDetail }))
            setError("")
          }} /></Field>
          <Field label="项目来源（二级）" required={secondaryOptions.length > 0}><SearchableSelect key={form.source} allowCustom disabled={!form.source}
            value={form.sourceDetail} options={toSelectOptions([...new Set([...secondaryOptions, ...(form.sourceDetail ? [form.sourceDetail] : [])])])}
            onChange={(value) => set("sourceDetail", value)} placeholder="选择预设项，或输入自定义值后按回车" /></Field>
          <Field label="BD 负责人" required><SearchableSelect multiple values={form.bdUserIds} onValuesChange={(ids) => set("bdUserIds", ids)} options={[...bdOptions].map(([value, label]) => ({ value, label }))} placeholder="选择在职人员，可多选" /></Field>
          <Field label="战略生态对接部门" required><Input required maxLength={128} value={form.ecosystemDepartment} onChange={(e) => set("ecosystemDepartment", e.target.value)} /></Field>
        </div>
        {directoryError && <p role="status" className="text-sm text-muted-foreground">通讯录加载失败，请重新打开表单再试。</p>}
        {!partner && <section className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">战略生态对接人 *</h3><Button type="button" size="sm" variant="outline" disabled={contacts.length >= 50} onClick={() => setContacts((rows) => [...rows, blankContact])}>添加对接人</Button></div>
          {contacts.map((contact, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label="姓名" required><Input required maxLength={128} value={contact.name} onChange={(e) => setContact(index, "name", e.target.value)} /></Field>
            <Field label="电话"><Input type="tel" maxLength={64} value={contact.phone} onChange={(e) => setContact(index, "phone", e.target.value)} /></Field>
            <Field label="邮箱"><Input type="email" maxLength={255} value={contact.email} onChange={(e) => setContact(index, "email", e.target.value)} /></Field>
            {contacts.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setContacts((rows) => rows.filter((_, i) => i !== index))}>移除</Button>}
          </div>)}
        </section>}
      </fieldset>
    </form>
  </ChannelModal>
}
