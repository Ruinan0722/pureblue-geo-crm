"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Copy, Lock, RotateCcw, Save, Send, Sparkles } from "lucide-react"
import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import { copyToClipboard } from "@/shared/lib/copy-to-clipboard"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { toast } from "sonner"
import {
  DOMESTIC_AI_PLATFORM_OPTIONS,
  DOMESTIC_OPTIMIZATION_GOALS,
  DOMESTIC_OPTIMIZE_PERIODS,
  emptyDomesticForm,
  intentProductOptions,
  intakeVariantDraftSuffix,
  normalizeIntentQuestions,
  normalizeIntentRoughItems,
  saveIntakeDraft,
  clearIntakeDraft,
  loadIntakeDraftRaw,
  stampGeoVariant,
  validateDomesticIntakeForm,
  type GeoFormData,
} from "@/modules/intake"
import {
  ChoiceCard,
  ChipGroup,
  Field,
  IntentQuestionEditor,
  ProductEditor,
  RowList,
  SectionCard,
} from "@/modules/intake/components/form-bits"
import { saveSubmissionLocally } from "@/modules/intake-backup/lib/client"

const AUTO_SAVE_MS = 500
const DRAFT_SUFFIX = intakeVariantDraftSuffix("domestic")
const PHONE_RE_CN = /^1[3-9]\d{9}$/
const INTAKE_SUBMIT_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_INTAKE_SUBMIT_URL?.trim()) ||
  "/api/intake/submit"

