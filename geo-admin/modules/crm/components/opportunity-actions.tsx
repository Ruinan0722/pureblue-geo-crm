"use client"

import { useCrm } from "@/modules/crm/context/crm-provider"
import { useDepartmentMemberNames } from "@/modules/crm/hooks/use-directory-options"
import {
buildOpportunityName,
isOppStageRollback,
LOST_REASON_OPTIONS,
LOST_REASONS,
LOST_STAGES,
OPP_STAGE_META,
OPT_PERIODS,
PROJECT_TYPES,
REGIONS,
type LostReasonL1,
type Opportunity,
type OppStage
} from "@/modules/crm/lib/crm-data"
import { MSG_OPP_NO_ROLLBACK_TO_CONTACT } from "@/modules/crm/lib/opportunity-request-gate"
import { chinaDateISO } from "@/shared/lib/datetime"
import { Button } from "@/shared/ui/button"
import { DatePicker } from "@/shared/ui/date-picker"
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import { SearchableSelect,toSelectOptions } from "@/shared/ui/searchable-select"
import { Textarea } from "@/shared/ui/textarea"
import { useEffect,useState } from "react"
import { toast } from "sonner"

import type { ChannelPartner } from "@/modules/crm/services/channel-management"

const OPPORTUNITY_NAME_RULE = "客户简称-子公司简称/总部-项目类型-YYYYMM"
const OPPORTUNITY_NAME_PATTERN = /^[^-]+-[^-]+-[^-]+-\d{6}$/

function validOpportunityName(name: string) {
  return OPPORTUNITY_NAME_PATTERN.test(name.trim())
}

