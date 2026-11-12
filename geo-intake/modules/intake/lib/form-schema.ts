export interface ProductItem {
  id: string
  name: string
  fn: string
  users: string
  scenario: string
  competitors: string
}

export interface RegionItem {
  id: string
  country: string
  language: string
}

/** 用户意图行 — 每行绑定一个产品 + 描述（明确问题 / 业务方向） */
export interface IntentQuestionItem {
  id: string
  productId: string
  text: string
}

export interface GeoFormData {
  companyName: string
  contactName: string
  contactTitle: string
  contactPhone: string
  brandName: string
  brandAliases: string[]
  scopeType: "brand_only" | "specific" | ""
  products: ProductItem[]
  hasOverseasSite: "yes" | "no" | ""
  overseasSiteUrl: string
  /** 品牌核心目标用户：TOC / TOB / TOC&TOB（必选） */
  targetCustomer: "toc" | "tob" | "both" | ""
  regions: RegionItem[]
  platforms: string[]
  optimizeBackground: string
  intentType: "clear" | "rough" | ""
  intentQuestions: IntentQuestionItem[]
  /** @deprecated 旧草稿兼容，新数据写入 intentRoughItems */
  intentRough: string
  intentRoughItems: IntentQuestionItem[]
  goal: string
  /** 国内：多选优化目标（海外仍用 goal 单选） */
  goals?: string[]
  /** 国内：优化周期 3/6/12 个月或自定义 */
  optimizePeriod?: "" | "3" | "6" | "12" | "custom"
  /** 国内：自定义优化周期 */
  optimizePeriodCustom?: string
  /** 国内：预算（选填） */
  budget?: string
  /** 国内：预计执行日期 YYYY-MM-DD */
  expectedStartDate?: string
  /** 国内：品牌级竞品列表（可多项） */
  brandCompetitors?: string[]
  /** 国内：企业实力；其余 strength* 字段仅保留历史数据兼容 */
  strengthMarket?: string
  strengthTech?: string
  strengthBrand?: string
  strengthEcosystem?: string
  strengthOther?: string
  /** 飞书闭环导入溯源；手工/邀请提交通常无此字段；门户提交会写入 source */
  importMeta?: {
    feishuRecordId?: string
    source?: string
    importedAt?: string
  }
}

export function emptyProduct(id?: string): ProductItem {
  return { id: id ?? `p${Date.now()}`, name: "", fn: "", users: "", scenario: "", competitors: "" }
}

export function emptyIntentQuestion(id?: string): IntentQuestionItem {
  return { id: id ?? `iq${Date.now()}`, productId: "", text: "" }
}

/** 兼容旧草稿：string[] → IntentQuestionItem[] */
export function normalizeIntentQuestions(raw: unknown, defaultProductId = ""): IntentQuestionItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ ...emptyIntentQuestion(), productId: defaultProductId }]
  }
  if (typeof raw[0] === "string") {
    return (raw as string[]).map((text, i) => ({
      id: `iq${i}`,
      productId: defaultProductId,
      text,
    }))
  }
  return (raw as IntentQuestionItem[]).map((q, i) => ({
    id: q.id || `iq${i}`,
    productId: q.productId ?? defaultProductId,
    text: q.text ?? "",
  }))
}

/** 兼容旧草稿：string / IntentQuestionItem[] / intentRough 字符串 */
export function normalizeIntentRoughItems(
  raw: unknown,
  legacyString = "",
  defaultProductId = "",
): IntentQuestionItem[] {
  if (Array.isArray(raw) && raw.length > 0) {
    if (typeof raw[0] === "string") {
      return (raw as string[]).map((text, i) => ({
        id: `ir${i}`,
        productId: defaultProductId,
        text,
      }))
    }
    return (raw as IntentQuestionItem[]).map((q, i) => ({
      id: q.id || `ir${i}`,
      productId: q.productId ?? defaultProductId,
      text: q.text ?? "",
    }))
  }
  const trimmed = legacyString.trim()
  if (trimmed) {
    return [{ ...emptyIntentQuestion("ir1"), productId: defaultProductId, text: trimmed }]
  }
  return [{ ...emptyIntentQuestion("ir1"), productId: defaultProductId }]
}

export function emptyForm(): GeoFormData {
  return {
    companyName: "",
    contactName: "",
    contactTitle: "",
    contactPhone: "",
    brandName: "",
    brandAliases: [""],
    scopeType: "",
    products: [emptyProduct("p1")],
    hasOverseasSite: "",
    overseasSiteUrl: "",
    targetCustomer: "",
    regions: [{ id: "r1", country: "", language: "" }],
    platforms: [],
    optimizeBackground: "",
    intentType: "",
    intentQuestions: [emptyIntentQuestion("iq1")],
    intentRough: "",
    intentRoughItems: [emptyIntentQuestion("ir1")],
    goal: "",
    goals: [],
    optimizePeriod: "",
    optimizePeriodCustom: "",
    budget: "",
    expectedStartDate: "",
    brandCompetitors: [""],
    strengthMarket: "",
    strengthTech: "",
    strengthBrand: "",
    strengthEcosystem: "",
    strengthOther: "",
  }
}