type Errors = Partial<Record<string, string>>

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** 国内 GEO 填报：对齐飞书「国内GEO优化需求收集」问卷 */
export function DomesticIntakeForm({ inviteToken }: { inviteToken: string }) {
  const [form, setForm] = useState<GeoFormData>(emptyDomesticForm)
  const [errors, setErrors] = useState<Errors>({})
  const [hydrated, setHydrated] = useState(false)
  const [submittedCode, setSubmittedCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef(form)

  useEffect(() => {
    formRef.current = form
  }, [form])

  useEffect(() => {
    if (typeof window !== "undefined") {
      const raw = loadIntakeDraftRaw(inviteToken, DRAFT_SUFFIX)
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<GeoFormData>
          const base = emptyDomesticForm()
          const productOptions = intentProductOptions({ ...base, ...parsed } as GeoFormData, "品牌整体")
          const defaultProductId = productOptions[0]?.id ?? ""
          setForm({
            ...base,
            ...parsed,
            goals: Array.isArray(parsed.goals) ? parsed.goals : [],
            brandCompetitors: Array.isArray(parsed.brandCompetitors) && parsed.brandCompetitors.length > 0
              ? parsed.brandCompetitors
              : [""],
            intentQuestions: normalizeIntentQuestions(parsed.intentQuestions, defaultProductId),
            intentRoughItems: normalizeIntentRoughItems(
              parsed.intentRoughItems,
              typeof parsed.intentRough === "string" ? parsed.intentRough : "",
              defaultProductId,
            ),
          })
        } catch {
          /* ignore */
        }
      }
    }
    setHydrated(true)
  }, [inviteToken])

  useEffect(() => {
    if (!hydrated || submittedCode) return
    const timer = window.setTimeout(() => saveIntakeDraft(form, inviteToken, DRAFT_SUFFIX), AUTO_SAVE_MS)
    return () => window.clearTimeout(timer)
  }, [form, hydrated, submittedCode, inviteToken])

  useEffect(() => {
    if (!hydrated || submittedCode) return
    const flush = () => saveIntakeDraft(formRef.current, inviteToken, DRAFT_SUFFIX)
    window.addEventListener("pagehide", flush)
    return () => window.removeEventListener("pagehide", flush)
  }, [hydrated, submittedCode, inviteToken])

  const intentProductOptionList = useMemo(
    () => intentProductOptions(form, "品牌整体"),
    [form],
  )

  useEffect(() => {
    if (!hydrated || (form.intentType !== "clear" && form.intentType !== "rough")) return
    const validIds = new Set(intentProductOptionList.map((p) => p.id))
    const fallback = intentProductOptionList[0]?.id ?? ""
    if (!fallback) return
    const key = form.intentType === "clear" ? "intentQuestions" : "intentRoughItems"
    setForm((f) => {
      const items = f[key]
      const patched = items.map((q) => ({
        ...q,
        productId: q.productId && validIds.has(q.productId) ? q.productId : fallback,
      }))
      const unchanged = patched.every((q, i) => q.productId === items[i]?.productId)
      if (unchanged) return f
      return { ...f, [key]: patched }
    })
  }, [hydrated, form.intentType, intentProductOptionList])

  function set<K extends keyof GeoFormData>(key: K, val: GeoFormData[K]) {
    setForm((f) => ({ ...f, [key]: val }))
    if (errors[key as string]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const productComplete = form.products.length > 0 && form.products.every((p) => p.name.trim())

  const progress = useMemo(() => {
    const checks = [
      !!form.companyName,
      !!form.contactName && !!form.contactTitle && !!form.contactPhone,
      !!form.brandName,
      !!form.scopeType,
      form.scopeType !== "specific" || productComplete,
      (form.intentType === "clear" && form.intentQuestions.some((q) => q.text.trim())) ||
        (form.intentType === "rough" && form.intentRoughItems.some((q) => q.text.trim())),
      (form.brandCompetitors ?? []).some((c) => c.trim()),
      form.platforms.length > 0,
      !!form.optimizePeriod &&
        (["3", "6", "12"].includes(form.optimizePeriod) ||
          (form.optimizePeriod === "custom" && !!form.optimizePeriodCustom?.trim())),
      !!form.expectedStartDate,
      (form.goals?.length ?? 0) > 0,
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form, productComplete])

  function saveDraft() {
    if (saveIntakeDraft(form, inviteToken, DRAFT_SUFFIX)) {
      toast.success("草稿已保存", { description: "您可以稍后回到此页面继续填写。" })
    } else {
      toast.error("草稿保存失败", { description: "浏览器无法保存草稿，请检查存储空间或隐私设置。" })
    }
  }

  async function submit() {
    if (submitting) return
    const e = validateDomesticIntakeForm(form, (phone) => PHONE_RE_CN.test(phone.trim()))
    setErrors(e)
    if (Object.keys(e).length > 0) {
      toast.error("还有必填信息未完成", { description: "请检查标红的项目后再提交。" })
      const firstKey = Object.keys(e)[0]
      document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    try {
      setSubmitting(true)
      if (!inviteToken?.trim()) {
        throw new Error("请通过销售提供的专属链接访问后再提交")
      }
      const payload = stampGeoVariant(form, "domestic")
      const requestBody = {
        data: payload,
        status: "submitted" as const,
        inviteToken,
      }
      await saveSubmissionLocally(requestBody)
      const res = await fetch(INTAKE_SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(parseApiErrorMessage(err, "提交失败"))
      }
      const record = (await res.json()) as { code: string; reused?: boolean }
      clearIntakeDraft(inviteToken, DRAFT_SUFFIX)
      if (record.reused) {
        toast.info("该需求刚刚已提交", {
          description: `需求编号 ${record.code}，无需重复提交。`,
        })
      }
      setSubmittedCode(record.code)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (err) {
      toast.error("提交失败", { description: err instanceof Error ? err.message : "请稍后重试" })
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setForm(emptyDomesticForm())
    setErrors({})
    setSubmittedCode(null)
  }

  if (!hydrated) return null
  if (submittedCode) return <SubmitSuccess code={submittedCode} onReset={resetForm} />

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-5">
          <div>
            <h1 className="text-base font-semibold tracking-tight">客户需求填报</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">国内 GEO 优化需求收集</p>
          </div>
          <div className="flex flex-1 items-center justify-end gap-3">
            <div className="hidden flex-1 items-center gap-2 sm:flex">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="w-9 text-right text-xs font-medium tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={saveDraft}>
              <Save className="size-4" />
              保存草稿
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 md:py-10">
        <div className="mb-7 rounded-2xl border border-border bg-card p-5 md:p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            <Sparkles className="size-3.5" />
            预计用时 3—5 分钟
          </span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance">国内 GEO 优化需求收集</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            为了更准确地了解您的业务和优化需求，请填写以下基础信息。带{" "}
            <span className="text-destructive">*</span> 为必填项。不确定的内容可以选择「暂不清楚」，后续由项目顾问协助确认。
          </p>
        </div>

        <div className="space-y-6">
          <SectionCard step="一" title="项目联系人" desc="收集公司及联系人信息">
            <div id="field-companyName">
              <Field label="1. 公司名称" required hint="请输入本次合作对应的公司主体。" error={errors.companyName}>
                <Input placeholder="请输入公司名称" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
              </Field>
            </div>
            <div id="field-contactName">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                2. 项目联系人<span className="text-destructive">*</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">请输入负责本项目沟通的联系人信息。</p>
              <div className="mt-2.5 grid gap-4 sm:grid-cols-3">
                <Field label="姓名" required error={errors.contactName}>
                  <Input placeholder="例如：张三" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
                </Field>
                <div id="field-contactTitle">
                  <Field label="职位" required error={errors.contactTitle}>
                    <Input placeholder="例如：市场经理" value={form.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} />
                  </Field>
                </div>
                <div id="field-contactPhone">
                  <Field label="手机号" required error={errors.contactPhone}>
                    <Input inputMode="tel" placeholder="例如：13800000000" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
                  </Field>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard step="二" title="品牌与产品信息" desc="收集品牌、优化范围、产品介绍及官网信息">
            <div id="field-brandName">
              <Field
                label="3. 希望优化的品牌名称"
                required
                hint="请填写希望在豆包、DeepSeek 等 AI 平台中提升曝光和推荐表现的品牌。"
                error={errors.brandName}
              >
                <Input placeholder="请输入品牌名称" value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
              </Field>
            </div>
            <div id="field-scopeType">
              <Field label="4. 优化对象" required hint="请选择本次希望优化的对象。" error={errors.scopeType}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard selected={form.scopeType === "brand_only"} onSelect={() => set("scopeType", "brand_only")} title="仅优化品牌整体" desc="只针对品牌名称做整体优化" />
                  <ChoiceCard selected={form.scopeType === "specific"} onSelect={() => set("scopeType", "specific")} title="优化具体产品或服务" desc="针对具体的产品或服务做优化" />
                </div>
              </Field>
            </div>
            {form.scopeType === "specific" && (
              <div id="field-product" className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                <Field
                  label="产品 / 服务名称"
                  required
                  hint="只需填写产品或服务名称，可添加多个。"
                  error={errors.product}
                >
                  <ProductEditor value={form.products} onChange={(v) => set("products", v)} hasError={!!errors.product} nameOnly />
                </Field>
              </div>
            )}
            <div id="field-hasOverseasSite">
              <Field label="5. 是否有国内官方网站？" error={errors.hasOverseasSite}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard selected={form.hasOverseasSite === "yes"} onSelect={() => set("hasOverseasSite", "yes")} title="有官网" desc="提供可访问的国内官方网站地址" />
                  <ChoiceCard selected={form.hasOverseasSite === "no"} onSelect={() => set("hasOverseasSite", "no")} title="暂无官网" desc="暂无官网也可继续填写后续需求" />
                </div>
              </Field>
            </div>
            {form.hasOverseasSite === "yes" && (
              <div id="field-overseasSiteUrl" className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                <Field label="官网地址" required hint="请输入完整的官网地址。" error={errors.overseasSiteUrl}>
                  <Input
                    inputMode="url"
                    placeholder="例如：https://www.threathunter.com/"
                    value={form.overseasSiteUrl}
                    onChange={(e) => set("overseasSiteUrl", e.target.value)}
                  />
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 text-primary" />
                    出于品牌保密考虑，网址在系统中将以脱敏方式存储与展示。
                  </p>
                </Field>
              </div>
            )}

          </SectionCard>

          <SectionCard step="三" title="GEO 优化需求" desc="收集意图、平台、周期、目标与企业实力信息">
            <div id="field-intent">
              <Field
                label="6. 您希望用户搜索什么问题时看到您的品牌？"
                required
                hint="请二选一，并填写对应内容，不可留空。也可先提供核心词/品牌词，由项目团队协助筛选意图问句。"
                error={errors.intent}
              >
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ChoiceCard
                      selected={form.intentType === "clear"}
                      onSelect={() => {
                        set("intentType", "clear")
                        if (errors.intent) setErrors((e) => ({ ...e, intent: undefined }))
                      }}
                      title="我有明确的问题"
                      desc="按优先级填写问题（Top 1 最高）；选择对应产品，Enter 添加下一个"
                    />
                    <ChoiceCard
                      selected={form.intentType === "rough"}
                      onSelect={() => {
                        set("intentType", "rough")
                        if (errors.intent) setErrors((e) => ({ ...e, intent: undefined }))
                      }}
                      title="我只有大致业务方向"
                      desc="按优先级填写业务方向（Top 1 最高）；选择对应产品，Enter 添加下一个"
                    />
                  </div>
                  {form.intentType === "clear" && (
                    <div className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                      <IntentQuestionEditor
                        value={form.intentQuestions}
                        onChange={(v) => {
                          set("intentQuestions", v)
                          if (errors.intent) setErrors((e) => ({ ...e, intent: undefined }))
                        }}
                        productOptions={intentProductOptionList}
                        variant="clear"
                      />
                    </div>
                  )}
                  {form.intentType === "rough" && (
                    <div className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                      <IntentQuestionEditor
                        value={form.intentRoughItems}
                        onChange={(v) => {
                          set("intentRoughItems", v)
                          if (errors.intent) setErrors((e) => ({ ...e, intent: undefined }))
                        }}
                        productOptions={intentProductOptionList}
                        variant="rough"
                      />
                    </div>
                  )}
                </div>
              </Field>
            </div>

            <div id="field-brandCompetitors">
              <Field
                label="7. 竞品"
                required
                hint="请填写主要竞品名称；可点击添加多个。"
                error={errors.brandCompetitors}
              >
                <RowList
                  value={form.brandCompetitors ?? [""]}
                  onChange={(v) => set("brandCompetitors", v)}
                  placeholder={() => "例如：竞品品牌名称"}
                  addLabel="添加竞品"
                  numbered={false}
                />
              </Field>
            </div>

            <div id="field-platforms">
              <Field label="8. 希望优化的 AI 平台" required hint="可多选：豆包、DeepSeek、元宝、千问。" error={errors.platforms}>
                <ChipGroup
                  options={[...DOMESTIC_AI_PLATFORM_OPTIONS]}
                  value={form.platforms}
                  onChange={(platforms) => set("platforms", platforms)}
                />
              </Field>
            </div>

            <div id="field-optimizePeriod">
              <Field label="9. 希望优化的周期" required error={errors.optimizePeriod}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {DOMESTIC_OPTIMIZE_PERIODS.map((p) => (
                    <div key={p.value} className="min-w-0">
                      <ChoiceCard
                        selected={form.optimizePeriod === p.value}
                        onSelect={() => {
                          set("optimizePeriod", p.value)
                          if (p.value !== "custom") set("optimizePeriodCustom", "")
                        }}
                        title={p.label}
                      />
                    </div>
                  ))}
                </div>
                {form.optimizePeriod === "custom" && (
                  <Input
                    className="mt-3 max-w-sm"
                    placeholder="请填写自定义优化周期，如：9 个月"
                    value={form.optimizePeriodCustom ?? ""}
                    onChange={(e) => set("optimizePeriodCustom", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div id="field-budget">
              <Field label="10. 预算" hint="选填，请填写预计预算或预算范围。">
                <Input
                  className="max-w-sm"
                  placeholder="如：30 万元 / 20–30 万元"
                  value={form.budget ?? ""}
                  onChange={(e) => set("budget", e.target.value)}
                />
              </Field>
            </div>

            <div id="field-expectedStartDate">
              <Field label="11. 您的预计执行时间" required hint="请选择未来具体日期。" error={errors.expectedStartDate}>
                <Input
                  type="date"
                  min={todayISO()}
                  value={form.expectedStartDate ?? ""}
                  onChange={(e) => set("expectedStartDate", e.target.value)}
                  className="max-w-xs"
                />
              </Field>
            </div>

            <div id="field-goals">
              <Field
                label="12. 您的具体优化目标"
                required
                hint="请选择本次项目的核心考核指标，可多选。最终目标及考核规则将以双方确认的 SOW 为准。"
                error={errors.goals}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {DOMESTIC_OPTIMIZATION_GOALS.map((g) => {
                    const selected = (form.goals ?? []).includes(g.value)
                    return (
                      <div key={g.value} className="min-w-0">
                        <ChoiceCard
                          selected={selected}
                          onSelect={() => {
                            const cur = form.goals ?? []
                            set(
                              "goals",
                              selected ? cur.filter((v) => v !== g.value) : [...cur, g.value],
                            )
                          }}
                          title={g.label}
                        />
                      </div>
                    )
                  })}
                </div>
              </Field>
            </div>

            <div id="field-strengths">
              <Field
                label="13. 企业实力"
                hint="如：市场业绩、技术能力、品牌口碑声誉、生态优势等"
              >
                <Textarea
                  rows={4}
                  placeholder="如：市场业绩、技术能力、品牌口碑声誉、生态优势等"
                  value={form.strengthMarket ?? ""}
                  onChange={(e) => set("strengthMarket", e.target.value)}
                />
              </Field>
            </div>
          </SectionCard>

          <div className="rounded-2xl border border-border bg-secondary/40 p-5 text-sm leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">提交后，项目团队将基于以上信息完成：</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {["网站及 GEO 基础诊断", "用户意图挖掘", "优化范围确认", "KPI 及服务周期确认", "SOW 内容整理"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" size="lg" className="gap-1.5" onClick={saveDraft}>
              <Save className="size-4" />
              保存草稿
            </Button>
            <Button size="lg" className="gap-1.5" onClick={submit} disabled={submitting}>
              <Send className="size-4" />
              {submitting ? "提交中..." : "提交需求"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}

function SubmitSuccess({ code, onReset }: { code: string; onReset: () => void }) {
  async function copyCode() {
    const copied = await copyToClipboard(code)
    if (copied) toast.success("需求编号已复制")
    else toast.error("复制失败，请手动复制")
  }
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center px-5 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">
        <CheckCircle2 className="size-9" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">需求提交成功</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        感谢您的填写！项目团队会尽快与您联系，并基于这份需求开展 GEO 诊断、意图挖掘与方案准备。
      </p>
      <div className="mt-6 w-full rounded-2xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground">您的需求编号</p>
        <div className="mt-2 flex items-center justify-center gap-3">
          <p className="font-mono text-xl font-semibold tracking-wide">{code}</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copyCode}>
            <Copy className="size-3.5" />
            复制
          </Button>
        </div>
      </div>
      <Button variant="outline" className="mt-8 gap-1.5" onClick={onReset}>
        <RotateCcw className="size-4" />
        再填一份
      </Button>
    </main>
  )
}
