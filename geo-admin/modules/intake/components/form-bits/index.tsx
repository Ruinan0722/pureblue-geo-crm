"use client"

import type { KeyboardEvent, ReactNode } from "react"
import { AlertCircle, Check, Plus, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import { Button } from "@/shared/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select"
import { SearchableSelect, type SearchableSelectOption } from "@/shared/ui/searchable-select"
import {
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  emptyIntentQuestion,
  emptyProduct,
  isProductComplete,
  displayCountryName,
  displayLanguageName,
  type IntentQuestionItem,
  type ProductItem,
  type RegionItem,
} from "@/modules/intake"

const COUNTRY_SELECT_OPTIONS: SearchableSelectOption[] = COUNTRY_OPTIONS.map((c) => ({
  value: c,
  label: displayCountryName(c, "zh-CN"),
  keywords: `${c} ${displayCountryName(c, "en")}`,
}))
const LANGUAGE_SELECT_OPTIONS: SearchableSelectOption[] = LANGUAGE_OPTIONS.map((l) => ({
  value: l,
  label: displayLanguageName(l, "zh-CN"),
  keywords: `${l} ${displayLanguageName(l, "en")}`,
}))

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
  options: readonly string[]
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

// 国家-语言编辑器：海外按平台分组，国内/历史调用仍可使用无平台模式。
export function RegionEditor({
  value,
  onChange,
  platforms,
}: {
  value: RegionItem[]
  onChange: (next: RegionItem[]) => void
  platforms?: string[]
}) {
  function update(id: string, patch: Partial<RegionItem>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function add(platform?: string) {
    const prefix = `r-${platform || "region"}`
    let nextIndex = 1
    while (value.some((region) => region.id === `${prefix}-${nextIndex}`)) nextIndex += 1
    onChange([...value, { id: `${prefix}-${nextIndex}`, platform, country: "", language: "" }])
  }
  function remove(id: string) {
    onChange(value.filter((r) => r.id !== id))
  }
  function rows(items: RegionItem[], platform?: string) {
    return <div className="space-y-2.5">
      {items.map((r, i) => (
        <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchableSelect
            className="flex-1"
            value={r.country}
            onChange={(v) => update(r.id, { country: v, language: r.language })}
            options={COUNTRY_SELECT_OPTIONS}
            placeholder="搜索或选择国家/地区"
            emptyText="未找到匹配的国家/地区"
          />
          <span className="shrink-0 text-sm text-muted-foreground">-</span>
          <SearchableSelect
            className="flex-1"
            value={r.language}
            onChange={(v) => update(r.id, { language: v })}
            options={LANGUAGE_SELECT_OPTIONS}
            placeholder="搜索或选择语言"
            emptyText="未找到匹配的语言"
          />
          {items.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              onClick={() => remove(r.id)}
              aria-label={`删除${platform ? `${platform}的` : ""}第 ${i + 1} 个国家语言`}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => add(platform)}>
        <Plus className="size-4" />
        添加{platform ? `${platform}的` : ""}国家 / 语言
      </Button>
    </div>
  }

  if (platforms) {
    if (!platforms.length) {
      return <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">请先选择 AI 平台，再配置该平台对应的国家与语言</div>
    }
    return (
      <div className="space-y-3">
        {platforms.map((platform) => {
          const scoped = value.filter((region) => region.platform === platform)
          return (
            <section key={platform} className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><p className="text-sm font-semibold">{platform}</p><p className="mt-0.5 text-xs text-muted-foreground">配置该平台需要优化的国家 / 地区和语言</p></div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">已选平台</span>
              </div>
              {rows(scoped, platform)}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {rows(value)}
    </div>
  )
}

// 动态多行文本编辑器：一行一个，可添加 / 删除
export function RowList({
  value,
  onChange,
  placeholder,
  addLabel = "添加一行",
  numbered = true,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: (index: number) => string
  addLabel?: string
  numbered?: boolean
}) {
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
              aria-label={`删除第 ${i + 1} 行`}
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

/** 用户意图编辑器：每行 = 产品下拉 + 描述文本框；Enter 添加下一行，Shift+Enter 段内换行 */
const INTENT_EDITOR_COPY = {
  clear: {
    placeholder: (i: number) => (i === 0 ? "例如：哪个 AI 工具适合制作海报？" : "继续填写下一个问题…"),
    addLabel: "添加一个问题",
    priorityHint: "请按优先级从高到低填写（Top 1 为最高优先级）。",
    hint: "按 Enter 添加下一个问题，Shift + Enter 在问题内换行",
    emptyHint: "请先在上方填写产品名称，再选择对应产品并描述用户问题。",
    deleteLabel: (i: number) => `删除 Top ${i + 1}`,
  },
  rough: {
    placeholder: (i: number) =>
      i === 0
        ? "例如：希望用户询问 AI 海报设计、商品图制作或 AI 设计工具推荐时看到我们的品牌"
        : "继续填写下一个业务方向…",
    addLabel: "添加一个方向",
    priorityHint: "请按优先级从高到低填写业务方向（Top 1 为最高优先级）。",
    hint: "按 Enter 添加下一个方向，Shift + Enter 在描述内换行",
    emptyHint: "请先在上方填写产品名称，再选择对应产品并描述业务方向。",
    deleteLabel: (i: number) => `删除 Top ${i + 1}`,
  },
} as const

export function IntentQuestionEditor({
  value,
  onChange,
  productOptions,
  variant = "clear",
}: {
  value: IntentQuestionItem[]
  onChange: (next: IntentQuestionItem[]) => void
  productOptions: { id: string; label: string }[]
  variant?: keyof typeof INTENT_EDITOR_COPY
}) {
  const copy = INTENT_EDITOR_COPY[variant]
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
      {"priorityHint" in copy && copy.priorityHint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.priorityHint}</p>
      )}
      {value.map((q, i) => {
        const productId = q.productId || defaultProductId
        const productLabel = productOptions.find((p) => p.id === productId)?.label
        return (
          <div key={q.id} className="flex items-center gap-2">
            <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums tracking-wide text-primary">
              Top {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
              <Select
                value={productId}
                onValueChange={(v) => update(q.id, { productId: v ?? "" })}
                disabled={productOptions.length === 0}
              >
                <SelectTrigger
                  className="w-[8.75rem] shrink-0 self-center rounded-none border-0 border-r border-input bg-transparent py-2 pr-2 pl-2.5 shadow-none hover:bg-accent/40 focus-visible:border-0 focus-visible:ring-0 sm:w-36 dark:bg-transparent dark:hover:bg-input/50"
                >
                  <SelectValue placeholder="选择产品">{productLabel || "选择产品"}</SelectValue>
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
                placeholder={copy.placeholder(i)}
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
                aria-label={copy.deleteLabel(i)}
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
          {copy.addLabel}
        </Button>
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </div>
      {productOptions.length === 0 && (
        <p className={cn("text-xs text-muted-foreground", footerPadClass)}>{copy.emptyHint}</p>
      )}
    </div>
  )
}

// 产品编辑器：按优先级 Top 1/2/3 排列，每项含名称及功能、用户群体、应用场景
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
  /** 国内问卷不收集竞品 */
  hideCompetitors?: boolean
  /** 国内需求单仅收集产品 / 服务名称 */
  nameOnly?: boolean
}) {
  function update(id: string, patch: Partial<ProductItem>) {
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }
  function add() {
    onChange([...value, emptyProduct()])
  }
  function remove(id: string) {
    onChange(value.filter((p) => p.id !== id))
  }
  const rows: { key: keyof ProductItem; label: string; placeholder: string; required: boolean }[] = [
    { key: "fn", label: "功能", placeholder: "产品功能，例如：帮助用户一键生成营销海报的 AI 设计工具", required: true },
    { key: "users", label: "用户", placeholder: "主要用户群体，例如：中小电商卖家、内容创作者、设计师", required: true },
    { key: "scenario", label: "场景", placeholder: "应用场景，例如：电商主图制作、社媒配图、广告创意生成", required: true },
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
                Top {i + 1}
              </span>
              <span className="text-foreground">产品 / 服务</span>
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
                删除
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ProductRowLabel label="名称" required />
              <Input
                placeholder="产品或服务名称，例如：AI 图片生成工具"
                value={p.name}
                onChange={(e) => update(p.id, { name: e.target.value })}
              />
            </div>
            {!nameOnly && rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <ProductRowLabel label={r.label} required={r.required} />
                <Input
                  placeholder={r.placeholder}
                  value={p[r.key] as string}
                  onChange={(e) => update(p.id, { [r.key]: e.target.value })}
                />
              </div>
            ))}
            {!nameOnly && !hideCompetitors && (
              <div className="flex items-center gap-2">
                <ProductRowLabel label="竞品" />
                <Input
                  placeholder="主要竞品，例如：Canva、Figma、Adobe Express"
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
        添加产品或服务
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