export function CreateOpportunityDialog({
  customerId,
  partner,
  open,
  onOpenChange,
  onCreated,
}: {
  customerId: string
  partner?: ChannelPartner
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (oppId: string) => void
}) {
  const { getCustomer, createOpportunity } = useCrm()
  const customer = partner ? { companyName: partner.name, brandName: partner.brandName || partner.name, subsidiaries: [] as { id: string; name: string; shortName?: string }[] } : getCustomer(customerId)
  const [form, setForm] = useState({
    name: "",
    subsidiaryId: "",
    projectTypes: partner?.serviceContents?.filter((value) => (PROJECT_TYPES as readonly string[]).includes(value)) ?? [] as string[],
    period: OPT_PERIODS[1] as string,
    amount: partner?.budgetAmount != null ? String(partner.budgetAmount) : "",
    expectedSignDate: partner?.expectedSignMonth?.slice(0, 10) || "",
  })
  /** 用户手动改过名称后，不再随主体/类型自动覆盖 */
  const [nameManual, setNameManual] = useState(false)
  const [creating, setCreating] = useState(false)

  const selectedSubsidiary = customer?.subsidiaries?.find((item) => item.id === form.subsidiaryId)
  const namePreview = buildOpportunityName(
    customer?.brandName || customer?.companyName || "客户",
    selectedSubsidiary?.shortName || selectedSubsidiary?.name,
    form.projectTypes,
  )

  function applyRuleName(next: Partial<typeof form> = {}) {
    if (!customer) return
    const subsidiaryId = next.subsidiaryId ?? form.subsidiaryId
    const projectTypes = next.projectTypes ?? form.projectTypes
    const subsidiary = customer.subsidiaries?.find((item) => item.id === subsidiaryId)
    const name = buildOpportunityName(
      customer.brandName || customer.companyName,
      subsidiary?.shortName || subsidiary?.name,
      projectTypes,
    )
    setForm((f) => ({ ...f, ...next, name }))
    setNameManual(false)
  }

  function toggleType(t: string) {
    const projectTypes = form.projectTypes.includes(t)
      ? form.projectTypes.filter((x) => x !== t)
      : [...form.projectTypes, t]
    if (nameManual) setForm((f) => ({ ...f, projectTypes }))
    else applyRuleName({ projectTypes })
  }

  async function submit() {
    if (!customer || creating) return
    if (!form.name.trim()) {
      toast.error("请填写商机名称")
      return
    }
    if (!validOpportunityName(form.name)) {
      toast.error(`商机名称需符合：${OPPORTUNITY_NAME_RULE}`)
      return
    }
    if (form.projectTypes.length === 0) {
      toast.error("请至少选择一个项目类型")
      return
    }
    setCreating(true)
    try {
    const oid = await createOpportunity(customerId, {
      businessType: partner?.partnerType ?? "direct", partnerId: partner?.id, partnerName: partner?.name,
      brandName: partner?.brandName || partner?.name, region: partner?.region || undefined, owner: partner?.ownerName || undefined,
      name: form.name.trim(),
      subsidiaryId: form.subsidiaryId || undefined,
      projectTypes: form.projectTypes,
      period: form.period,
      amount: Number(form.amount) || 0,
      expectedSignDate: form.expectedSignDate,
    })
    onOpenChange(false)
    toast.success("商机已创建")
    onCreated?.(oid)
    } catch { /* The shared provider displays the API validation error. Keep the form. */ }
    finally { setCreating(false) }
  }

  if (!customer) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建商机</DialogTitle>
          <DialogDescription>为客户「{customer.brandName || customer.companyName}」创建商机，统一在商机管理中推进。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-medium text-primary">统一命名规则</p>
            <p className="mt-1 text-xs text-muted-foreground">{OPPORTUNITY_NAME_RULE}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">先选业务主体与项目类型，名称会自动生成；也可手工微调。</p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">商机业务主体</label>
            <SearchableSelect
              value={form.subsidiaryId}
              onChange={(subsidiaryId) => {
                if (nameManual) setForm((f) => ({ ...f, subsidiaryId }))
                else applyRuleName({ subsidiaryId })
              }}
              options={[
                { value: "", label: `${customer.companyName}（一级公司 / 总部）` },
                ...(customer.subsidiaries ?? []).map((subsidiary) => ({
                  value: subsidiary.id,
                  label: subsidiary.shortName || subsidiary.name,
                })),
              ]}
              placeholder="选择或搜索业务主体"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">项目类型（可多选）</label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_TYPES.map((p) => {
                const active = form.projectTypes.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggleType(p)}
                    className={
                      active
                        ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                        : "rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/50"
                    }
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs text-muted-foreground">商机名称</label>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => applyRuleName()}>
                按规则重新生成
              </button>
            </div>
            <Input
              value={form.name}
              onChange={(e) => {
                setNameManual(true)
                setForm({ ...form, name: e.target.value })
              }}
              placeholder={namePreview}
              className={!form.name || validOpportunityName(form.name) ? "" : "border-destructive"}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {nameManual ? "已手动修改；需要时可点右上角按规则重新生成。" : "随主体与项目类型自动更新。"}
            </p>
            {form.name && !validOpportunityName(form.name) && (
              <p className="mt-1 text-xs text-destructive">格式不符合规则，请按四段式名称填写。</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">优化周期</label>
            <SearchableSelect
              value={form.period}
              onChange={(period) => setForm({ ...form, period })}
              options={toSelectOptions(OPT_PERIODS)}
              placeholder="选择或搜索周期"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">商机金额（元）</label>
              <Input
                inputMode="numeric"
                placeholder="例如：260000"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">预计签约日期</label>
              <DatePicker
                value={form.expectedSignDate}
                onChange={(expectedSignDate) => setForm({ ...form, expectedSignDate })}
                placeholder="选择预计签约日"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={creating}>{creating ? "创建中…" : "创建商机"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LostOpportunityDialog({
  oppId,
  open,
  onOpenChange,
}: {
  oppId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { markOppLost } = useCrm()
  const [lostStage, setLostStage] = useState(LOST_STAGES[3] as string)
  const [lostReasonL1, setLostReasonL1] = useState<LostReasonL1>(LOST_REASONS[0])
  const [lostReasonL2, setLostReasonL2] = useState<string>(LOST_REASON_OPTIONS[LOST_REASONS[0]][0])
  const [competitor, setCompetitor] = useState("")

  async function submit() {
    if (!lostReasonL1 || !lostReasonL2) {
      toast.error("请选择输单一级原因和二级原因")
      return
    }
    await markOppLost(oppId, { lostStage, lostReasonL1, lostReasonL2, competitor: competitor.trim() })
    onOpenChange(false)
    toast.success("商机已标记为输单")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>标记输单</DialogTitle>
          <DialogDescription>请填写输单信息，用于复盘与赢率分析。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">输单阶段</label>
            <SearchableSelect
              value={lostStage}
              onChange={setLostStage}
              options={toSelectOptions(LOST_STAGES)}
              placeholder="选择或搜索阶段"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">竞争对手</label>
            <Input placeholder="如无可留空" value={competitor} onChange={(e) => setCompetitor(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">输单一级原因 <span className="text-destructive">*</span></label>
            <SearchableSelect
              value={lostReasonL1}
              onChange={(next) => {
                const l1 = next as LostReasonL1
                setLostReasonL1(l1)
                setLostReasonL2(LOST_REASON_OPTIONS[l1][0])
              }}
              options={toSelectOptions(LOST_REASONS)}
              placeholder="选择或搜索原因"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">输单二级原因 <span className="text-destructive">*</span></label>
            <SearchableSelect
              value={lostReasonL2}
              onChange={setLostReasonL2}
              options={toSelectOptions(LOST_REASON_OPTIONS[lostReasonL1])}
              placeholder="选择或搜索二级原因"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={submit}>
            确认输单
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdvanceOpportunityDialog({
  opp,
  targetStage,
  open,
  onOpenChange,
}: {
  opp: Opportunity
  targetStage: OppStage
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { setOppStage } = useCrm()
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const gateMessage = targetStage === "contact" && opp.stage !== "contact" ? MSG_OPP_NO_ROLLBACK_TO_CONTACT : null
  const fromLabel = OPP_STAGE_META[opp.stage]?.label ?? opp.stage
  const toLabel = OPP_STAGE_META[targetStage]?.label ?? targetStage
  const isRollback = isOppStageRollback(opp.stage, targetStage)
  async function submit() {
    if (gateMessage) {
      toast.error(gateMessage)
      return
    }
    if (!reason.trim()) {
      toast.error(isRollback ? "请输入回退原因" : "请输入变更原因")
      return
    }
    setSubmitting(true)
    try {
      const saved = await setOppStage(opp.id, targetStage, reason.trim())
      onOpenChange(false)
      setReason("")
      const actualStage = saved.stage
      const actualLabel = OPP_STAGE_META[actualStage]?.label ?? actualStage
      if (actualStage !== targetStage) {
        toast.error(`回退未生效：商机仍在「${actualLabel}」`, {
          description: `目标为「${toLabel}」。请刷新页面后重试。`,
        })
        return
      }
      if (isRollback) {
        toast.success(`已回退至「${toLabel}」`)
      } else if (targetStage === "signing") {
        toast.success("已进入签署中，系统已自动生成待签订合同")
      } else if (targetStage === "won") {
        toast.success("商机已赢单")
      } else {
        toast.success(`已推进至「${toLabel}」`)
      }
    } catch {
      /* CrmProvider 已 toast */
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("")
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRollback ? `回退至「${toLabel}」` : `推进至「${toLabel}」`}
          </DialogTitle>
          <DialogDescription>
            「{opp.name}」状态将由「{fromLabel}」{isRollback ? "回退" : "变更"}至「{toLabel}」，请输入
            {isRollback ? "回退" : "变更"}原因。
          </DialogDescription>
        </DialogHeader>
        {gateMessage && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {gateMessage}
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {isRollback ? "回退原因" : "变更原因"} <span className="text-destructive">*</span>
          </label>
          <Textarea
            rows={4}
            placeholder={
              isRollback
                ? "例如：客户需求变更，需重新确认范围后再推进…"
                : "例如：客户已确认需求范围，进入方案确认阶段…"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            disabled={Boolean(gateMessage)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={submitting || Boolean(gateMessage)}
            onClick={submit}
            variant={isRollback ? "secondary" : "default"}
          >
            {isRollback ? "确认回退" : "确认推进"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EditOpportunityDialog({
  opp,
  open,
  onOpenChange,
}: {
  opp: Opportunity
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { updateOpportunity, getCustomer } = useCrm()
  const customer = getCustomer(opp.customerId)
  const [form, setForm] = useState({
    name: opp.name || "",
    subsidiaryId: opp.subsidiaryId || "",
    brandName: opp.brandName || "",
    region: opp.region || "",
    projectTypes: opp.projectTypes,
    period: opp.period,
    amount: opp.amount ? String(opp.amount) : "",
    probability: opp.probability != null ? String(opp.probability) : "",
    expectedSignDate: opp.expectedSignDate || "",
    nextFollowAt: (opp.nextFollowAt || "").slice(0, 10),
    advisor: opp.advisor || "演示成员13",
    customerSuccess: opp.customerSuccess || "",
  })
  const { names: advisorOptions } = useDepartmentMemberNames(
    // 售前顾问候选 = 组织架构树「解决方案部门」成员（演示成员13等，角色为销售而非 presales）
    { departmentNames: ["解决方案部"] },
    form.advisor ? [form.advisor] : [],
  )
  const { names: customerSuccessOptions } = useDepartmentMemberNames(
    { departmentNames: ["客户成功"] },
    form.customerSuccess ? [form.customerSuccess] : [],
  )

  useEffect(() => {
    if (!open) return
    setForm({
      name: opp.name || "",
      subsidiaryId: opp.subsidiaryId || "",
      brandName: opp.brandName || "",
      region: opp.region || "",
      projectTypes: opp.projectTypes,
      period: opp.period,
      amount: opp.amount ? String(opp.amount) : "",
      probability: opp.probability != null ? String(opp.probability) : "",
      expectedSignDate: opp.expectedSignDate || "",
      nextFollowAt: (opp.nextFollowAt || "").slice(0, 10),
      advisor: opp.advisor || "演示成员13",
      customerSuccess: opp.customerSuccess || "",
    })
  }, [open, opp])

  function toggleType(t: string) {
    setForm((f) => ({
      ...f,
      projectTypes: f.projectTypes.includes(t) ? f.projectTypes.filter((x) => x !== t) : [...f.projectTypes, t],
    }))
  }

  function submit() {
    if (!validOpportunityName(form.name)) {
      toast.error(`商机名称需符合：${OPPORTUNITY_NAME_RULE}`)
      return
    }
    if (form.projectTypes.length === 0) {
      toast.error("请至少选择一个项目类型")
      return
    }
    const nextFollowAt = form.nextFollowAt.slice(0, 10)
    const minFollowDate = chinaDateISO()
    if (nextFollowAt && nextFollowAt < minFollowDate) {
      toast.error("下次计划跟进不能早于今天")
      return
    }
    const subsidiary = customer?.subsidiaries?.find((item) => item.id === form.subsidiaryId)
    updateOpportunity(opp.id, {
      name: form.name.trim(),
      subsidiaryId: subsidiary?.id,
      subsidiaryName: subsidiary?.name,
      brandName: form.brandName.trim(),
      region: form.region,
      projectTypes: form.projectTypes,
      period: form.period,
      amount: Number(form.amount) || 0,
      probability: Math.max(0, Math.min(100, Number(form.probability) || 0)),
      expectedSignDate: form.expectedSignDate,
      nextFollowAt,
      advisor: form.advisor.trim(),
      customerSuccess: form.customerSuccess.trim(),
    })
    onOpenChange(false)
    toast.success("商机信息已更新")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑商机字段</DialogTitle>
          <DialogDescription>
            修改商机基本信息、顾问/客户成功绑定、项目类型、金额概率与跟进计划。日常跟进请在详情页「跟进记录」中记录。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs font-medium text-primary">统一命名规则</p>
            <p className="mt-1 text-xs text-muted-foreground">{OPPORTUNITY_NAME_RULE}</p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs text-muted-foreground">商机名称</label>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() =>
                  setForm({
                    ...form,
                    name: buildOpportunityName(
                      customer?.brandName || customer?.companyName || opp.brandName,
                      customer?.subsidiaries?.find((item) => item.id === form.subsidiaryId)?.shortName,
                      form.projectTypes,
                      opp.createdAt,
                    ),
                  })
                }
              >
                按规则重新生成
              </button>
            </div>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={validOpportunityName(form.name) ? "" : "border-destructive"}
            />
            {!validOpportunityName(form.name) && <p className="mt-1 text-xs text-destructive">格式不符合统一命名规则。</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">售前顾问</label>
              <SearchableSelect
                value={form.advisor || "__none__"}
                onChange={(v) => setForm({ ...form, advisor: !v || v === "__none__" ? "" : v })}
                options={[
                  { value: "__none__", label: "未指定" },
                  ...advisorOptions.map((n) => ({ value: n, label: n })),
                ]}
                placeholder="选择售前顾问"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">客户成功</label>
              <SearchableSelect
                value={form.customerSuccess || "__none__"}
                onChange={(v) => setForm({ ...form, customerSuccess: !v || v === "__none__" ? "" : v })}
                options={[
                  { value: "__none__", label: "未指定" },
                  ...customerSuccessOptions.map((n) => ({ value: n, label: n })),
                ]}
                placeholder="选择客户成功"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">商机业务主体</label>
            <SearchableSelect
              value={form.subsidiaryId}
              onChange={(subsidiaryId) => setForm({ ...form, subsidiaryId })}
              options={[
                { value: "", label: `${customer?.companyName || "一级公司"}（总部）` },
                ...(customer?.subsidiaries ?? []).map((subsidiary) => ({
                  value: subsidiary.id,
                  label: subsidiary.shortName || subsidiary.name,
                })),
              ]}
              placeholder="选择或搜索业务主体"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">品牌</label>
              <Input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">区域</label>
              <SearchableSelect
                value={form.region}
                onChange={(region) => setForm({ ...form, region })}
                options={toSelectOptions(REGIONS)}
                placeholder="选择区域"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">项目类型（可多选）</label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_TYPES.map((p) => {
                const active = form.projectTypes.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggleType(p)}
                    className={
                      active
                        ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                        : "rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/50"
                    }
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">优化周期</label>
              <SearchableSelect
                value={form.period}
                onChange={(period) => setForm({ ...form, period })}
                options={toSelectOptions(OPT_PERIODS)}
                placeholder="选择或搜索周期"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">成交概率（%）</label>
              <Input
                inputMode="numeric"
                value={form.probability}
                onChange={(e) => setForm({ ...form, probability: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">商机金额（元）</label>
              <Input
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">预计签约日期</label>
              <DatePicker
                value={form.expectedSignDate}
                onChange={(expectedSignDate) => setForm({ ...form, expectedSignDate })}
                placeholder="选择预计签约日"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">下次计划跟进</label>
            <DatePicker
              value={form.nextFollowAt}
              min={chinaDateISO()}
              onChange={(v) => {
                const day = (v || "").slice(0, 10)
                if (day && day < chinaDateISO()) {
                  toast.error("下次计划跟进不能早于今天")
                  setForm({ ...form, nextFollowAt: chinaDateISO() })
                  return
                }
                setForm({ ...form, nextFollowAt: day })
              }}
              placeholder="不填表示未安排"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">与客户管理一致；日常计划建议在跟进记录中设置。</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 分配售前顾问：由解决方案部负责分配的人员（如演示成员13）将商机指派给具体解决方案成员。 */
export function AssignAdvisorDialog({
  opp,
  open,
  onOpenChange,
}: {
  opp: Opportunity
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { updateOpportunity } = useCrm()
  const [advisor, setAdvisor] = useState(opp.advisor || "")
  const [solutionLink, setSolutionLink] = useState(opp.solutionLink || "")
  const [expectedSolutionDate, setExpectedSolutionDate] = useState(opp.expectedSolutionDate || "")
  const [saving, setSaving] = useState(false)
  const domestic = opp.geoSource === "domestic"
  const { names: advisorOptions } = useDepartmentMemberNames(
    { departmentNames: ["解决方案部"] },
    advisor ? [advisor] : [],
  )

  useEffect(() => {
    if (!open) return
    setAdvisor(opp.advisor || "")
    setSolutionLink(opp.solutionLink || "")
    setExpectedSolutionDate(opp.expectedSolutionDate || "")
    setSaving(false)
  }, [open, opp.advisor, opp.solutionLink, opp.expectedSolutionDate])

  async function submit() {
    const target = advisor.trim()
    if (!target) {
      toast.error("请选择要分配的售前顾问")
      return
    }
    if (domestic && !solutionLink.trim()) {
      toast.error("国内商机分配售前顾问前，请填写方案链接")
      return
    }
    if (domestic && !expectedSolutionDate) {
      toast.error("国内商机分配售前顾问前，请填写预计出方案时间")
      return
    }
    setSaving(true)
    try {
      await updateOpportunity(opp.id, {
        advisor: target,
        ...(domestic ? { solutionLink: solutionLink.trim(), expectedSolutionDate } : {}),
      })
      onOpenChange(false)
      toast.success(`已分配售前顾问：${target}`)
    } catch {
      // updateOpportunity 内部已提示错误
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分配售前顾问</DialogTitle>
          <DialogDescription>
            将商机「{opp.name}」分配给解决方案部成员，由其跟进顾问反馈。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">售前顾问</label>
            <SearchableSelect
              value={advisor || "__none__"}
              onChange={(v) => setAdvisor(!v || v === "__none__" ? "" : v)}
              options={[
                { value: "__none__", label: "未指定" },
                ...advisorOptions.map((n) => ({ value: n, label: n })),
              ]}
              placeholder="选择解决方案成员"
            />
          </div>
          {domestic && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs text-amber-800">国内商机分配售前顾问需补充方案交付信息</p>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">方案链接 <span className="text-destructive">*</span></label>
                <Input value={solutionLink} onChange={(e) => setSolutionLink(e.target.value)} placeholder="粘贴方案文档链接" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">预计出方案时间 <span className="text-destructive">*</span></label>
                <DatePicker value={expectedSolutionDate} onChange={setExpectedSolutionDate} placeholder="选择日期" />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            仅变更当前商机的售前顾问，其它字段不受影响。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "保存中…" : "确认分配"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
