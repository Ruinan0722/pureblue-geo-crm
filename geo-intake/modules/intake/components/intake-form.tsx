"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Copy, Lock, RotateCcw, Save, Send, Sparkles } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { parseApiErrorMessage } from "@/shared/lib/parse-api-error"
import { copyToClipboard } from "@/shared/lib/copy-to-clipboard"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { toast } from "sonner"
import {
  AI_PLATFORM_OPTIONS,
  emptyFormForVariant,
  intentProductOptions,
  intakeVariantDraftSuffix,
  isProductComplete,
  normalizeCountryKey,
  normalizeIntentQuestions,
  normalizeLanguageKey,
  normalizeIntentRoughItems,
  saveIntakeDraft,
  clearIntakeDraft,
  loadIntakeDraftRaw,
  stampGeoVariant,
  validateIntakeForm,
  type GeoFormData,
  type IntakeGeoVariant,
} from "@/modules/intake"
import { useOptimizationGoals } from "@/modules/i18n/lib/form-options-i18n"
import { ChoiceCard, ChipGroup, Field, IntentQuestionEditor, ProductEditor, RegionEditor, RowList, SectionCard } from "@/modules/intake/components/form-bits"
import { DomesticIntakeForm } from "@/modules/intake/components/domestic-intake-form"
import { saveSubmissionLocally } from "@/modules/intake-backup/lib/client"

const LEGACY_DRAFT_KEY = "geo-form-draft"
const AUTO_SAVE_MS = 500
/**
 * 提交地址：同源 /api/intake/submit（默认）。
 * next.config rewrite 在服务端代理到 GEO_API_URL——浏览器不跨域，避免网关 CORS 预检 405。
 * 仅特殊部署（如需要绕过代理直连）才注入 NEXT_PUBLIC_INTAKE_SUBMIT_URL 覆盖。
 */
const INTAKE_SUBMIT_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_INTAKE_SUBMIT_URL?.trim()) ||
  "/api/intake/submit"

type Errors = Partial<Record<string, string>>

const PHONE_RE_CN = /^1[3-9]\d{9}$/
const PHONE_RE_INTL = /^\+?[\d\s\-()]{7,20}$/

function migrateDraft(parsed: Partial<GeoFormData>): Partial<GeoFormData> {
  return {
    ...parsed,
    regions: parsed.regions?.map((r) => ({
      ...r,
      country: normalizeCountryKey(r.country),
      language: normalizeLanguageKey(r.language),
    })),
  }
}

export function IntakeForm({
  inviteToken,
  variant = "overseas",
}: {
  inviteToken: string
  variant?: IntakeGeoVariant
}) {
  if (variant === "domestic") return <DomesticIntakeForm inviteToken={inviteToken} />
  return <OverseasIntakeForm inviteToken={inviteToken} />
}

