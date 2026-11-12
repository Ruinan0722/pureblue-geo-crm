export type KnowledgeLevel = "公司级" | "部门级" | "业务专题"
export type KnowledgeStatus = "已发布" | "待审核" | "已驳回" | "草稿" | "已停用"

export type KnowledgeReviewRecord = {
  action: "提交审核" | "审核通过" | "驳回" | "修改答案"
  actor: string
  at: string
  reason?: string
  answerBefore?: string
  answerAfter?: string
}

export type KnowledgeArticle = {
  id: string
  question: string
  answer: string
  department: string
  category: string
  level: KnowledgeLevel
  status: KnowledgeStatus
  tags: string[]
  owner: string
  updatedAt: string
  version: string
  views: number
  helpful: number
  scenes: string[]
  submitter?: string
  submittedAt?: string
  reviewer?: string
  reviewedAt?: string
  rejectionReason?: string
  reviewHistory?: KnowledgeReviewRecord[]
}

export type KnowledgeReviewNotification = {
  id: string
  articleId: string
  articleQuestion: string
  department: string
  submitter: string
  createdAt: string
  read: boolean
  resolved: boolean
}

export const KNOWLEDGE_STORAGE_KEY = "geo-admin:knowledge-articles:v1"
export const KNOWLEDGE_UPDATED_EVENT = "geo-admin:knowledge-updated"
export const KNOWLEDGE_REVIEW_NOTIFICATIONS_KEY = "geo-admin:knowledge-review-notifications:v1"
export const KNOWLEDGE_REVIEW_UPDATED_EVENT = "geo-admin:knowledge-review-updated"

export const KNOWLEDGE_DEPARTMENTS = ["客户成功", "销售", "售前", "项目运营", "财务"] as const
export const KNOWLEDGE_LEVELS: KnowledgeLevel[] = ["公司级", "部门级", "业务专题"]

/** 部门 Leader 展示映射；真实环境可由组织架构替换，开发身份沿用当前测试账号。 */
export const KNOWLEDGE_DEPARTMENT_LEADERS: Record<string, string> = {}

export function knowledgeReviewDepartments(role: string, name?: string, departments: string[] = []): string[] {
  if (role === "admin" || role === "super_admin") return [...KNOWLEDGE_DEPARTMENTS]
  const assigned = Object.entries(KNOWLEDGE_DEPARTMENT_LEADERS).filter(([, leader]) => leader === name).map(([department]) => department)
  if (role !== "leader" && role !== "marketing_leader") return assigned
  const memberships = KNOWLEDGE_DEPARTMENTS.filter((department) => departments.some((membership) => membership.includes(department) || (department === "售前" && membership.includes("解决方案"))))
  return Array.from(new Set([...assigned, ...memberships]))
}

export type KnowledgeCategoryNode = {
  label: string
  children?: KnowledgeCategoryNode[]
}

/** PRD 约定的最多三级分类树；QA 数据仍可通过业务类别扩展叶子节点。 */
export const KNOWLEDGE_CATEGORY_TREE: KnowledgeCategoryNode[] = [
  {
    label: "GEO业务知识",
    children: [
      { label: "国内GEO", children: [{ label: "产品介绍" }, { label: "服务流程" }, { label: "效果与考核" }, { label: "客户异议" }] },
      { label: "海外GEO", children: [{ label: "产品介绍" }, { label: "服务流程" }, { label: "诊断报告" }, { label: "客户异议" }] },
    ],
  },
  { label: "Mark产品", children: [{ label: "产品能力" }, { label: "交付边界" }, { label: "常见问题" }] },
  { label: "销售知识", children: [{ label: "常见异议" }, { label: "方案建议" }, { label: "商务流程" }] },
  { label: "客户成功", children: [{ label: "项目交付" }, { label: "效果与验收" }, { label: "续约与维护" }] },
  { label: "财务合同", children: [{ label: "开票与回款" }, { label: "合同条款" }] },
]

export const KNOWLEDGE_SEED: KnowledgeArticle[] = []

export function loadKnowledgeArticles(): KnowledgeArticle[] {
  if (typeof window === "undefined") return KNOWLEDGE_SEED
  try {
    const raw = window.localStorage.getItem(KNOWLEDGE_STORAGE_KEY)
    if (!raw) return KNOWLEDGE_SEED
    const parsed = JSON.parse(raw) as KnowledgeArticle[]
    if (!Array.isArray(parsed) || !parsed.length) return KNOWLEDGE_SEED
    const migrated = parsed.map((article) =>
      article.department === "项目交付" ? { ...article, department: "项目运营" } : article,
    )
    if (migrated.some((article, index) => article.department !== parsed[index]?.department)) {
      window.localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    return KNOWLEDGE_SEED
  }
}

export function saveKnowledgeArticles(articles: KnowledgeArticle[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(articles))
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_UPDATED_EVENT))
}

export function loadKnowledgeReviewNotifications(): KnowledgeReviewNotification[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KNOWLEDGE_REVIEW_NOTIFICATIONS_KEY)
    const parsed = JSON.parse(raw || "[]") as KnowledgeReviewNotification[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveKnowledgeReviewNotifications(notifications: KnowledgeReviewNotification[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KNOWLEDGE_REVIEW_NOTIFICATIONS_KEY, JSON.stringify(notifications))
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_REVIEW_UPDATED_EVENT))
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s，。？！、：；,.?!:;（）()\[\]]+/g, "")
}

function bigrams(value: string) {
  const normalized = normalize(value)
  if (normalized.length < 2) return normalized ? [normalized] : []
  return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2))
}

export function searchKnowledgeArticles(
  query: string,
  articles: KnowledgeArticle[],
  options: { includeUnpublished?: boolean } = {},
): KnowledgeArticle[] {
  const source = options.includeUnpublished ? articles : articles.filter((item) => item.status === "已发布")
  const keyword = normalize(query)
  if (!keyword) return [...source].sort((a, b) => b.views - a.views)

  const tokens = query
    .split(/[\s，。？！、：；,.?!:;（）()\[\]]+/)
    .map(normalize)
    .filter(Boolean)
  const queryBigrams = bigrams(query)

  return source
    .map((item) => {
      const question = normalize(item.question)
      const answer = normalize(item.answer)
      const tags = normalize(item.tags.join(" "))
      const category = normalize(`${item.department}${item.category}${item.scenes.join(" ")}`)
      const candidateBigrams = new Set(bigrams(`${item.question}${item.tags.join("")}${item.category}${item.answer}`))
      let score = 0
      if (question.includes(keyword)) score += 100
      if (tags.includes(keyword)) score += 60
      if (answer.includes(keyword)) score += 35
      for (const token of tokens) {
        if (question.includes(token)) score += 18
        if (tags.includes(token)) score += 10
        if (category.includes(token)) score += 8
        if (answer.includes(token)) score += 4
      }
      // 中文自然问法常会替换一两个词，例如“验收效果”与“验证优化效果”。
      // 以相邻双字片段做轻量近似匹配，至少命中两个片段才计分，避免单字泛匹配。
      const fuzzyHits = queryBigrams.filter((gram) => candidateBigrams.has(gram)).length
      if (fuzzyHits >= 2) score += fuzzyHits * 6
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.views - a.item.views)
    .map((entry) => entry.item)
}
