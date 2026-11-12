"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Copy, Lock, RotateCcw, Save, Send, Sparkles } from "lucide-react"
import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import { copyToClipboard } from "@/shared/lib/copy-to-clipboard"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { toast } from "sonner"
import { readRaw, removeRaw } from "@/shared/lib/storage"
import {
  AI_PLATFORM_OPTIONS,
  OPTIMIZATION_GOALS,
  OVERSEAS_RECOMMENDATION_GOALS,
  emptyFormForVariant,
  intentProductOptions,
  intakeVariantDraftSuffix,
  isProductComplete,
  normalizeIntentQuestions,
  normalizeIntentRoughItems,
  saveIntakeDraft,
  clearIntakeDraft,
  loadIntakeDraftRaw,
  stampGeoVariant,
  syncRegionsForPlatforms,
  validateIntakeForm,
  type GeoFormData,
  type IntakeGeoVariant,
} from "@/modules/intake"
import { ChoiceCard, ChipGroup, Field, IntentQuestionEditor, ProductEditor, RegionEditor, RowList, SectionCard } from "@/modules/intake/components/form-bits"
import { DomesticIntakeForm } from "@/modules/intake/components/domestic-intake-form"

const LEGACY_DRAFT_KEY = "geo-form-draft"
const AUTO_SAVE_MS = 500

type Errors = Partial<Record<string, string>>

export function IntakeForm({ variant = "overseas" }: { variant?: IntakeGeoVariant }) {
  if (variant === "domestic") return <DomesticIntakeForm />
  return <OverseasIntakeForm />
}

