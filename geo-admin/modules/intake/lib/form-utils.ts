import { OPTIMIZATION_GOALS, displayCountryName, displayLanguageName } from "./form-options"
import { DOMESTIC_OPTIMIZATION_GOALS } from "./geo-variant"
import {
  normalizeIntentQuestions,
  normalizeIntentRoughItems,
  type GeoFormData,
  type ProductItem,
  type RegionItem,
} from "./form-schema"

export { emptyProduct } from "./form-schema"

export function goalLabel(value: string): string {
  if (!value) return "—"
  return (
    OPTIMIZATION_GOALS.find((g) => g.value === value)?.label ??
    DOMESTIC_OPTIMIZATION_GOALS.find((g) => g.value === value)?.label ??
    value
  )
}

/** 列表/导出：海外单选 goal，国内多选 goals */
export function requestGoalLabel(d: GeoFormData | null | undefined): string {
  if (!d) return "—"
  if (Array.isArray(d.goals) && d.goals.length > 0) {
    return d.goals.map((g) => goalLabel(g)).join("、")
  }
  return goalLabel(d.goal)
}

export function scopeLabel(value: GeoFormData["scopeType"]): string {
  if (value === "brand_only") return "仅优化品牌整体"
  if (value === "specific") return "优化具体产品或服务"
  return "—"
}

export function brandDisplay(d: GeoFormData): string {
  const aliases = (d.brandAliases ?? []).filter((a) => a.trim())
  if (!d.brandName) return "—"
  return aliases.length ? `${d.brandName}（别名：${aliases.join("、")}）` : d.brandName
}

export function regionLabel(regions: RegionItem[] | null | undefined): string {
  const valid = (regions ?? []).filter((r) => r.country)
  if (!valid.length) return "—"
  return valid.map((r) => formatPlatformRegion(r)).join("；")
}

export function regionTags(regions: RegionItem[] | null | undefined): string[] {
  return (regions ?? [])
    .filter((r) => r.country)
    .map((r) => r.language ? formatPlatformRegion(r) : `${r.platform ? `${r.platform}｜` : ""}${displayCountry(r.country)}（待补充语言）`)
}

export function maskUrl(url: string): string {
  if (!url) return ""
  const raw = url.trim()
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
    const host = u.hostname.replace(/^www\./, "")
    const parts = host.split(".")
    const name = parts[0]
    const masked =
      name.length <= 2 ? `${name[0] ?? ""}*` : `${name[0]}${"*".repeat(Math.max(3, name.length - 2))}${name[name.length - 1]}`
    const rest = parts.slice(1).join(".")
    return `${u.protocol}//${masked}${rest ? "." + rest : ""}`
  } catch {
    return raw.replace(/[a-zA-Z0-9]/g, "*")
  }
}

export function isProductComplete(p: ProductItem): boolean {
  return !!p.name.trim() && !!p.fn.trim() && !!p.users.trim() && !!p.scenario.trim()
}

function displayCountry(country: string): string {
  return displayCountryName(country, "zh-CN")
}

function displayLanguage(language: string): string {
  return displayLanguageName(language, "zh-CN")
}

function formatRegion(country: string, language: string): string {
  const countryLabel = displayCountry(country)
  return language ? `${countryLabel}-${displayLanguage(language)}` : countryLabel
}

function formatPlatformRegion(region: RegionItem): string {
  const regionText = formatRegion(region.country, region.language)
  return region.platform ? `${region.platform}｜${regionText}` : regionText
}

const URL_RE = /^https?:\/\/.+\..+/
const PHONE_RE = /^1[3-9]\d{9}$/

export type IntakeFormErrors = Partial<Record<string, string>>

