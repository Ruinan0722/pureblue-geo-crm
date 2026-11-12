"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { useAuth } from "@/modules/auth"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useSalesNames } from "@/modules/crm/hooks/use-directory-options"
import { chinaCityOptions } from "@/modules/crm/lib/china-cities"
import {
  COMPANY_NATURES,
  INDUSTRIES,
  REGIONS,
  customerStatusMeta,
  sanitizeCreditCodeInput,
  validateCreditCode,
} from "@/modules/crm/lib/crm-data"
import {
  fetchCustomerCreateCandidates,
  fetchLeadSourceOptions,
  CompanyConflictError,
  type ConvertCandidate,
  type LeadSourceOption,
} from "@/modules/crm/services/crm-api"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { DatePicker } from "@/shared/ui/date-picker"
import { useFormDraft } from "@/shared/hooks/use-form-draft"

type DupState = {
  loading: boolean
  hard: ConvertCandidate[]
  soft: ConvertCandidate[]
  hiddenMatchCount: number
}

const EMPTY_DUP: DupState = { loading: false, hard: [], soft: [], hiddenMatchCount: 0 }

const CREATE_CUSTOMER_DRAFT_KEY = "crm:create-customer"
const CUSTOMER_CREATE_SOURCES = ["三方会议", "自办会议", "自拓"] as const

type CreateCustomerForm = {
  companyName: string
  brandName: string
  region: string
  city: string
  industryL1: string
  industryL2: string
  foundedDate: string
  creditCode: string
  registeredCapital: string
  annualRevenue: string
  scale: string
  nature: string
  source: string
  sourceDetail: string
  owner: string
  isKey: boolean
  contactName: string
  contactTitle: string
  contactPhone: string
  contactWechat: string
  contactEmail: string
  wechatAdded: boolean
}

function emptyCreateCustomerForm(owner: string): CreateCustomerForm {
  return {
    companyName: "",
    brandName: "",
    region: REGIONS[0] as string,
    city: "",
    industryL1: Object.keys(INDUSTRIES)[0] || "",
    industryL2: INDUSTRIES[Object.keys(INDUSTRIES)[0] || ""]?.[0] || "",
    foundedDate: "",
    creditCode: "",
    registeredCapital: "",
    annualRevenue: "",
    scale: "",
    nature: "",
    source: "",
    sourceDetail: "",
    owner,
    isKey: false,
    contactName: "",
    contactTitle: "",
    contactPhone: "",
    contactWechat: "",
    contactEmail: "",
    wechatAdded: false,
  }
}

