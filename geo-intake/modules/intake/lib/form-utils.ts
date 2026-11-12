import {
  normalizeIntentQuestions,
  normalizeIntentRoughItems,
  type GeoFormData,
  type ProductItem,
  type RegionItem,
} from "./form-schema"

export { emptyProduct } from "./form-schema"

export function goalLabel(value: string): string {
  return value || "—"
}

export function scopeLabel(
  value: GeoFormData["scopeType"],
  labels?: { brandOnly: string; specific: string },
): string {
  if (value === "brand_only") return labels?.brandOnly ?? "brand_only"
  if (value === "specific") return labels?.specific ?? "specific"
  return "—"
}

export function brandDisplay(
  d: GeoFormData,
  labels?: { aliasesPrefix: string },
): string {
  const aliases = d.brandAliases.filter((a) => a.trim())
  if (!d.brandName) return "—"
  const prefix = labels?.aliasesPrefix ?? "aliases"
  return aliases.length ? `${d.brandName} (${prefix}: ${aliases.join(", ")})` : d.brandName
}

export function regionLabel(
  regions: RegionItem[],
  format?: (country: string, language: string) => string,
): string {
  const valid = regions.filter((r) => r.country)
  if (!valid.length) return "—"
  return valid
    .map((r) =>
      format
        ? format(r.country, r.language)
        : r.language
          ? `${r.country}-${r.language}`
          : r.country,
    )
    .join("; ")
}