export function validateIntakeForm(form: GeoFormData): IntakeFormErrors {
  const e: IntakeFormErrors = {}
  if (!form.companyName.trim()) e.companyName = "请填写公司名称"
  if (!form.contactName.trim()) e.contactName = "请填写联系人姓名"
  if (!form.contactTitle.trim()) e.contactTitle = "请填写联系人职位"
  if (!form.contactPhone.trim()) e.contactPhone = "请填写手机号"
  else if (!PHONE_RE.test(form.contactPhone.trim())) e.contactPhone = "手机号格式不正确"
  if (!form.brandName.trim()) e.brandName = "请填写品牌名称"
  if (!form.scopeType) e.scopeType = "请选择本次优化范围"
  if (form.scopeType === "specific") {
    const productsOk = form.products.length > 0 && form.products.every(isProductComplete)
    if (!productsOk) e.product = "请完整填写每个产品或服务的名称、功能、用户群体与应用场景（标*为必填）"
  }
  if (!form.hasOverseasSite) e.hasOverseasSite = "请选择是否有海外官网"
  if (form.hasOverseasSite === "yes") {
    if (!form.overseasSiteUrl.trim()) e.overseasSiteUrl = "请填写海外官网地址"
    else if (!URL_RE.test(form.overseasSiteUrl.trim())) e.overseasSiteUrl = "请输入完整有效的网址（含 http/https）"
  }
  if (!form.targetCustomer) e.targetCustomer = "请选择品牌核心目标用户"
  if (form.platforms.length === 0) e.platforms = "请至少选择一个 AI 平台"
  else if (form.platforms.some((platform) => !form.regions.some((r) => r.platform === platform && r.country && r.language))) {
    e.regions = "请为每个已选平台至少添加一组完整的国家与语言"
  }
  if (form.intentType !== "clear" && form.intentType !== "rough") {
    e.intent = "请选择「明确问题」或「业务方向」，并填写至少一条对应内容"
  } else if (
    form.intentType === "clear" &&
    !form.intentQuestions.some((q) => q.text.trim())
  ) {
    e.intent = "请选择「明确问题」或「业务方向」，并填写至少一条对应内容"
  } else if (
    form.intentType === "rough" &&
    !form.intentRoughItems.some((q) => q.text.trim())
  ) {
    e.intent = "请选择「明确问题」或「业务方向」，并填写至少一条对应内容"
  }
  const goals = form.goals?.length ? form.goals : form.goal ? [form.goal] : []
  const recommendationGoals = goals.filter((goal) => ["recommend", "top3", "priority"].includes(goal))
  if (!goals.length) e.goal = "请至少选择一个优化目标"
  else if (recommendationGoals.length > 1) e.goal = "推荐率指标只能选择一项"
  return e
}

/** 国内飞书问卷字段校验（无国家语言；目标多选；含周期与执行日期） */
export function validateDomesticIntakeForm(form: GeoFormData): IntakeFormErrors {
  const e: IntakeFormErrors = {}
  if (!form.companyName.trim()) e.companyName = "请填写公司名称"
  if (!form.contactName.trim()) e.contactName = "请填写联系人姓名"
  if (!form.contactTitle.trim()) e.contactTitle = "请填写联系人职位"
  if (!form.contactPhone.trim()) e.contactPhone = "请填写手机号"
  else if (!PHONE_RE.test(form.contactPhone.trim())) e.contactPhone = "手机号格式不正确"
  if (!form.brandName.trim()) e.brandName = "请填写品牌名称"
  if (!form.scopeType) e.scopeType = "请选择优化对象"
  if (form.scopeType === "specific") {
    const productsOk = form.products.length > 0 && form.products.every((p) => p.name.trim())
    if (!productsOk) e.product = "请填写产品或服务名称"
  }
  if (form.hasOverseasSite === "yes") {
    if (!form.overseasSiteUrl.trim()) e.overseasSiteUrl = "请填写官网地址"
    else if (!URL_RE.test(form.overseasSiteUrl.trim())) e.overseasSiteUrl = "请输入完整有效的网址（含 http/https）"
  }
  if (form.intentType !== "clear" && form.intentType !== "rough") {
    e.intent = "请选择意图问句或核心词方式，并填写至少一条对应内容"
  } else if (form.intentType === "clear" && !form.intentQuestions.some((q) => q.text.trim())) {
    e.intent = "请至少填写一条明确的意图问句"
  } else if (form.intentType === "rough" && !form.intentRoughItems.some((q) => q.text.trim())) {
    e.intent = "请至少填写一条核心词 / 品牌词"
  }
  if (form.platforms.length === 0) e.platforms = "请至少选择一个 AI 平台"
  if (!(form.brandCompetitors ?? []).some((c) => c.trim())) {
    e.brandCompetitors = "请至少填写一个竞品"
  }
  if (!form.optimizePeriod || !["3", "6", "12", "custom"].includes(form.optimizePeriod)) {
    e.optimizePeriod = "请选择希望优化的周期"
  } else if (form.optimizePeriod === "custom" && !form.optimizePeriodCustom?.trim()) {
    e.optimizePeriod = "请填写自定义优化周期"
  }
  if (!form.expectedStartDate?.trim()) e.expectedStartDate = "请选择预计执行时间"
  if (!form.goals?.length) e.goals = "请至少选择一个优化目标"
  return e
}