/** 销售新建客户：客户档案 + 必填主联系人，同步回填一条已转化线索 */
export function CreateCustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { user } = useAuth()
  const { createCustomer } = useCrm()
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<CreateCustomerForm>(() =>
    emptyCreateCustomerForm(user?.name || ""),
  )
  const [dup, setDup] = useState<DupState>(EMPTY_DUP)
  const [serverConflict, setServerConflict] = useState<CompanyConflictError | null>(null)
  const [sourceOptions, setSourceOptions] = useState<LeadSourceOption[]>([])
  const dupReqRef = useRef(0)
  const { names: salesOptions } = useSalesNames(form.owner ? [form.owner] : [])
  const { clearDraft } = useFormDraft({
    key: CREATE_CUSTOMER_DRAFT_KEY,
    schemaVersion: 2,
    open,
    value: form,
    onRestore: setForm,
    shouldPersist: (f) =>
      Boolean(
        f.companyName.trim() ||
          f.brandName.trim() ||
          f.creditCode.trim() ||
          f.contactName.trim() ||
          f.contactPhone.trim(),
      ),
  })
  const secondarySourceOptions = useMemo(
    () => sourceOptions
      .filter((item) => item.primarySource === form.source && item.enabled)
      .map((item) => item.displayName),
    [sourceOptions, form.source],
  )

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  useEffect(() => {
    if (!open) setServerConflict(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    void fetchLeadSourceOptions()
      .then(setSourceOptions)
      .catch((error) => toast.error(error instanceof Error ? error.message : "加载二级来源失败"))
  }, [open])

  useEffect(() => {
    setServerConflict(null)
  }, [form.companyName])

  useEffect(() => {
    if (!open) return
    const company = form.companyName.trim()
    const credit = form.creditCode.trim()
    const creditValid = !credit || !validateCreditCode(credit)
    if (company.length < 2 && !creditValid) {
      setDup(EMPTY_DUP)
      return
    }
    const reqId = ++dupReqRef.current
    setDup((prev) => ({ ...prev, loading: true }))
    const timer = window.setTimeout(() => {
      void fetchCustomerCreateCandidates(company, credit)
        .then((result) => {
          if (reqId !== dupReqRef.current) return
          const hard = result.items.filter(
            (c) => c.matchType === "credit" || c.matchType === "exact",
          )
          const soft = result.items.filter((c) => c.matchType === "partial")
          setDup({
            loading: false,
            hard,
            soft: soft.slice(0, 5),
            hiddenMatchCount: result.hiddenMatchCount,
          })
        })
        .catch(() => {
          if (reqId !== dupReqRef.current) return
          setDup(EMPTY_DUP)
        })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [form.companyName, form.creditCode, open])

  async function submit() {
    if (!form.companyName.trim()) {
      toast.error("请填写公司名称")
      return
    }
    if (dup.hard.length > 0) {
      toast.error(
        dup.hard.some((c) => c.matchType === "credit")
          ? "该统一社会信用代码已存在，请勿重复创建客户"
          : "系统中已有同名客户，请查看已有档案，勿重复新建",
      )
      return
    }
    if (!form.contactName.trim()) {
      toast.error("请填写联系人姓名")
      return
    }
    if (!form.contactPhone.trim() && !form.contactWechat.trim()) {
      toast.error("请填写联系人电话或微信（至少一项）")
      return
    }
    if (!(CUSTOMER_CREATE_SOURCES as readonly string[]).includes(form.source)) {
      toast.error("请选择客户来源")
      return
    }
    if (secondarySourceOptions.length > 0 && !form.sourceDetail.trim()) {
      toast.error("请选择二级来源")
      return
    }
    const creditCode = form.creditCode.trim()
    const creditErr = validateCreditCode(creditCode)
    if (creditErr) {
      toast.error(creditErr)
      return
    }
    setSubmitting(true)
    try {
      const id = await createCustomer(
        {
          companyName: form.companyName.trim(),
          brandName: form.brandName.trim(),
          region: form.region,
          city: form.city.trim(),
          industryL1: form.industryL1,
          industryL2: form.industryL2,
          foundedDate: form.foundedDate,
          creditCode,
          registeredCapital: Number(form.registeredCapital) || 0,
          annualRevenue: Number(form.annualRevenue) || 0,
          scale: form.scale.trim(),
          nature: form.nature,
          source: form.source,
          sourceDetail: form.source === "自拓" ? "" : form.sourceDetail.trim(),
          owner: form.owner || user?.name || "",
          isKey: form.isKey,
        },
        form.contactName.trim()
          ? {
              name: form.contactName.trim(),
              title: form.contactTitle.trim(),
              phone: form.contactPhone.trim(),
              wechat: form.contactWechat.trim(),
              email: form.contactEmail.trim(),
              wechatAdded: form.wechatAdded,
            }
          : undefined,
      )
      onOpenChange(false)
      clearDraft()
      setForm(emptyCreateCustomerForm(user?.name || ""))
      toast.success(
        form.isKey
          ? form.contactName.trim()
            ? "重点客户与联系人已创建，已同步回填线索"
            : "重点客户已创建，已同步回填线索"
          : form.contactName.trim()
            ? "客户与联系人已创建，已同步回填线索"
            : "客户已创建，已同步回填线索",
      )
      router.push(`/customers/${id}`)
    } catch (err) {
      if (err instanceof CompanyConflictError) {
        // 同名/同信用代码冲突：展示服务端候选客户，由用户决定查看已有档案
        setServerConflict(err)
        return
      }
      /* 其他错误 provider 已 toast */
    } finally {
      setSubmitting(false)
    }
  }

  const industryOptions = INDUSTRIES[form.industryL1] ?? []
  const fieldLabel = "mb-1 block text-xs text-muted-foreground"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建客户</DialogTitle>
          <DialogDescription>
            填写客户基本信息；可同时添加一位主联系人。创建后可在客户详情继续补充。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section className="space-y-3">
            <p className="text-sm font-medium">客户信息</p>
            <div>
              <label className={fieldLabel}>公司名称 *</label>
              <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
              {dup.loading ? (
                <p className="mt-1.5 text-xs text-muted-foreground">正在检查是否已有同名客户…</p>
              ) : dup.hard.length > 0 ? (
                <div className="mt-1.5 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">
                    {dup.hard.some((c) => c.matchType === "credit")
                      ? "该统一社会信用代码已存在，无法重复创建"
                      : "系统中已存在同名客户档案，请查看已有档案，勿重复新建"}
                  </p>
                  {dup.hard.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        {c.companyName}
                        {c.owner ? ` · 负责人 ${c.owner}` : ""}
                        {c.status ? ` · ${customerStatusMeta(c.status).label}` : ""}
                      </span>
                      <Button variant="outline" size="sm" className="h-7 border-amber-300 bg-white" asChild>
                        <Link href={`/customers/${c.id}`} onClick={() => onOpenChange(false)}>
                          查看
                        </Link>
                      </Button>
                    </div>
                  ))}
                  {dup.hiddenMatchCount > 0 && dup.hard.length === 0 ? (
                    <p className="text-xs">另有 {dup.hiddenMatchCount} 个同名客户不在当前可见范围</p>
                  ) : null}
                </div>
              ) : dup.soft.length > 0 ? (
                <div className="mt-1.5 space-y-1.5 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
                  <p className="text-xs text-muted-foreground">发现名称相近的客户（仅供参考）</p>
                  {dup.soft.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        {c.companyName}
                        {c.owner ? ` · ${c.owner}` : ""}
                      </span>
                      <Button variant="ghost" size="sm" className="h-7" asChild>
                        <Link href={`/customers/${c.id}`} onClick={() => onOpenChange(false)}>
                          查看
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : form.companyName.trim().length >= 2 ? (
                <p className="mt-1.5 text-xs text-emerald-600">未发现同名客户，可新建客户档案。</p>
              ) : null}
              {serverConflict ? (
                <div className="mt-1.5 space-y-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">
                    系统中已存在同名客户档案（可能不在当前可见范围），请查看已有档案并建立我的对接，勿重复新建
                  </p>
                  {serverConflict.candidates.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        {c.companyName}
                        {c.owner ? ` · 负责人 ${c.owner}` : ""}
                        {c.status ? ` · ${customerStatusMeta(c.status).label}` : ""}
                      </span>
                      <Button variant="outline" size="sm" className="h-7 border-red-300 bg-white" asChild>
                        <Link href={`/customers/${c.id}`} onClick={() => onOpenChange(false)}>
                          查看
                        </Link>
                      </Button>
                    </div>
                  ))}
                  {serverConflict.hiddenMatchCount > 0 && serverConflict.candidates.length === 0 ? (
                    <p className="text-xs">另有 {serverConflict.hiddenMatchCount} 个同名客户不在当前可见范围</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div>
              <label className={fieldLabel}>品牌名称</label>
              <Input
                value={form.brandName}
                onChange={(e) => set("brandName", e.target.value)}
                placeholder="默认与公司名称相同"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>一级行业</label>
                <SearchableSelect
                  value={form.industryL1}
                  onChange={(next) =>
                    setForm((current) => ({
                      ...current,
                      industryL1: next,
                      industryL2: INDUSTRIES[next]?.[0] || "",
                    }))
                  }
                  options={toSelectOptions(Object.keys(INDUSTRIES))}
                  placeholder="选择或搜索行业"
                />
              </div>
              <div>
                <label className={fieldLabel}>二级行业</label>
                <SearchableSelect
                  value={form.industryL2}
                  onChange={(v) => set("industryL2", v)}
                  options={toSelectOptions(industryOptions)}
                  placeholder="选择子行业"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>所在地区 · 区域</label>
                <SearchableSelect
                  value={form.region}
                  onChange={(v) => set("region", v)}
                  options={toSelectOptions([...REGIONS])}
                  placeholder="选择区域"
                />
              </div>
              <div>
                <label className={fieldLabel}>所在地区 · 城市</label>
                <SearchableSelect
                  value={form.city}
                  onChange={(v) => set("city", v)}
                  options={chinaCityOptions()}
                  placeholder="输入搜索城市"
                  allowCustom
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>成立时间</label>
                <DatePicker
                  value={form.foundedDate}
                  onChange={(v) => set("foundedDate", v)}
                  placeholder="选择成立日期"
                />
              </div>
              <div>
                <label className={fieldLabel}>统一社会信用代码</label>
                <Input
                  placeholder="18 位数字或英文字母"
                  maxLength={18}
                  autoComplete="off"
                  spellCheck={false}
                  value={form.creditCode}
                  onChange={(e) => set("creditCode", sanitizeCreditCodeInput(e.target.value))}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  须为 18 位；仅支持数字与大小写英文字母，可不填
                </p>
              </div>
              <div>
                <label className={fieldLabel}>注册资金（万元）</label>
                <Input
                  inputMode="numeric"
                  value={form.registeredCapital}
                  onChange={(e) => set("registeredCapital", e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
              <div>
                <label className={fieldLabel}>年营业收入（万元）</label>
                <Input
                  inputMode="decimal"
                  value={form.annualRevenue}
                  onChange={(e) => set("annualRevenue", e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="可选"
                />
              </div>
              <div>
                <label className={fieldLabel}>公司规模</label>
                <Input value={form.scale} onChange={(e) => set("scale", e.target.value)} placeholder="如：50-100 人" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>企业性质</label>
                <SearchableSelect
                  value={form.nature}
                  onChange={(v) => set("nature", v)}
                  options={toSelectOptions([...COMPANY_NATURES])}
                  placeholder="选择企业性质"
                />
              </div>
              <div>
                <label className={fieldLabel}>一级来源 *</label>
                <SearchableSelect
                  value={form.source}
                  onChange={(source) => setForm((current) => ({ ...current, source, sourceDetail: "" }))}
                  options={toSelectOptions([...CUSTOMER_CREATE_SOURCES])}
                  placeholder="请选择一级来源"
                />
              </div>
            </div>
            {form.source !== "自拓" && secondarySourceOptions.length > 0 ? (
              <div>
                <label className={fieldLabel}>二级来源 *</label>
                <SearchableSelect
                  value={form.sourceDetail}
                  onChange={(value) => set("sourceDetail", value)}
                  options={toSelectOptions(secondarySourceOptions)}
                  placeholder="请选择二级来源"
                />
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>销售负责人</label>
                <SearchableSelect
                  value={form.owner}
                  onChange={(v) => set("owner", v)}
                  options={toSelectOptions(salesOptions)}
                  placeholder="选择或搜索销售"
                />
              </div>
              <div>
                <label className={fieldLabel}>是否重点客户</label>
                <SearchableSelect
                  value={form.isKey ? "yes" : "no"}
                  onChange={(v) => set("isKey", v === "yes")}
                  options={[
                    { value: "yes", label: "是" },
                    { value: "no", label: "否" },
                  ]}
                  placeholder="选择是否重点客户"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium">主联系人 *</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>姓名 *</label>
                <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>职位</label>
                <Input value={form.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>手机</label>
                <Input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
              </div>
              <div>
                <label className={fieldLabel}>微信</label>
                <Input value={form.contactWechat} onChange={(e) => set("contactWechat", e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">手机或微信至少填写一项。</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>邮箱</label>
                <Input value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.wechatAdded}
                onChange={(e) => set("wechatAdded", e.target.checked)}
              />
              已添加企业微信
            </label>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={submitting || dup.loading || dup.hard.length > 0 || Boolean(serverConflict)}
            onClick={() => void submit()}
          >
            {submitting ? "创建中…" : "创建客户"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
