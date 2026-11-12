"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { DatePicker } from "@/shared/ui/date-picker"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { useSalesNames, useSdrNames } from "@/modules/crm/hooks/use-directory-options"
import { chinaCityOptions, applyRegionCityChange } from "@/modules/crm/lib/china-cities"
import {
  CUSTOMER_STATUSES,
  LEAD_STATUS_META,
  LEAD_SOURCES,
  REGIONS,
  customerStatusMeta,
  leadLevelLabel,
  leadSourceSecondaryConfig,
  normalizeLeadSource,
  type Customer,
  type CustomerStatus,
  type Lead,
  type LeadLevel,
  type LeadStatus,
} from "@/modules/crm/lib/crm-data"
import {
  CompanyConflictError,
  createCustomerContactLead,
  fetchConvertCandidates,
  fetchLeadSourceOptions,
  type ConvertCandidate,
  type LeadSourceOption,
} from "@/modules/crm/services/crm-api"

const REGION_OPTIONS = [{ value: "", label: "请选择" }, ...toSelectOptions(REGIONS)]
const SOURCE_OPTIONS = [{ value: "", label: "请选择" }, ...toSelectOptions(LEAD_SOURCES)]
const CUSTOMER_CONTACT_SOURCES = ["三方会议", "自办会议", "自拓"] as const
const CUSTOMER_CONTACT_SOURCE_OPTIONS = [
  { value: "", label: "请选择" },
  ...toSelectOptions([...CUSTOMER_CONTACT_SOURCES]),
]
const RATED_LEAD_LEVELS: LeadLevel[] = ["A", "B", "C", "D"]
const LEVEL_OPTIONS = [
  { value: "", label: "未评级" },
  ...RATED_LEAD_LEVELS.map((l) => ({ value: l, label: leadLevelLabel(l) })),
]
const CITY_OPTIONS = chinaCityOptions()
/** 线索状态选项：新增/编辑均不允许手动选「已转客户」，
 *  该状态只能由「生成客户」流程写入，否则会丢失查重/匹配与转客户审计。 */
const LEAD_STATUS_OPTIONS = Object.entries(LEAD_STATUS_META)
  .filter(([value]) => value !== "converted")
  .map(([value, meta]) => ({ value, label: meta.label }))

const labelCls = "mb-1 block text-xs text-muted-foreground"

function isHardMatch(c: ConvertCandidate): boolean {
  return c.matchType !== "partial"
}