function OverseasIntakeForm() {
  const draftSuffix = intakeVariantDraftSuffix("overseas")
  const [form, setForm] = useState<GeoFormData>(() => emptyFormForVariant("overseas"))
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
      const raw = loadIntakeDraftRaw(draftSuffix) ?? readRaw("local", LEGACY_DRAFT_KEY)
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<GeoFormData>
          const base = emptyFormForVariant("overseas")
          const productOptions = intentProductOptions({ ...base, ...parsed } as GeoFormData)
          const defaultProductId = productOptions[0]?.id ?? ""
          const platforms = Array.isArray(parsed.platforms) ? parsed.platforms : base.platforms
          setForm({
            ...base,
            ...parsed,
            platforms,
            regions: syncRegionsForPlatforms(parsed.regions ?? base.regions, platforms),
            goals: parsed.goals?.length ? parsed.goals : parsed.goal ? [parsed.goal] : [],
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
  }, [draftSuffix])

  useEffect(() => {
    if (!hydrated || submittedCode) return
    const timer = window.setTimeout(() => saveIntakeDraft(form, draftSuffix), AUTO_SAVE_MS)
    return () => window.clearTimeout(timer)
  }, [form, hydrated, submittedCode, draftSuffix])

  useEffect(() => {
    if (!hydrated || submittedCode) return
    const flush = () => saveIntakeDraft(formRef.current, draftSuffix)
    window.addEventListener("pagehide", flush)
    return () => window.removeEventListener("pagehide", flush)
  }, [hydrated, submittedCode, draftSuffix])

  const intentProductOptionList = useMemo(() => intentProductOptions(form), [form])

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
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function setPlatforms(platforms: string[]) {
    setForm((current) => ({
      ...current,
      platforms,
      regions: syncRegionsForPlatforms(current.regions, platforms),
    }))
    setErrors((current) => ({ ...current, platforms: undefined, regions: undefined }))
  }

  const selectedGoals = form.goals?.length ? form.goals : form.goal ? [form.goal] : []

  function setGoals(goals: string[]) {
    const ordered = OPTIMIZATION_GOALS.map((item) => item.value).filter((value) => goals.includes(value))
    setForm((current) => ({ ...current, goals: ordered, goal: ordered[0] || "" }))
    if (errors.goal) setErrors((current) => ({ ...current, goal: undefined }))
  }

  const productComplete = form.products.length > 0 && form.products.every(isProductComplete)

  const progress = useMemo(() => {
    const checks = [
      !!form.companyName,
      !!form.contactName && !!form.contactTitle && !!form.contactPhone,
      !!form.brandName,
      !!form.scopeType,
      form.scopeType !== "specific" || productComplete,
      form.hasOverseasSite === "no" || (form.hasOverseasSite === "yes" && !!form.overseasSiteUrl),
      !!form.targetCustomer,
      form.platforms.length > 0,
      form.platforms.length > 0 && form.platforms.every((platform) => form.regions.some((r) => r.platform === platform && r.country && r.language)),
      (form.intentType === "clear" && form.intentQuestions.some((q) => q.text.trim())) ||
        (form.intentType === "rough" && form.intentRoughItems.some((q) => q.text.trim())),
      selectedGoals.length > 0,
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form, productComplete, selectedGoals.length])

  function validate(): Errors {
    return validateIntakeForm(form)
  }

  function saveDraft() {
    saveIntakeDraft(form, draftSuffix)
    toast.success("草稿已保存", { description: "您可以稍后回到此页面继续填写。" })
  }

  async function submit() {
    if (submitting) return
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) {
      toast.error("还有必填信息未完成", { description: "请检查标红的项目后再提交。" })
      const firstKey = Object.keys(e)[0]
      document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    try {
      setSubmitting(true)
      const payload = stampGeoVariant(form, "overseas")
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload, status: "submitted" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(parseApiErrorMessage(err, "提交失败"))
      }
      const record = (await res.json()) as { code: string; reused?: boolean }
      clearIntakeDraft(draftSuffix)
      removeRaw("local", LEGACY_DRAFT_KEY)
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
    setForm(emptyFormForVariant("overseas"))
    setErrors({})
    setSubmittedCode(null)
  }

  if (!hydrated) return null

  if (submittedCode) {
    return <SubmitSuccess code={submittedCode} onReset={resetForm} />
  }

  return (
    <div>
      {/* 页内顶栏：进度 + 保存草稿 */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-5">
          <div>
            <h1 className="text-base font-semibold tracking-tight">客户需求填报</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">海外 GEO 优化需求收集</p>
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
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance">海外 GEO 优化需求收集</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            为了更准确地了解您的业务和优化需求，请填写以下基础信息。带 <span className="text-destructive">*</span> 为必填项，其余可稍后由项目顾问协助补充。
          </p>
        </div>

        <div className="space-y-6">
          {/* 模块一 */}
          <SectionCard step="一" title="项目联系人" desc="收集公司及联系人信息">
            <div id="field-companyName">
              <Field label="1. 公司名称" required hint="请填写本次合作对应的公司主体。" error={errors.companyName}>
                <Input
                  placeholder="例如：字节跳动有限公司"
                  value={form.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                />
              </Field>
            </div>
            <div id="field-contactName">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                2. 联系人信息<span className="text-destructive">*</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">请填写本次对接的联系人姓名、职位与手机号。</p>
              <div className="mt-2.5 grid gap-4 sm:grid-cols-3">
                <Field label="联系人姓名" required error={errors.contactName}>
                  <Input placeholder="例如：张三" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
                </Field>
                <div id="field-contactTitle">
                  <Field label="职位" required error={errors.contactTitle}>
                    <Input placeholder="例如：海外市场经理" value={form.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} />
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

          {/* 模块二 */}
          <SectionCard step="二" title="品牌与产品信息" desc="收集品牌、优化范围、目标用户、产品介绍及官网信息">
            <div id="field-brandName">
              <Field
                label="3. 希望优化的品牌名称"
                required
                hint="请填写希望在所选 AI 平台中提升曝光和推荐表现的品牌；如有多个常用叫法，可补充别名。"
                error={errors.brandName}
              >
                <Input placeholder="例如：苹果" value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
                <div className="mt-3">
                  <p className="mb-2 text-xs leading-relaxed text-muted-foreground">品牌别名（选填）：同一品牌的其他叫法，如「苹果」别名「Apple」。</p>
                  <RowList
                    value={form.brandAliases}
                    onChange={(v) => set("brandAliases", v)}
                    placeholder={() => "例如：Apple"}
                    addLabel="添加别名"
                    numbered={false}
                  />
                </div>
              </Field>
            </div>

            <div id="field-scopeType">
              <Field label="4. 本次优化范围" required hint="请选择本次希望优化的范围。" error={errors.scopeType}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard
                    selected={form.scopeType === "brand_only"}
                    onSelect={() => set("scopeType", "brand_only")}
                    title="仅优化品牌整体"
                    desc="只针对品牌名称做整体优化"
                  />
                  <ChoiceCard
                    selected={form.scopeType === "specific"}
                    onSelect={() => set("scopeType", "specific")}
                    title="优化具体产品或服务"
                    desc="针对具体的产品或服务做优化"
                  />
                </div>
              </Field>
            </div>

            {form.scopeType === "specific" && (
              <div id="field-product" className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                <Field
                  label="请简单介绍该产品或服务"
                  required
                  hint="请按优先级从高到低填写（Top 1 为最高优先级）。可添加多个产品或服务，每个都需填写名称，并分别说明功能、主要用户群体与应用场景。"
                  error={errors.product}
                >
                  <ProductEditor value={form.products} onChange={(v) => set("products", v)} hasError={!!errors.product} />
                </Field>
              </div>
            )}

            <div id="field-targetCustomer">
              <Field
                label="5. 品牌核心目标用户"
                required
                hint="请选择品牌主要面向的目标用户类型。"
                error={errors.targetCustomer}
              >
                <div className="grid gap-2">
                  <ChoiceCard
                    selected={form.targetCustomer === "toc"}
                    onSelect={() => set("targetCustomer", "toc")}
                    title="A、TOC"
                    desc="个人消费者：品牌核心目标用户为普通个人消费者，聚焦个体日常消费场景"
                  />
                  <ChoiceCard
                    selected={form.targetCustomer === "tob"}
                    onSelect={() => set("targetCustomer", "tob")}
                    title="B、TOB"
                    desc="企业/机构客户：品牌核心目标用户为企业、机构、组织等商业客户"
                  />
                  <ChoiceCard
                    selected={form.targetCustomer === "both"}
                    onSelect={() => set("targetCustomer", "both")}
                    title="C、TOC & TOB"
                    desc="两类用户均覆盖：同时覆盖个人消费者与企业、机构等商业客户"
                  />
                </div>
              </Field>
            </div>

            <div id="field-hasOverseasSite">
              <Field label="6. 是否有海外官方网站？" required error={errors.hasOverseasSite}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard selected={form.hasOverseasSite === "yes"} onSelect={() => set("hasOverseasSite", "yes")} title="有海外官网" />
                  <ChoiceCard selected={form.hasOverseasSite === "no"} onSelect={() => set("hasOverseasSite", "no")} title="暂无海外官网" />
                </div>
              </Field>
            </div>
            {form.hasOverseasSite === "yes" && (
              <div id="field-overseasSiteUrl" className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                <Field label="海外官网地址" required hint="请输入完整的海外官网地址。" error={errors.overseasSiteUrl}>
                  <Input
                    inputMode="url"
                    placeholder="例如：https://www.example.com"
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

          {/* 模块三 */}
          <SectionCard step="三" title="GEO 优化需求" desc="收集国家语言、平台、优化背景、用户问题及优化目标">
            <div id="field-platforms">
              <Field
                label="7. 希望优化的 AI 平台"
                required
                hint="支持多选。请先选择平台，再分别配置每个平台对应的国家与语言。"
                error={errors.platforms}
              >
                <ChipGroup options={AI_PLATFORM_OPTIONS} value={form.platforms} onChange={setPlatforms} />
              </Field>
            </div>
            <div id="field-regions">
              <Field
                label="8. 各平台重点优化的国家与语言"
                required
                hint="每个已选平台都需至少配置一组国家与语言；可为同一平台添加多组。"
                error={errors.regions}
              >
                <RegionEditor platforms={form.platforms} value={form.regions} onChange={(v) => set("regions", v)} />
              </Field>
            </div>
            <Field label="9. 优化背景" hint="帮助我们更好地匹配优化节奏，此项选填。">
              <Textarea
                rows={3}
                placeholder="是否有营销规划 / 排期？如有可以自定义填写"
                value={form.optimizeBackground}
                onChange={(e) => set("optimizeBackground", e.target.value)}
              />
            </Field>
            <div id="field-intent">
              <Field
                label="10. 您希望用户搜索什么问题时看到您的品牌？"
                required
                hint="请二选一，并填写对应内容，不可留空。"
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
            <div id="field-goal">
              <Field
                label="11. 您的具体优化目标"
                required
                hint="来源率可独立选择；推荐率指标只能在推荐率、前三推荐率、优先推荐率中选择一项。最终以双方确认的 SOW 为准。"
                error={errors.goal}
              >
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">来源指标（可独立勾选）</p>
                    {OPTIMIZATION_GOALS.filter((goal) => goal.value === "source").map((goal) => (
                      <ChoiceCard key={goal.value} selected={selectedGoals.includes(goal.value)} onSelect={() => setGoals(selectedGoals.includes(goal.value) ? selectedGoals.filter((value) => value !== goal.value) : [...selectedGoals, goal.value])} title={goal.label} desc={goal.desc} />
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">推荐率指标（以下三选一）</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {OPTIMIZATION_GOALS.filter((goal) => OVERSEAS_RECOMMENDATION_GOALS.includes(goal.value as (typeof OVERSEAS_RECOMMENDATION_GOALS)[number])).map((goal) => (
                        <ChoiceCard key={goal.value} selected={selectedGoals.includes(goal.value)} onSelect={() => { const withoutRecommendation = selectedGoals.filter((value) => !OVERSEAS_RECOMMENDATION_GOALS.includes(value as (typeof OVERSEAS_RECOMMENDATION_GOALS)[number])); setGoals(selectedGoals.includes(goal.value) ? withoutRecommendation : [...withoutRecommendation, goal.value]) }} title={goal.label} desc={goal.desc} />
                      ))}
                    </div>
                  </div>
                </div>
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
    if (copied) {
      toast.success("需求编号已复制")
    } else {
      toast.error("复制失败，请手动复制")
    }
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
          <span className="font-mono text-lg font-semibold">{code}</span>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copyCode}>
            <Copy className="size-3.5" />
            复制
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">请保存此编号，以便后续与项目顾问沟通时核对。</p>
      </div>
      <Button variant="ghost" className="mt-6 gap-1.5" onClick={onReset}>
        <RotateCcw className="size-4" />
        再填写一份新的需求
      </Button>
    </main>
  )
}
