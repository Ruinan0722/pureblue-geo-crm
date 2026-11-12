"use client"

import type { KeyboardEvent, ReactNode } from "react"
import { AlertCircle, Check, Plus, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/shared/lib/utils"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Button } from "@/shared/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import {
  emptyIntentQuestion,
  emptyProduct,
  isProductComplete,
  type IntentQuestionItem,
  type ProductItem,
  type RegionItem,
} from "@/modules/intake"
import { useCountryOptions, useLanguageOptions } from "@/modules/i18n/lib/form-options-i18n"

export function SectionCard({
  step,
  title,
  desc,
  children,
}: {
  step: string
  title: string
  desc?: string
  children: ReactNode
}) {
  return (
    <section className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-sm md:p-7">
      <div className="mb-6 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          {step}
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {desc && <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>}
        </div>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      <div className="mt-2.5">{children}</div>
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-destructive">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      )}
    </div>
  )
}

export function ChipGroup({
  options,
  value,
  onChange,
  multiple = true,
  columns,
}: {
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  multiple?: boolean
  columns?: boolean
}) {
  function toggle(opt: string) {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt))
    } else {
      onChange(multiple ? [...value, opt] : [opt])
    }
  }
  return (
    <div className={cn("flex flex-wrap gap-2", columns && "grid grid-cols-2 sm:grid-cols-3")}>
      {options.map((opt) => {
        const active = value.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent/40",
              columns && "justify-center",
            )}
            aria-pressed={active}
          >
            {/* 始终占位，避免选中后因勾选图标变宽把末项挤到下一行 */}
            <Check className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} aria-hidden={!active} />
            {opt}
          </button>
        )
      })}
    </div>
  )
}

