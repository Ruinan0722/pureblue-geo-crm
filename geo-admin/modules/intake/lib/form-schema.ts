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
  /** 海外需求：该国家/语言组合所属的 AI 平台；国内历史数据可为空 */
  platform?: string
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
  /** 兼容历史单选目标；新海外表单会同步写入 goals 的首个值 */
  goal: string
  /** 国内多选；海外为“来源率 + 推荐率三选一”的组合 */
  goals?: string[]
  /** 国内：优化周期 3/6/12 个月或自定义 */
  optimizePeriod?: "" | "3" | "6" | "12" | "custom"
  /** 国内：自定义优化周期 */
  optimizePeriodCustom?: string
  /** 国内：预算（选填） */
  budget?: string
  /** 国内：预计执行日期 YYYY-MM-DD */
  expectedStartDate?: string
  /** 内部方案交付信息：国内需求分配售前顾问时维护 */
  solutionLink?: string
  expectedSolutionDate?: string
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
    regions: [],
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

/** 平台变更时保留仍选中的配置，并为新增平台补一行空的国家/语言。 */
export function syncRegionsForPlatforms(regions: RegionItem[], platforms: string[]): RegionItem[] {
  if (!platforms.length) return []
  const allowed = new Set(platforms)
  const firstPlatform = platforms[0]
  const scoped = (regions ?? [])
    .map((region, index) => ({
      ...region,
      id: region.id || `r-${index}`,
      platform: region.platform && allowed.has(region.platform) ? region.platform : firstPlatform,
    }))
    .filter((region) => region.platform && allowed.has(region.platform))
  for (const platform of platforms) {
    if (!scoped.some((region) => region.platform === platform)) {
      const prefix = `r-${platform}`
      let nextIndex = 1
      while (scoped.some((region) => region.id === `${prefix}-${nextIndex}`)) nextIndex += 1
      scoped.push({ id: `${prefix}-${nextIndex}`, platform, country: "", language: "" })
    }
  }
  return scoped
}