function CandidateRadioList({
  items,
  selectedCustomerId,
  onSelect,
  name,
  onViewCustomer,
}: {
  items: ConvertCandidate[]
  selectedCustomerId: string
  onSelect: (id: string) => void
  name: string
  onViewCustomer: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <ul className="max-h-56 space-y-2 overflow-y-auto overscroll-contain p-2">
        {items.map((c) => {
          const selected = selectedCustomerId === c.id
          return (
            <li key={c.id}>
              <div
                className={
                  selected
                    ? "flex items-start gap-3 rounded-lg border border-primary bg-primary/5 p-3"
                    : "flex items-start gap-3 rounded-lg border border-transparent bg-background p-3 hover:bg-accent/40"
                }
              >
                <label className="flex min-w-0 flex-1 cursor-pointer gap-3">
                  <input
                    type="radio"
                    name={name}
                    className="mt-1"
                    checked={selected}
                    onChange={() => onSelect(c.id)}
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium">
                      {c.companyName || "—"}
                      {c.brandName && c.brandName !== c.companyName ? (
                        <span className="font-normal text-muted-foreground"> · {c.brandName}</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[c.owner ? `负责人 ${c.owner}` : "", [c.region, c.city].filter(Boolean).join(" · ")]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                      {c.creditCode ? ` · ${c.creditCode}` : ""}
                    </span>
                  </span>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => onViewCustomer(c.id)}
                >
                  查看
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > 3 ? (
        <p className="border-t border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          共 {items.length} 条，可上下滑动查看更多
        </p>
      ) : null}
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-all">{value || "—"}</span>
    </div>
  )
}

/** 叠在「生成客户」之上，关闭后立刻回到关联选择，无需离开当前页 */
function ConvertCandidatePreviewDialog({
  customerId,
  open,
  onOpenChange,
  onSelectForLink,
}: {
  customerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectForLink: (id: string) => void
}) {
  const { getCustomer, loadCustomerById } = useCrm()
  const cached = getCustomer(customerId)
  const [customer, setCustomer] = useState<Customer | undefined>(cached)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    if (!open || !customerId) return
    const hit = getCustomer(customerId)
    if (hit) {
      setCustomer(hit)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void loadCustomerById(customerId)
      .then((data) => {
        if (!cancelled) setCustomer(data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, customerId, getCustomer, loadCustomerById])

  const primary = customer?.contacts?.find((c) => c.isPrimary) ?? customer?.contacts?.[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>客户详情预览</DialogTitle>
          <DialogDescription>对照后可返回继续关联或新建，无需离开当前流程。</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : !customer ? (
          <p className="text-sm text-muted-foreground">未找到该公司主档，或暂无客户模块权限。</p>
        ) : (
          <div className="rounded-xl bg-secondary/40 p-4">
            <PreviewRow label="公司名称" value={customer.companyName} />
            <PreviewRow label="品牌名称" value={customer.brandName} />
            <PreviewRow label="客户状态" value={customerStatusMeta(customer.status).label} />
            <PreviewRow label="负责人" value={customer.owner} />
            <PreviewRow
              label="所在地区"
              value={[customer.region, customer.city].filter(Boolean).join(" · ")}
            />
            <PreviewRow label="信用代码" value={customer.creditCode} />
            <PreviewRow
              label="行业"
              value={[customer.industryL1, customer.industryL2].filter(Boolean).join(" / ")}
            />
            <PreviewRow
              label="主联系人"
              value={
                primary
                  ? `${primary.name}${primary.title ? `（${primary.title}）` : ""}${
                      primary.phone ? ` · ${primary.phone}` : ""
                    }`
                  : "—"
              }
            />
            {(customer.contacts?.length ?? 0) > 1 ? (
              <PreviewRow label="联系人数量" value={`${customer.contacts!.length} 人`} />
            ) : null}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            返回
          </Button>
          <Button
            type="button"
            disabled={!customer}
            onClick={() => {
              onSelectForLink(customerId)
              onOpenChange(false)
            }}
          >
            选为关联对象
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConvertLeadDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { user } = useAuth()
  const isSdr = (user?.role || "").trim() === "sdr"
  const { getLead, convertLeadToCustomer } = useCrm()
  const lead = getLead(leadId)
  const [sales, setSales] = useState(lead && lead.sales !== "未分配" ? lead.sales : "")
  const { names: salesOptions } = useSalesNames(sales ? [sales] : [])
  const [candidates, setCandidates] = useState<ConvertCandidate[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState("")
  const [previewCustomerId, setPreviewCustomerId] = useState<string | null>(null)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !leadId) return
    let cancelled = false
    setLoadingCandidates(true)
    setSelectedCustomerId("")
    setPreviewCustomerId(null)
    void fetchConvertCandidates(leadId)
      .then((data) => {
        if (cancelled) return
        setCandidates(data.items)
        const hard = data.items.filter(isHardMatch)
        if (hard.length === 1) setSelectedCustomerId(hard[0]!.id)
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "加载同名客户失败")
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, leadId])

  if (!lead) return null

  const hardCandidates = candidates.filter(isHardMatch)
  const softCandidates = candidates.filter((c) => c.matchType === "partial")
  const mustLink = hardCandidates.length > 0
  const linkSelectedSoft = !mustLink && Boolean(selectedCustomerId)

  function finishConvert(cid: string | undefined, successMessage: string) {
    onOpenChange(false)
    if (!cid) return
    toast.success(successMessage)
    // SDR 无客户经营入口，留在线索侧；销售跳转客户详情
    if (!isSdr) {
      router.push(`/customers/${cid}`)
    }
  }

  async function convert() {
    if (!sales) {
      toast.error("请先指定分配销售")
      return
    }

    if (mustLink || linkSelectedSoft) {
      if (!selectedCustomerId) {
        toast.error("请选择要关联的已有公司")
        return
      }
      setSubmitting(true)
      try {
        const cid = await convertLeadToCustomer(leadId, {
          mode: "link",
          customerId: selectedCustomerId,
          sales,
        })
        finishConvert(cid, "已关联公司并为承接销售建立对接")
      } catch (err) {
        if (err instanceof CompanyConflictError) {
          setCandidates(err.candidates)
          toast.error(err.message)
          return
        }
        /* CrmProvider 已 toast（非 conflict） */
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    try {
      const cid = await convertLeadToCustomer(leadId, { mode: "create", sales })
      finishConvert(cid, "已生成客户档案")
    } catch (err) {
      if (err instanceof CompanyConflictError) {
        setCandidates(err.candidates)
        const hard = err.candidates.filter(isHardMatch)
        if (hard.length === 1) setSelectedCustomerId(hard[0]!.id)
        toast.error(err.message)
        return
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 预览叠层打开时，勿因 Esc/点遮罩关掉「生成客户」
        if (!next && previewCustomerId) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mustLink ? "关联已有公司" : "生成客户"}</DialogTitle>
          <DialogDescription>
            {mustLink
              ? `线索「${lead.brandName || lead.companyName}」对应公司已有档案。请指定承接销售：关联后将该销售建立独立对接池，并把线索联系人并入其对接内容。`
              : `将线索「${lead.brandName || lead.companyName}」转为正式客户前，需指定承接销售。未选已有公司时将新建主档并建立对接；选中相近公司则并入联系人到该销售对接池。`}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl bg-secondary/40 p-4 text-sm">
          <div className="flex justify-between gap-3 py-1">
            <span className="shrink-0 text-muted-foreground">公司名称</span>
            <span className="min-w-0 text-right font-medium break-all">{lead.companyName}</span>
          </div>
          <div className="flex justify-between gap-3 py-1">
            <span className="shrink-0 text-muted-foreground">品牌名称</span>
            <span className="min-w-0 text-right font-medium">{lead.brandName || "—"}</span>
          </div>
          <div className="flex justify-between gap-3 py-1">
            <span className="shrink-0 text-muted-foreground">联系人</span>
            <span className="min-w-0 text-right font-medium">
              {lead.contactName}
              {lead.contactTitle ? `（${lead.contactTitle}）` : ""}
            </span>
          </div>
          {lead.contactPhone ? (
            <div className="flex justify-between gap-3 py-1">
              <span className="shrink-0 text-muted-foreground">联系人电话</span>
              <span className="font-medium">{lead.contactPhone}</span>
            </div>
          ) : null}
          {lead.contactWechat ? (
            <div className="flex justify-between gap-3 py-1">
              <span className="shrink-0 text-muted-foreground">联系人微信</span>
              <span className="font-medium">{lead.contactWechat}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 py-1">
            <span className="shrink-0 text-muted-foreground">所在地区</span>
            <span className="font-medium">
              {[lead.region, lead.city].filter(Boolean).join(" · ") || "—"}
            </span>
          </div>
        </div>

        {loadingCandidates ? (
          <p className="text-xs text-muted-foreground">正在检查是否已有同名客户…</p>
        ) : mustLink ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">该公司已存在，请选择要关联的公司</p>
            <CandidateRadioList
              items={hardCandidates}
              selectedCustomerId={selectedCustomerId}
              onSelect={setSelectedCustomerId}
              name="convert-customer"
              onViewCustomer={setPreviewCustomerId}
            />
            {softCandidates.length > 0 ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">以下为名称相近的其他客户（仅供参考）</p>
                <CandidateRadioList
                  items={softCandidates}
                  selectedCustomerId={selectedCustomerId}
                  onSelect={setSelectedCustomerId}
                  name="convert-customer"
                  onViewCustomer={setPreviewCustomerId}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {softCandidates.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">
                  发现名称相近的客户，是否是这家公司？选中则并入联系人到对接池，不选则新建。
                </p>
                <CandidateRadioList
                  items={softCandidates}
                  selectedCustomerId={selectedCustomerId}
                  onSelect={(id) =>
                    setSelectedCustomerId((prev) => (prev === id ? "" : id))
                  }
                  name="convert-customer-soft"
                  onViewCustomer={setPreviewCustomerId}
                />
                {selectedCustomerId ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setSelectedCustomerId("")}
                  >
                    取消选择，继续新建
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">未发现同名客户，将新建客户档案。</p>
            )}
          </>
        )}

        {!loadingCandidates ? (
          <div>
            <label className={labelCls}>
              分配销售 <span className="text-destructive">*</span>
            </label>
            <SearchableSelect
              value={sales}
              onChange={setSales}
              options={toSelectOptions(salesOptions)}
              placeholder="请选择或搜索承接销售"
            />
            {!sales ? (
              <p className="mt-1.5 text-xs text-amber-600">
                {mustLink || linkSelectedSoft
                  ? "关联已有公司时也需指定承接销售，联系人将并入其对接池。"
                  : "未指定分配销售时无法生成客户。"}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={
              submitting ||
              loadingCandidates ||
              !sales ||
              ((mustLink || linkSelectedSoft) && !selectedCustomerId)
            }
            onClick={() => void convert()}
          >
            {submitting
              ? "处理中…"
              : mustLink || linkSelectedSoft
                ? "关联并分配销售"
                : "确认生成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {previewCustomerId ? (
      <ConvertCandidatePreviewDialog
        customerId={previewCustomerId}
        open={Boolean(previewCustomerId)}
        onOpenChange={(o) => {
          if (!o) setPreviewCustomerId(null)
        }}
        onSelectForLink={setSelectedCustomerId}
      />
    ) : null}
    </>
  )
}

const emptyForm = {
  companyName: "",
  brandName: "",
  contactName: "",
  contactTitle: "",
  contactDepartment: "",
  contactPhone: "",
  contactWechat: "",
  email: "",
  website: "",
  region: "",
  city: "",
  source: "",
  sourceDetail: "",
  level: "" as LeadLevel | "",
  firstContactDate: "",
  wechatAdded: false,
  contactStatus: "awaiting_contact" as CustomerStatus,
  status: "untouched" as LeadStatus,
  sdr: "",
}

function FieldLabel({
  children,
  required,
  hint,
}: {
  children: ReactNode
  required?: boolean
  hint?: string
}) {
  return (
    <label className={labelCls}>
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
      {hint ? <span className="ml-1 font-normal text-muted-foreground/80">（{hint}）</span> : null}
    </label>
  )
}

export function LeadFormDialog({
  leadId,
  customerContext,
  onCustomerUpdated,
  open,
  onOpenChange,
}: {
  leadId?: string // 传入则为编辑，否则为新增
  customerContext?: Pick<Customer, "id" | "companyName" | "brandName" | "website" | "region" | "city">
  onCustomerUpdated?: (customer?: Customer) => void | Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { getLead, createLead, updateLead } = useCrm()
  const editing = leadId ? getLead(leadId) : undefined
  const [form, setForm] = useState(() =>
    editing
      ? {
          companyName: editing.companyName || "",
          brandName: editing.brandName || "",
          contactName: editing.contactName || "",
          contactTitle: editing.contactTitle || "",
          contactDepartment: editing.contactDepartment || "",
          contactPhone: editing.contactPhone || "",
          contactWechat: editing.contactWechat || "",
          email: editing.email || "",
          website: editing.website || "",
          region: editing.region || "",
          city: editing.city || "",
          source: normalizeLeadSource(editing.source) || "",
          sourceDetail: editing.sourceDetail || "",
          level: (editing.level || "") as LeadLevel | "",
          firstContactDate: editing.firstContactDate || "",
          wechatAdded: editing.wechatAdded === true,
          contactStatus: "awaiting_contact" as CustomerStatus,
          status: (editing.status || "untouched") as LeadStatus,
          sdr: editing.sdr || "",
        }
      : emptyForm,
  )
  const { names: sdrNames } = useSdrNames(editing ? [editing.sdr || ""] : [])
  const [sourceOptions, setSourceOptions] = useState<LeadSourceOption[]>([])
  const dynamicOptions = useMemo(
    () => sourceOptions.filter((item) => item.primarySource === form.source && item.enabled).map((item) => item.displayName),
    [sourceOptions, form.source],
  )
  const secondaryConfig = useMemo(
    () => leadSourceSecondaryConfig(form.source, dynamicOptions),
    [form.source, dynamicOptions],
  )

  useEffect(() => {
    if (!open) return
    void fetchLeadSourceOptions()
      .then(setSourceOptions)
      .catch((error) => toast.error(error instanceof Error ? error.message : "加载二级来源失败"))
  }, [open])

  useEffect(() => {
    if (!open || !customerContext) return
    setForm({
      ...emptyForm,
      companyName: customerContext.companyName,
      brandName: customerContext.brandName || "",
      website: customerContext.website || "",
      region: customerContext.region || "",
      city: customerContext.city || "",
    })
  }, [open, customerContext])

  function setRegion(region: string) {
    setForm((f) => ({ ...f, ...applyRegionCityChange(f, { region }) }))
  }

  function setCity(city: string) {
    setForm((f) => ({ ...f, ...applyRegionCityChange(f, { city }) }))
  }

  function setSource(source: string) {
    setForm((f) => {
      const next = normalizeLeadSource(source) || source
      const options = sourceOptions.filter((item) => item.primarySource === next && item.enabled).map((item) => item.displayName)
      const cfg = leadSourceSecondaryConfig(next, options)
      const keep =
        cfg.mode === "select" && (cfg.options as readonly string[]).includes(f.sourceDetail)
          ? f.sourceDetail
          : ""
      return { ...f, source: next, sourceDetail: keep }
    })
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit() {
    if (!form.companyName.trim()) {
      toast.error("请填写公司名称")
      return
    }
    if (!form.contactName.trim()) {
      toast.error("请填写联系人")
      return
    }
    if (!form.contactPhone.trim() && !form.contactWechat.trim()) {
      toast.error("请填写联系人电话或微信（至少一项）")
      return
    }
    if (!form.source) {
      toast.error("请选择线索来源")
      return
    }
    const secondary = leadSourceSecondaryConfig(form.source, dynamicOptions)
    if (
      secondary.mode === "select" &&
      (!customerContext || secondary.options.length > 0) &&
      !form.sourceDetail.trim()
    ) {
      toast.error(`请完善${secondary.label}`)
      return
    }
    if (secondary.mode === "text" && !form.sourceDetail.trim()) {
      toast.error(secondary.placeholder || `请填写${secondary.label}`)
      return
    }
    const patch: Partial<Lead> = {
      companyName: form.companyName.trim(),
      brandName: form.brandName.trim(),
      contactName: form.contactName.trim(),
      contactTitle: form.contactTitle.trim(),
      contactDepartment: form.contactDepartment.trim(),
      contactPhone: form.contactPhone.trim(),
      contactWechat: form.contactWechat.trim(),
      email: form.email.trim(),
      website: form.website.trim(),
      region: form.region,
      city: form.city.trim(),
      source: normalizeLeadSource(form.source) || form.source,
      sourceDetail: secondary.mode === "none" ? "" : form.sourceDetail.trim(),
      level: (form.level || "") as LeadLevel,
      firstContactDate: form.firstContactDate,
      wechatAdded: form.wechatAdded,
    }
    if (!customerContext) {
      patch.status = form.status as LeadStatus
    }
    if (editing) {
      // 归属 SDR：空值表示保持当前归属（后端不误清）
      patch.sdr = form.sdr.trim()
    }
    try {
      if (customerContext) {
        const result = await createCustomerContactLead(customerContext.id, {
          ...patch,
          contactStatus: form.contactStatus,
        })
        // 优先用创建响应里的客户视图刷新，避免仅依赖二次 GET 时读路径漏子表
        if (result?.customer) {
          await onCustomerUpdated?.(result.customer)
        } else {
          await onCustomerUpdated?.()
        }
        toast.success("联系人已添加，并已回填线索")
      } else if (editing) {
        await updateLead(editing.id, patch)
        toast.success("线索信息已更新")
      } else {
        // 创建时间由系统写入；销售保持未分配，转客户时再指定
        await createLead({ ...patch, sales: "未分配" })
        toast.success("线索已新增")
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : customerContext ? "添加联系人失败" : "保存失败")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{customerContext ? "新增联系人" : editing ? "编辑线索" : "新增线索"}</DialogTitle>
          <DialogDescription>
            {customerContext
              ? "联系人将同步回填为线索，并自动分配给当前登录销售。"
              : "公司名称、联系人必填；电话与微信至少填一项。分配销售后即可生成客户。"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto overscroll-contain">
          <section className="space-y-3">
            <p className="text-sm font-medium text-foreground">公司信息</p>
            <div>
              <FieldLabel required>公司名称</FieldLabel>
              <Input
                value={form.companyName}
                disabled={Boolean(customerContext)}
                onChange={(e) => set("companyName", e.target.value)}
                placeholder="如：深圳市某某科技有限公司"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>品牌名称</FieldLabel>
                <Input
                  value={form.brandName}
                  disabled={Boolean(customerContext)}
                  onChange={(e) => set("brandName", e.target.value)}
                  placeholder="可与公司名不同"
                />
              </div>
              <div>
                <FieldLabel>官网</FieldLabel>
                <Input
                  value={form.website}
                  disabled={Boolean(customerContext)}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="如 https://example.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>区域</FieldLabel>
                <SearchableSelect value={form.region} onChange={setRegion} options={REGION_OPTIONS} placeholder="请选择区域" disabled={Boolean(customerContext)} />
              </div>
              <div>
                <FieldLabel>城市</FieldLabel>
                <SearchableSelect
                  value={form.city}
                  onChange={setCity}
                  options={CITY_OPTIONS}
                  placeholder="输入搜索城市"
                  allowCustom
                  disabled={Boolean(customerContext)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">联系人</p>
              <p className="text-[11px] text-muted-foreground">电话与微信至少填写一项</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel required>联系人</FieldLabel>
                <Input
                  value={form.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  placeholder="姓名"
                />
              </div>
              <div>
                <FieldLabel required hint="二选一">
                  联系人电话
                </FieldLabel>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="手机号"
                  value={form.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                />
              </div>
              <div>
                <FieldLabel required hint="二选一">
                  微信
                </FieldLabel>
                <Input
                  value={form.contactWechat}
                  onChange={(e) => set("contactWechat", e.target.value)}
                  placeholder="微信号 / 企微账号"
                />
              </div>
              <div>
                <FieldLabel>职位</FieldLabel>
                <Input
                  value={form.contactTitle}
                  onChange={(e) => set("contactTitle", e.target.value)}
                  placeholder="如市场总监"
                />
              </div>
              <div>
                <FieldLabel>部门</FieldLabel>
                <Input
                  value={form.contactDepartment}
                  onChange={(e) => set("contactDepartment", e.target.value)}
                  placeholder="如市场 / 品牌"
                />
              </div>
              <div>
                <FieldLabel>邮箱</FieldLabel>
                <Input
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="选填"
                />
              </div>
              <div>
                {customerContext ? (
                  <>
                    <FieldLabel>联系人状态</FieldLabel>
                    <SearchableSelect
                      value={form.contactStatus}
                      onChange={(v) => set("contactStatus", v as CustomerStatus)}
                      options={CUSTOMER_STATUSES.map((s) => ({ value: s, label: customerStatusMeta(s).label }))}
                      placeholder="选择状态"
                    />
                  </>
                ) : (
                  <>
                    <FieldLabel>线索状态</FieldLabel>
                    <SearchableSelect
                      value={form.status}
                      onChange={(v) => set("status", v as LeadStatus)}
                      options={LEAD_STATUS_OPTIONS}
                      placeholder="选择状态"
                    />
                  </>
                )}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border border-input accent-primary"
                checked={form.wechatAdded}
                onChange={(e) => set("wechatAdded", e.target.checked)}
              />
              是否已加企业微信
            </label>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">线索与承接</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {editing && !customerContext ? (
                <div>
                  <FieldLabel
                    hint={
                      form.sdr
                        ? "改派后线索进入该 SDR 名下"
                        : "当前未归属，选择 SDR 后完成绑定"
                    }
                  >
                    归属 SDR
                  </FieldLabel>
                  <SearchableSelect
                    value={form.sdr}
                    onChange={(v) => set("sdr", v)}
                    options={[
                      { value: "", label: "保持当前归属" },
                      ...toSelectOptions(sdrNames),
                    ]}
                    placeholder="选择归属 SDR"
                    dropdownSide="top"
                  />
                </div>
              ) : null}
              <div>
                <FieldLabel>线索等级</FieldLabel>
                <SearchableSelect
                  value={form.level}
                  onChange={(v) => set("level", v as LeadLevel | "")}
                  options={LEVEL_OPTIONS}
                  placeholder="未评级"
                />
              </div>
              <div>
                <FieldLabel>首次触达日期</FieldLabel>
                <DatePicker
                  value={form.firstContactDate}
                  onChange={(v) => set("firstContactDate", v)}
                  placeholder="未填则首次跟进时自动写入"
                />
              </div>
              <div>
                <FieldLabel required>一级来源</FieldLabel>
                <SearchableSelect
                  value={form.source}
                  onChange={setSource}
                  options={customerContext ? CUSTOMER_CONTACT_SOURCE_OPTIONS : SOURCE_OPTIONS}
                  placeholder="请选择一级来源"
                  dropdownSide="top"
                />
              </div>
              {secondaryConfig.mode !== "none" ? (
                <div>
                  <FieldLabel required>{secondaryConfig.label}</FieldLabel>
                  {secondaryConfig.mode === "select" ? (
                    <SearchableSelect
                      value={form.sourceDetail}
                      onChange={(v) => set("sourceDetail", v)}
                      options={[
                        { value: "", label: "请选择" },
                        ...toSelectOptions(secondaryConfig.options),
                      ]}
                      placeholder={secondaryConfig.placeholder}
                      disabled={secondaryConfig.options.length === 0}
                      dropdownSide="top"
                    />
                  ) : (
                    <Input
                      value={form.sourceDetail}
                      onChange={(e) => set("sourceDetail", e.target.value)}
                      placeholder={secondaryConfig.placeholder}
                    />
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()}>{editing ? "保存" : "新增"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