export function RegionEditor({
  value,
  onChange,
}: {
  value: RegionItem[]
  onChange: (next: RegionItem[]) => void
}) {
  const t = useTranslations("formBits")
  const countryOptions = useCountryOptions()
  const languageOptions = useLanguageOptions()

  function update(id: string, patch: Partial<RegionItem>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function add() {
    onChange([...value, { id: `r${Date.now()}`, country: "", language: "" }])
  }
  function remove(id: string) {
    onChange(value.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-2.5">
      {value.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2">
          <SearchableSelect
            className="flex-1"
            value={r.country}
            onValueChange={(v) => update(r.id, { country: v, language: r.language })}
            options={countryOptions}
            placeholder={t("selectCountry")}
            emptyText={t("noCountryMatch")}
          />
          <span className="shrink-0 text-sm text-muted-foreground">-</span>
          <SearchableSelect
            className="flex-1"
            value={r.language}
            onValueChange={(v) => update(r.id, { language: v })}
            options={languageOptions}
            placeholder={t("selectLanguage")}
            emptyText={t("noLanguageMatch")}
          />
          {value.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => remove(r.id)}
              aria-label={t("removeRegion", { index: i + 1 })}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="size-4" />
        {t("addRegion")}
      </Button>
    </div>
  )
}

export function RowList({
  value,
  onChange,
  placeholder,
  addLabel,
  numbered = true,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: (index: number) => string
  addLabel?: string
  numbered?: boolean
}) {
  const t = useTranslations("formBits")

  function update(i: number, val: string) {
    onChange(value.map((v, idx) => (idx === i ? val : v)))
  }
  function add() {
    onChange([...value, ""])
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-2">
      {value.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          {numbered && (
            <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{i + 1}.</span>
          )}
          <Input placeholder={placeholder?.(i)} value={v} onChange={(e) => update(i, e.target.value)} />
          {value.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => remove(i)}
              aria-label={t("removeRow", { index: i + 1 })}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  )
}

export function IntentQuestionEditor({
  value,
  onChange,
  productOptions,
  variant = "clear",
}: {
  value: IntentQuestionItem[]
  onChange: (next: IntentQuestionItem[]) => void
  productOptions: { id: string; label: string }[]
  variant?: "clear" | "rough"
}) {
  const t = useTranslations("formBits")
  const copyNs = variant === "clear" ? "intentClear" : "intentRough"
  const defaultProductId = productOptions[0]?.id ?? ""

  function update(id: string, patch: Partial<IntentQuestionItem>) {
    onChange(value.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  function add(afterId?: string) {
    const item = { ...emptyIntentQuestion(), productId: defaultProductId }
    let insertAt = value.length
    if (afterId) {
      const idx = value.findIndex((q) => q.id === afterId)
      if (idx >= 0) insertAt = idx + 1
    }
    const next = [...value]
    next.splice(insertAt, 0, item)
    onChange(next)
    requestAnimationFrame(() => {
      const areas = document.querySelectorAll<HTMLTextAreaElement>("[data-intent-question-textarea]")
      areas[insertAt]?.focus()
    })
  }

  function remove(id: string) {
    onChange(value.filter((q) => q.id !== id))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, id: string) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      add(id)
    }
  }

  const footerPadClass = value.length >= 10 ? "pl-9" : "pl-7"
  const showDelete = value.length > 1

  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-muted-foreground">{t(`${copyNs}.priorityHint`)}</p>
      {value.map((q, i) => {
        const productId = q.productId || defaultProductId
        const productLabel = productOptions.find((p) => p.id === productId)?.label
        return (
          <div key={q.id} className="flex items-center gap-2">
            <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums tracking-wide text-primary">
              {t("intentTop", { index: i + 1 })}
            </span>
            <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
              <Select
                value={productId}
                onValueChange={(v) => update(q.id, { productId: v ?? "" })}
                disabled={productOptions.length === 0}
              >
                <SelectTrigger className="w-[8.75rem] shrink-0 self-center rounded-none border-0 border-r border-input bg-transparent py-2 pr-2 pl-2.5 shadow-none hover:bg-accent/40 focus-visible:border-0 focus-visible:ring-0 sm:w-36 dark:bg-transparent dark:hover:bg-input/50">
                  <SelectValue placeholder={t("selectProduct")}>{productLabel || t("selectProduct")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {productOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                data-intent-question-textarea
                rows={2}
                className="min-h-16 flex-1 resize-y rounded-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:border-0 focus-visible:ring-0"
                placeholder={i === 0 ? t(`${copyNs}.placeholder0`) : t(`${copyNs}.placeholderNext`)}
                value={q.text}
                onChange={(e) => update(q.id, { text: e.target.value })}
                onKeyDown={(e) => handleKeyDown(e, q.id)}
              />
            </div>
            {showDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                onClick={() => remove(q.id)}
                aria-label={t(`${copyNs}.deleteLabel`, { index: i + 1 })}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        )
      })}
      <div className={cn("flex flex-wrap items-center gap-3", footerPadClass)}>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => add()}>
          <Plus className="size-4" />
          {t(`${copyNs}.addLabel`)}
        </Button>
        <p className="text-xs text-muted-foreground">{t(`${copyNs}.hint`)}</p>
      </div>
      {productOptions.length === 0 && (
        <p className={cn("text-xs text-muted-foreground", footerPadClass)}>{t(`${copyNs}.emptyHint`)}</p>
      )}
    </div>
  )
}

export function ProductEditor({
  value,
  onChange,
  hasError,
  hideCompetitors = false,
  nameOnly = false,
}: {
  value: ProductItem[]
  onChange: (next: ProductItem[]) => void
  hasError?: boolean
  hideCompetitors?: boolean
  /** 国内需求单仅收集产品 / 服务名称 */
  nameOnly?: boolean
}) {
  const t = useTranslations("formBits")

  function update(id: string, patch: Partial<ProductItem>) {
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }
  function add() {
    onChange([...value, emptyProduct()])
  }
  function remove(id: string) {
    onChange(value.filter((p) => p.id !== id))
  }
  const rows: {
    key: keyof ProductItem
    labelKey: "productFnLabel" | "productUsersLabel" | "productScenarioLabel"
    placeholder: string
    required: boolean
  }[] = [
    { key: "fn", labelKey: "productFnLabel", placeholder: t("productFnPlaceholder"), required: true },
    { key: "users", labelKey: "productUsersLabel", placeholder: t("productUsersPlaceholder"), required: true },
    { key: "scenario", labelKey: "productScenarioLabel", placeholder: t("productScenarioPlaceholder"), required: true },
  ]
  return (
    <div className="space-y-3">
      {value.map((p, i) => (
        <div
          key={p.id}
          className={cn(
            "rounded-xl border border-border bg-card p-4",
            hasError && !(nameOnly ? p.name.trim() : isProductComplete(p)) && "border-destructive/60 ring-1 ring-inset ring-destructive/30",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums tracking-wide text-primary">
                {t("productTop", { index: i + 1 })}
              </span>
              <span className="text-foreground">{t("productServiceLabel")}</span>
            </span>
            {value.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-muted-foreground"
                onClick={() => remove(p.id)}
              >
                <X className="size-3.5" />
                {t("deleteProduct")}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ProductRowLabel label={t("productNameLabel")} required />
              <Input
                placeholder={t("productNamePlaceholder")}
                value={p.name}
                onChange={(e) => update(p.id, { name: e.target.value })}
              />
            </div>
            {!nameOnly && rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <ProductRowLabel label={t(r.labelKey)} required={r.required} />
                <Input
                  placeholder={r.placeholder}
                  value={p[r.key] as string}
                  onChange={(e) => update(p.id, { [r.key]: e.target.value })}
                />
              </div>
            ))}
            {!nameOnly && !hideCompetitors && (
              <div className="flex items-center gap-2">
                <ProductRowLabel label={t("productCompetitorsLabel")} />
                <Input
                  placeholder={t("productCompetitorsPlaceholder")}
                  value={p.competitors ?? ""}
                  onChange={(e) => update(p.id, { competitors: e.target.value })}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="size-4" />
        {t("addProduct")}
      </Button>
    </div>
  )
}

function ProductRowLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="flex h-8 w-12 shrink-0 items-center justify-end gap-0.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {required && <span className="text-destructive">*</span>}
    </span>
  )
}

export function ChoiceCard({
  selected,
  onSelect,
  title,
  desc,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  desc?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        selected ? "border-primary bg-accent/50 ring-1 ring-inset ring-primary/30" : "border-border bg-card hover:bg-accent/30",
      )}
      aria-pressed={selected}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {desc && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{desc}</span>}
      </span>
    </button>
  )
}