export function productIntroText(d: GeoFormData): string {
  return (d.products ?? [])
    .filter((p) => p.name?.trim())
    .map((p) => {
      const parts: string[] = []
      if (p.fn) parts.push(`功能：${p.fn}`)
      if (p.users) parts.push(`用户：${p.users}`)
      if (p.scenario) parts.push(`场景：${p.scenario}`)
      if (p.competitors?.trim()) parts.push(`竞品：${p.competitors}`)
      return `${p.name}（${parts.join("；")}）`
    })
    .join(" / ")
}

function intentProductLabel(d: GeoFormData, productId: string): string {
  if (!productId || productId === "__brand__") return (d.brandName ?? "").trim() || "品牌整体"
  return (d.products ?? []).find((p) => p.id === productId)?.name?.trim() ?? ""
}

function defaultIntentProductId(d: GeoFormData): string {
  if (d.scopeType === "specific") {
    const first = (d.products ?? []).find((p) => (p.name ?? "").trim())
    if (first) return first.id
  }
  return "__brand__"
}

function formatIntentItems(
  d: GeoFormData,
  items: { productId?: string; text?: string }[],
): string {
  return items
    .filter((q) => (q.text ?? "").trim())
    .map((q) => {
      const product = intentProductLabel(d, q.productId ?? "")
      const text = (q.text ?? "").trim()
      return product ? `【${product}】${text}` : text
    })
    .join("\n")
}

export function intentText(d: GeoFormData): string {
  const defaultProductId = defaultIntentProductId(d)
  if (d.intentType === "clear") {
    return formatIntentItems(d, normalizeIntentQuestions(d.intentQuestions, defaultProductId))
  }
  if (d.intentType === "rough") {
    return formatIntentItems(
      d,
      normalizeIntentRoughItems(d.intentRoughItems, d.intentRough ?? "", defaultProductId),
    )
  }
  return ""
}

export interface IntentDisplayItem {
  rank: number
  productLabel: string
  text: string
}

/** 详情页 / 导出：带 Top 序号的意图列表 */
export function intentDisplayItems(d: GeoFormData): { modeLabel: string; items: IntentDisplayItem[] } {
  const defaultProductId = defaultIntentProductId(d)
  let modeLabel = ""
  let raw: { productId?: string; text?: string }[] = []
  if (d.intentType === "clear") {
    modeLabel = "我有明确的问题"
    raw = normalizeIntentQuestions(d.intentQuestions, defaultProductId)
  } else if (d.intentType === "rough") {
    modeLabel = "我只有大致业务方向"
    raw = normalizeIntentRoughItems(d.intentRoughItems, d.intentRough ?? "", defaultProductId)
  }
  const items = raw
    .filter((q) => (q.text ?? "").trim())
    .map((q, i) => ({
      rank: i + 1,
      productLabel: intentProductLabel(d, q.productId ?? ""),
      text: (q.text ?? "").trim(),
    }))
  return { modeLabel, items }
}

/** 填报页：产品下拉选项（具体产品 or 品牌整体） */
export function intentProductOptions(d: GeoFormData): { id: string; label: string }[] {
  if (d.scopeType === "specific") {
    return d.products
      .filter((p) => p.name.trim())
      .map((p) => ({ id: p.id, label: p.name.trim() }))
  }
  const brand = d.brandName.trim()
  return brand ? [{ id: "__brand__", label: brand }] : [{ id: "__brand__", label: "品牌整体" }]
}