function OverseasIntakeForm({ inviteToken }: { inviteToken: string }) {
  const t = useTranslations("form")
  const tUtils = useTranslations("formUtils")
  const locale = useLocale()
  const optimizationGoals = useOptimizationGoals()
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
      const raw =
        loadIntakeDraftRaw(inviteToken, draftSuffix) ?? window.localStorage.getItem(LEGACY_DRAFT_KEY)
      if (raw) {
        try {
          const parsed = migrateDraft(JSON.parse(raw) as Partial<GeoFormData>)
          const base = emptyFormForVariant("overseas")
          const productOptions = intentProductOptions(
            { ...base, ...parsed } as GeoFormData,
            tUtils("brandOverall"),
          )
          const defaultProductId = productOptions[0]?.id ?? ""
          setForm({
            ...base,
            ...parsed,
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
  }, [tUtils, inviteToken, draftSuffix])

  useEffect(() => {
    if (!hydrated || submittedCode) return
    const timer = window.setTimeout(() => saveIntakeDraft(form, inviteToken, draftSuffix), AUTO_SAVE_MS)
    return () => window.clearTimeout(timer)
  }, [form, hydrated, submittedCode, inviteToken, draftSuffix])

  useEffect(() => {
    if (!hydrated || submittedCode) return
    const flush = () => saveIntakeDraft(formRef.current, inviteToken, draftSuffix)
    window.addEventListener("pagehide", flush)
    return () => window.removeEventListener("pagehide", flush)
  }, [hydrated, submittedCode, inviteToken, draftSuffix])

  const intentProductOptionList = useMemo(
    () => intentProductOptions(form, tUtils("brandOverall")),
    [form, tUtils],
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
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
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
      form.regions.some((r) => r.country && r.language),
      form.platforms.length > 0,
      (form.intentType === "clear" && form.intentQuestions.some((q) => q.text.trim())) ||
        (form.intentType === "rough" && form.intentRoughItems.some((q) => q.text.trim())),
      !!form.goal,
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form, productComplete])

  function isPhoneValid(phone: string): boolean {
    const trimmed = phone.trim()
    if (locale === "zh-CN") return PHONE_RE_CN.test(trimmed)
    return PHONE_RE_INTL.test(trimmed)
  }

  function validate(): Errors {
    return validateIntakeForm(form, isPhoneValid, {
      companyName: t("validation.companyName"),
      contactName: t("validation.contactName"),
      contactTitle: t("validation.contactTitle"),
      contactPhone: t("validation.contactPhone"),
      contactPhoneInvalid: t("validation.contactPhoneInvalid"),
      brandName: t("validation.brandName"),
      scopeType: t("validation.scopeType"),
      product: t("validation.product"),
      hasOverseasSite: t("validation.hasOverseasSite"),
      overseasSiteUrl: t("validation.overseasSiteUrl"),
      overseasSiteUrlInvalid: t("validation.overseasSiteUrlInvalid"),
      targetCustomer: t("validation.targetCustomer"),
      regions: t("validation.regions"),
      platforms: t("validation.platforms"),
      intent: t("validation.intent"),
      goal: t("validation.goal"),
    })
  }

  function mapApiError(message: string): string {
    const known: Record<string, string> = {
      "请通过销售提供的专属链接访问后再提交": t("errors.missingInvite"),
      "Please access via the exclusive link from your sales contact before submitting": t("errors.missingInvite"),
    }
    return known[message] ?? message
  }

  function saveDraft() {
    if (saveIntakeDraft(form, inviteToken, draftSuffix)) {
      toast.success(t("toast.draftSaved"), { description: t("toast.draftSavedDesc") })
    } else {
      toast.error(t("toast.draftSaveFailed"), { description: t("toast.draftSaveFailedDesc") })
    }
  }

  async function submit() {
    if (submitting) return
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) {
      toast.error(t("toast.incomplete"), { description: t("toast.incompleteDesc") })
      const firstKey = Object.keys(e)[0]
      document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    try {
      setSubmitting(true)
      if (!inviteToken?.trim()) {
        throw new Error(mapApiError(t("errors.missingInvite")))
      }
      const payload = stampGeoVariant(form, "overseas")
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
        throw new Error(mapApiError(parseApiErrorMessage(err, t("errors.submitFailed"))))
      }
      const record = (await res.json()) as { code: string; reused?: boolean }
      clearIntakeDraft(inviteToken, draftSuffix)
      if (typeof window !== "undefined") window.localStorage.removeItem(LEGACY_DRAFT_KEY)
      if (record.reused) {
        toast.info(t("toast.alreadySubmitted"), {
          description: t("toast.alreadySubmittedDesc", { code: record.code }),
        })
      }
      setSubmittedCode(record.code)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (err) {
      toast.error(t("toast.submitFailed"), {
        description: err instanceof Error ? err.message : t("toast.retryLater"),
      })
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

  const afterSubmitItems = [0, 1, 2, 3, 4].map((i) => t(`afterSubmitItems.${i}` as "afterSubmitItems.0"))

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-5">
          <div>
            <h1 className="text-base font-semibold tracking-tight">{t("pageTitle")}</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">{t("pageSubtitle")}</p>
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
              {t("saveDraft")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 md:py-10">
        <div className="mb-7 rounded-2xl border border-border bg-card p-5 md:p-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            <Sparkles className="size-3.5" />
            {t("heroBadge")}
          </span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance">{t("heroTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t.rich("heroDescription", {
              asterisk: (chunks) => <span className="text-destructive">{chunks}</span>,
            })}
          </p>
        </div>

        <div className="space-y-6">
          <SectionCard step={t("sections.contact.step")} title={t("sections.contact.title")} desc={t("sections.contact.desc")}>
            <div id="field-companyName">
              <Field label={t("fields.companyName.label")} required hint={t("fields.companyName.hint")} error={errors.companyName}>
                <Input
                  placeholder={t("fields.companyName.placeholder")}
                  value={form.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                />
              </Field>
            </div>
            <div id="field-contactName">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {t("fields.contactInfo.label")}
                <span className="text-destructive">*</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("fields.contactInfo.hint")}</p>
              <div className="mt-2.5 grid gap-4 sm:grid-cols-3">
                <Field label={t("fields.contactName.label")} required error={errors.contactName}>
                  <Input
                    placeholder={t("fields.contactName.placeholder")}
                    value={form.contactName}
                    onChange={(e) => set("contactName", e.target.value)}
                  />
                </Field>
                <div id="field-contactTitle">
                  <Field label={t("fields.contactTitle.label")} required error={errors.contactTitle}>
                    <Input
                      placeholder={t("fields.contactTitle.placeholder")}
                      value={form.contactTitle}
                      onChange={(e) => set("contactTitle", e.target.value)}
                    />
                  </Field>
                </div>
                <div id="field-contactPhone">
                  <Field label={t("fields.contactPhone.label")} required error={errors.contactPhone}>
                    <Input
                      inputMode="tel"
                      placeholder={t("fields.contactPhone.placeholder")}
                      value={form.contactPhone}
                      onChange={(e) => set("contactPhone", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard step={t("sections.brand.step")} title={t("sections.brand.title")} desc={t("sections.brand.desc")}>
            <div id="field-brandName">
              <Field
                label={t("fields.brandName.label")}
                required
                hint={t("fields.brandName.hint")}
                error={errors.brandName}
              >
                <Input placeholder={t("fields.brandName.placeholder")} value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
                <div className="mt-3">
                  <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{t("fields.brandAliases.hint")}</p>
                  <RowList
                    value={form.brandAliases}
                    onChange={(v) => set("brandAliases", v)}
                    placeholder={() => t("fields.brandAliases.placeholder")}
                    addLabel={t("fields.brandAliases.addLabel")}
                    numbered={false}
                  />
                </div>
              </Field>
            </div>

            <div id="field-scopeType">
              <Field label={t("fields.scopeType.label")} required hint={t("fields.scopeType.hint")} error={errors.scopeType}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard
                    selected={form.scopeType === "brand_only"}
                    onSelect={() => set("scopeType", "brand_only")}
                    title={t("fields.scopeType.brandOnlyTitle")}
                    desc={t("fields.scopeType.brandOnlyDesc")}
                  />
                  <ChoiceCard
                    selected={form.scopeType === "specific"}
                    onSelect={() => set("scopeType", "specific")}
                    title={t("fields.scopeType.specificTitle")}
                    desc={t("fields.scopeType.specificDesc")}
                  />
                </div>
              </Field>
            </div>

            {form.scopeType === "specific" && (
              <div id="field-product" className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                <Field label={t("fields.product.label")} required hint={t("fields.product.hint")} error={errors.product}>
                  <ProductEditor value={form.products} onChange={(v) => set("products", v)} hasError={!!errors.product} />
                </Field>
              </div>
            )}

            <div id="field-targetCustomer">
              <Field
                label={t("fields.targetCustomer.label")}
                required
                hint={t("fields.targetCustomer.hint")}
                error={errors.targetCustomer}
              >
                <div className="grid gap-2">
                  <ChoiceCard
                    selected={form.targetCustomer === "toc"}
                    onSelect={() => set("targetCustomer", "toc")}
                    title={t("fields.targetCustomer.tocTitle")}
                    desc={t("fields.targetCustomer.tocDesc")}
                  />
                  <ChoiceCard
                    selected={form.targetCustomer === "tob"}
                    onSelect={() => set("targetCustomer", "tob")}
                    title={t("fields.targetCustomer.tobTitle")}
                    desc={t("fields.targetCustomer.tobDesc")}
                  />
                  <ChoiceCard
                    selected={form.targetCustomer === "both"}
                    onSelect={() => set("targetCustomer", "both")}
                    title={t("fields.targetCustomer.bothTitle")}
                    desc={t("fields.targetCustomer.bothDesc")}
                  />
                </div>
              </Field>
            </div>

            <div id="field-hasOverseasSite">
              <Field label={t("fields.hasOverseasSite.label")} required error={errors.hasOverseasSite}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard
                    selected={form.hasOverseasSite === "yes"}
                    onSelect={() => set("hasOverseasSite", "yes")}
                    title={t("fields.hasOverseasSite.yesTitle")}
                  />
                  <ChoiceCard
                    selected={form.hasOverseasSite === "no"}
                    onSelect={() => set("hasOverseasSite", "no")}
                    title={t("fields.hasOverseasSite.noTitle")}
                  />
                </div>
              </Field>
            </div>
            {form.hasOverseasSite === "yes" && (
              <div id="field-overseasSiteUrl" className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
                <Field
                  label={t("fields.overseasSiteUrl.label")}
                  required
                  hint={t("fields.overseasSiteUrl.hint")}
                  error={errors.overseasSiteUrl}
                >
                  <Input
                    inputMode="url"
                    placeholder={t("fields.overseasSiteUrl.placeholder")}
                    value={form.overseasSiteUrl}
                    onChange={(e) => set("overseasSiteUrl", e.target.value)}
                  />
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 text-primary" />
                    {t("fields.overseasSiteUrl.privacyNote")}
                  </p>
                </Field>
              </div>
            )}

          </SectionCard>

          <SectionCard step={t("sections.geo.step")} title={t("sections.geo.title")} desc={t("sections.geo.desc")}>
            <div id="field-regions">
              <Field label={t("fields.regions.label")} required hint={t("fields.regions.hint")} error={errors.regions}>
                <RegionEditor value={form.regions} onChange={(v) => set("regions", v)} />
              </Field>
            </div>
            <div id="field-platforms">
              <Field label={t("fields.platforms.label")} required hint={t("fields.platforms.hint")} error={errors.platforms}>
                <ChipGroup
                  options={AI_PLATFORM_OPTIONS}
                  value={form.platforms}
                  onChange={(platforms) => set("platforms", platforms)}
                />
              </Field>
            </div>
            <Field label={t("fields.optimizeBackground.label")} hint={t("fields.optimizeBackground.hint")}>
              <Textarea
                rows={3}
                placeholder={t("fields.optimizeBackground.placeholder")}
                value={form.optimizeBackground}
                onChange={(e) => set("optimizeBackground", e.target.value)}
              />
            </Field>
            <div id="field-intent">
              <Field
                label={t("fields.intent.label")}
                required
                hint={t("fields.intent.hint")}
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
                      title={t("fields.intent.clearTitle")}
                      desc={t("fields.intent.clearDesc")}
                    />
                    <ChoiceCard
                      selected={form.intentType === "rough"}
                      onSelect={() => {
                        set("intentType", "rough")
                        if (errors.intent) setErrors((e) => ({ ...e, intent: undefined }))
                      }}
                      title={t("fields.intent.roughTitle")}
                      desc={t("fields.intent.roughDesc")}
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
              <Field label={t("fields.goal.label")} required hint={t("fields.goal.hint")} error={errors.goal}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {optimizationGoals.map((g) => (
                    <ChoiceCard
                      key={g.value}
                      selected={form.goal === g.value}
                      onSelect={() => set("goal", g.value)}
                      title={g.label}
                      desc={g.desc}
                    />
                  ))}
                </div>
              </Field>
            </div>
          </SectionCard>

          <div className="rounded-2xl border border-border bg-secondary/40 p-5 text-sm leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">{t("afterSubmitTitle")}</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {afterSubmitItems.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" size="lg" className="gap-1.5" onClick={saveDraft}>
              <Save className="size-4" />
              {t("saveDraft")}
            </Button>
            <Button size="lg" className="gap-1.5" onClick={submit} disabled={submitting}>
              <Send className="size-4" />
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}

function SubmitSuccess({ code, onReset }: { code: string; onReset: () => void }) {
  const t = useTranslations("form")

  async function copyCode() {
    const copied = await copyToClipboard(code)
    if (copied) {
      toast.success(t("toast.codeCopied"))
    } else {
      toast.error(t("toast.copyFailed"))
    }
  }

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center px-5 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-accent text-primary">
        <CheckCircle2 className="size-9" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">{t("success.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("success.description")}</p>
      <div className="mt-6 w-full rounded-2xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground">{t("success.codeLabel")}</p>
        <div className="mt-2 flex items-center justify-center gap-3">
          <span className="font-mono text-lg font-semibold">{code}</span>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copyCode}>
            <Copy className="size-3.5" />
            {t("success.copy")}
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("success.codeHint")}</p>
      </div>
      <Button variant="ghost" className="mt-6 gap-1.5" onClick={onReset}>
        <RotateCcw className="size-4" />
        {t("success.reset")}
      </Button>
    </main>
  )
}
