"use client"
import { useEffect, useState } from "react"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { DatePicker } from "@/shared/ui/date-picker"
import { PROJECT_TYPES, PROJECT_STATUS_META } from "../../lib/crm-data"
import { fetchStaffDirectoryMembers } from "../../services/crm-directory"
import type { ChannelPartner, ChannelOpportunity } from "../../services/channel-management"
import { Field } from "./channel-ui"
import { InfoRow } from "../ui"

export const ECOSYSTEM_SUBTYPES = ["蓝色光标", "京东科技", "个人", "阿里汇川", "36氪", "知乎", "蓝色宇宙", "鲁班", "合肥蓝标", "上海蓝标", "北京蓝标", "蓝标新加坡", "SNK", "玄鸟", "新华网"]
export function ecosystemForm(partner?: ChannelPartner | null) {
  return {
    customerType: partner?.customerType || "", customerSubtype: partner?.customerSubtype || "",
    serviceContents: partner?.serviceContents || [], budgetAmount: partner?.budgetAmount != null ? String(partner.budgetAmount) : "",
    bdUserIds: partner?.bdUserIds || [], primaryOpportunityId: partner?.primaryOpportunityId || "",
    projectStatus: partner?.projectStatus || "", expectedSignMonth: partner?.expectedSignMonth?.slice(0, 7) || "",
    demandDescription: partner?.demandDescription || "", projectNotes: partner?.projectNotes || "",
    executionStatus: partner?.executionStatus || "", executionProduct: partner?.executionProduct || "",
    executionIntentCount: partner?.executionIntentCount != null ? String(partner.executionIntentCount) : "",
    executionPlatformCount: partner?.executionPlatformCount != null ? String(partner.executionPlatformCount) : "",
    executionPeriodMonths: partner?.executionPeriodMonths != null ? String(partner.executionPeriodMonths) : "",
    executionEndDate: partner?.executionEndDate?.slice(0, 10) || "",
  }
}
export type EcosystemForm = ReturnType<typeof ecosystemForm>
export function ecosystemBody(form: EcosystemForm) {
  const number = (value: string) => value === "" ? null : Number(value)
  return { ...form, budgetAmount: number(form.budgetAmount), expectedSignMonth: form.expectedSignMonth ? form.expectedSignMonth + "-01" : null,
    primaryOpportunityId: form.primaryOpportunityId || null, executionEndDate: form.executionEndDate || null,
    executionIntentCount: number(form.executionIntentCount), executionPlatformCount: number(form.executionPlatformCount), executionPeriodMonths: number(form.executionPeriodMonths) }
}
export function EcosystemFields({ section, form, onChange, opportunities = [], partner }: {
  section: "company" | "requirements" | "execution"; form: EcosystemForm; onChange: (value: Partial<EcosystemForm>) => void; opportunities?: ChannelOpportunity[]; partner?: ChannelPartner | null
}) {
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { if (section !== "requirements") return; let active = true; void fetchStaffDirectoryMembers().then((items) => { if (active) setMembers(items) }).catch(() => undefined); return () => { active = false } }, [section])
  const names = new Map(members.map((member) => [member.id, member.name]))
  ;(partner?.bdUserIds || []).forEach((id, index) => { if (!names.has(id)) names.set(id, partner?.bdNames?.[index] || id) })
  if (section === "company") return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="客户类型"><SearchableSelect allowCustom value={form.customerType} options={toSelectOptions(partner?.customerType ? [partner.customerType] : [])} onChange={(customerType) => onChange({ customerType })} placeholder="输入类型，回车确认" /></Field>
    <Field label="子类型"><SearchableSelect allowCustom value={form.customerSubtype} options={toSelectOptions(ECOSYSTEM_SUBTYPES)} onChange={(customerSubtype) => onChange({ customerSubtype })} placeholder="选择或补充合作伙伴类型" /></Field>
  </div>
  if (section === "requirements") return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="服务内容"><SearchableSelect multiple values={form.serviceContents} options={toSelectOptions([...new Set([...PROJECT_TYPES, ...form.serviceContents])])} onValuesChange={(serviceContents) => onChange({ serviceContents })} /></Field>
    <Field label="预算金额（元）"><Input type="number" min="0" step="0.01" value={form.budgetAmount} onChange={(e) => onChange({ budgetAmount: e.target.value })} /></Field>
    <Field label="BD"><SearchableSelect multiple values={form.bdUserIds} options={[...names].map(([value, label]) => ({ value, label }))} onValuesChange={(bdUserIds) => onChange({ bdUserIds })} placeholder="选择 BD，可多选" /></Field>
    <Field label="商机"><SearchableSelect value={form.primaryOpportunityId} options={opportunities.map((opp) => ({ value: opp.id, label: opp.name }))} onChange={(primaryOpportunityId) => onChange({ primaryOpportunityId })} placeholder={partner ? "选择关联商机" : "创建档案后可创建并关联商机"} disabled={!partner} /></Field>
    <Field label="项目状态"><SearchableSelect allowCustom value={form.projectStatus} options={Object.entries(PROJECT_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} onChange={(projectStatus) => onChange({ projectStatus })} /></Field>
    <Field label="预计签约月"><Input type="month" value={form.expectedSignMonth} onChange={(e) => onChange({ expectedSignMonth: e.target.value })} /></Field>
    <div className="sm:col-span-2"><Field label="需求描述"><Textarea rows={3} value={form.demandDescription} onChange={(e) => onChange({ demandDescription: e.target.value })} /></Field></div>
    <div className="sm:col-span-2"><Field label="项目备注"><Textarea rows={3} value={form.projectNotes} onChange={(e) => onChange({ projectNotes: e.target.value })} /></Field></div>
  </div>
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="执行状态"><SearchableSelect value={form.executionStatus} options={toSelectOptions(["执行中", "执行完成"])} onChange={(executionStatus) => onChange({ executionStatus })} /></Field>
    <Field label="执行本品"><Input value={form.executionProduct} onChange={(e) => onChange({ executionProduct: e.target.value })} /></Field>
    <Field label="执行意图数"><Input type="number" min="0" step="1" value={form.executionIntentCount} onChange={(e) => onChange({ executionIntentCount: e.target.value })} /></Field>
    <Field label="执行平台数"><Input type="number" min="0" step="1" value={form.executionPlatformCount} onChange={(e) => onChange({ executionPlatformCount: e.target.value })} /></Field>
    <Field label="执行周期（月）"><Input type="number" min="0" max="1200" step="1" value={form.executionPeriodMonths} onChange={(e) => onChange({ executionPeriodMonths: e.target.value })} /></Field>
    <Field label="执行结束日期"><DatePicker value={form.executionEndDate} onChange={(executionEndDate) => onChange({ executionEndDate })} /></Field>
  </div>
}