export function regionTags(
  regions: RegionItem[],
  labels?: { languagePending: string },
  format?: (country: string, language: string) => string,
): string[] {
  const pending = labels?.languagePending ?? "language TBD"
  return regions
    .filter((r) => r.country)
    .map((r) =>
      format
        ? format(r.country, r.language)
        : r.language
          ? `${r.country}-${r.language}`
          : `${r.country} (${pending})`,
    )
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

const URL_RE = /^https?:\/\/.+\..+/

export type IntakeFormErrors = Partial<Record<string, string>>

export interface IntakeValidationMessages {
  companyName: string
  contactName: string
  contactTitle: string
  contactPhone: string
  contactPhoneInvalid: string
  brandName: string
  scopeType: string
  product: string
  hasOverseasSite: string
  overseasSiteUrl: string
  overseasSiteUrlInvalid: string
  targetCustomer: string
  regions: string
  platforms: string
  intent: string
  goal: string
}

function intentItemsComplete(items: { text?: string }[]): boolean {
  return items.some((q) => (q.text ?? "").trim().length > 0)
}

export function validateIntakeForm(
  form: GeoFormData,
  isPhoneValid: (phone: string) => boolean,
  messages: IntakeValidationMessages,
): IntakeFormErrors {
  const e: IntakeFormErrors = {}
  if (!form.companyName.trim()) e.companyName = messages.companyName
  if (!form.contactName.trim()) e.contactName = messages.contactName
  if (!form.contactTitle.trim()) e.contactTitle = messages.contactTitle
  if (!form.contactPhone.trim()) e.contactPhone = messages.contactPhone
  else if (!isPhoneValid(form.contactPhone)) e.contactPhone = messages.contactPhoneInvalid
  if (!form.brandName.trim()) e.brandName = messages.brandName
  if (!form.scopeType) e.scopeType = messages.scopeType
  if (form.scopeType === "specific") {
    const productsOk = form.products.length > 0 && form.products.every(isProductComplete)
    if (!productsOk) e.product = messages.product
  }
  if (!form.hasOverseasSite) e.hasOverseasSite = messages.hasOverseasSite
  if (form.hasOverseasSite === "yes") {
    if (!form.overseasSiteUrl.trim()) e.overseasSiteUrl = messages.overseasSiteUrl
    else if (!URL_RE.test(form.overseasSiteUrl.trim())) e.overseasSiteUrl = messages.overseasSiteUrlInvalid
  }
  if (!form.targetCustomer) e.targetCustomer = messages.targetCustomer
  if (!form.regions.some((r) => r.country && r.language)) e.regions = messages.regions
  if (form.platforms.length === 0) e.platforms = messages.platforms
  if (form.intentType !== "clear" && form.intentType !== "rough") {
    e.intent = messages.intent
  } else if (form.intentType === "clear" && !intentItemsComplete(form.intentQuestions)) {
    e.intent = messages.intent
  } else if (form.intentType === "rough" && !intentItemsComplete(form.intentRoughItems)) {
    e.intent = messages.intent
  }
  if (!form.goal) e.goal = messages.goal
  return e
}

/** 国内飞书问卷字段校验 */
export function validateDomesticIntakeForm(
  form: GeoFormData,
  isPhoneValid: (phone: string) => boolean,
): IntakeFormErrors {
  const e: IntakeFormErrors = {}
  if (!form.companyName.trim()) e.companyName = "请填写公司名称"
  if (!form.contactName.trim()) e.contactName = "请填写联系人姓名"
  if (!form.contactTitle.trim()) e.contactTitle = "请填写联系人职位"
  if (!form.contactPhone.trim()) e.contactPhone = "请填写手机号"
  else if (!isPhoneValid(form.contactPhone)) e.contactPhone = "手机号格式不正确"
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
  } else if (form.intentType === "clear" && !intentItemsComplete(form.intentQuestions)) {
    e.intent = "请至少填写一条明确的意图问句"
  } else if (form.intentType === "rough" && !intentItemsComplete(form.intentRoughItems)) {
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

export function productIntroText(
  d: GeoFormData,
  labels?: { fn: string; users: string; scenario: string; competitors?: string },
): string {
  const fnLabel = labels?.fn ?? "Function"
  const usersLabel = labels?.users ?? "Users"
  const scenarioLabel = labels?.scenario ?? "Use cases"
  return d.products
    .filter((p) => p.name.trim())
    .map((p) => {
      const parts: string[] = []
      if (p.fn) parts.push(`${fnLabel}: ${p.fn}`)
      if (p.users) parts.push(`${usersLabel}: ${p.users}`)
      if (p.scenario) parts.push(`${scenarioLabel}: ${p.scenario}`)
      if (p.competitors?.trim()) parts.push(`${labels?.competitors ?? "Competitors"}: ${p.competitors}`)
      return `${p.name} (${parts.join("; ")})`
    })
    .join(" / ")
}

function intentProductLabel(d: GeoFormData, productId: string, brandOverallLabel: string): string {
  if (!productId || productId === "__brand__") return d.brandName.trim() || brandOverallLabel
  return d.products.find((p) => p.id === productId)?.name.trim() ?? ""
}

function defaultIntentProductId(d: GeoFormData): string {
  if (d.scopeType === "specific") {
    const first = d.products?.find((p) => (p.name ?? "").trim())
    if (first) return first.id
  }
  return "__brand__"
}

function formatIntentItems(
  d: GeoFormData,
  items: { productId?: string; text?: string }[],
  brandOverallLabel: string,
): string {
  return items
    .filter((q) => (q.text ?? "").trim())
    .map((q) => {
      const product = intentProductLabel(d, q.productId ?? "", brandOverallLabel)
      const text = (q.text ?? "").trim()
      return product ? `【${product}】${text}` : text
    })
    .join("\n")
}

export function intentText(d: GeoFormData, brandOverallLabel = "Brand overall"): string {
  const defaultProductId = defaultIntentProductId(d)
  if (d.intentType === "clear") {
    return formatIntentItems(d, normalizeIntentQuestions(d.intentQuestions, defaultProductId), brandOverallLabel)
  }
  if (d.intentType === "rough") {
    return formatIntentItems(
      d,
      normalizeIntentRoughItems(d.intentRoughItems, d.intentRough ?? "", defaultProductId),
      brandOverallLabel,
    )
  }
  return ""
}

/** 填报页：产品下拉选项（具体产品 or 品牌整体） */
export function intentProductOptions(d: GeoFormData, brandOverallLabel = "Brand overall"): { id: string; label: string }[] {
  if (d.scopeType === "specific") {
    return d.products
      .filter((p) => p.name.trim())
      .map((p) => ({ id: p.id, label: p.name.trim() }))
  }
  const brand = d.brandName.trim()
  return brand ? [{ id: "__brand__", label: brand }] : [{ id: "__brand__", label: brandOverallLabel }]
}