export function EcosystemInfo({ section, partner, opportunities }: { section: "requirements" | "execution"; partner: ChannelPartner; opportunities: ChannelOpportunity[] }) {
  const primary = opportunities.find((opp) => opp.id === partner.primaryOpportunityId)
  const rows: [string, string | number | null | undefined][] = section === "requirements" ? [
    ["服务内容", partner.serviceContents?.join("、")], ["预算金额（元）", partner.budgetAmount], ["BD", partner.bdNames?.join("、")],
    ["商机", primary?.name], ["项目状态", partner.projectStatus ? PROJECT_STATUS_META[partner.projectStatus as keyof typeof PROJECT_STATUS_META]?.label || partner.projectStatus : null],
    ["预计签约月", partner.expectedSignMonth?.slice(0, 7)], ["需求描述", partner.demandDescription], ["项目备注", partner.projectNotes],
  ] : [["执行状态", partner.executionStatus], ["执行本品", partner.executionProduct], ["执行意图数", partner.executionIntentCount], ["执行平台数", partner.executionPlatformCount], ["执行周期（月）", partner.executionPeriodMonths], ["执行结束日期", partner.executionEndDate?.slice(0, 10)]]
  return <dl className="rounded-2xl border bg-card p-5">{rows.map(([label, value]) => <InfoRow key={label} label={label}><span className="whitespace-pre-wrap">{value ?? "—"}</span></InfoRow>)}</dl>
}
