import {
  domesticPeriodLabel,
  isDomesticFormData,
  normalizeIntentQuestions,
  normalizeIntentRoughItems,
  regionLabel,
  requestGoalLabel,
  scopeLabel,
  type GeoFormData,
} from "@/modules/intake"
import { STATUS_META } from "./status"
import { formatRequestOwner } from "./format-owner"
import type { RequestRecord } from "./types"
import { exportSinglePdfFromTemplate, type PdfExportResult } from "../export/export-pdf-html"

export type { PdfExportResult }

const HEADERS = [
  "需求编号",
  "状态",
  "公司名称",
  "联系人",
  "职位",
  "手机号",
  "品牌名称",
  "品牌别名",
  "优化对象",
  "产品或服务（含功能/用户/场景/竞品）",
  "官网",
  "品牌核心目标用户",
  "目标国家-语言",
  "AI 平台",
  "优化背景",
  "用户问题/方向",
  "优化目标",
  "优化周期",
  "预算",
  "预计执行时间",
  "企业实力",
  "跟进人",
  "提交时间",
]

function flattenCellText(v: string): string {
  if (!v) return v
  return v.replace(/\r\n/g, "\n").replace(/\n+/g, "；").trim()
}

function formatProductsText(d: GeoFormData): string {
  if (d.scopeType !== "specific") return "—"
  const products = (d.products ?? []).filter((p) => p.name?.trim())
  if (!products.length) return "—"
  if (isDomesticFormData(d)) return products.map((p) => p.name.trim()).join("、")
  return products
    .map((p, i) => {
      const parts = [
        `Top ${i + 1} · ${p.name}`,
        `功能：${p.fn?.trim() || "—"}`,
        `用户：${p.users?.trim() || "—"}`,
        `场景：${p.scenario?.trim() || "—"}`,
      ]
      if (p.competitors?.trim()) parts.push(`竞品：${p.competitors.trim()}`)
      return parts.join("；")
    })
    .join(" | ")
}

function formatIntentText(d: GeoFormData): string {
  const products = d.products ?? []
  const defaultProductId =
    d.scopeType === "specific"
      ? (products.find((p) => p.name?.trim())?.id ?? "__brand__")
      : "__brand__"
  let items: { productId?: string; text?: string }[] = []
  let modeLabel = ""
  if (d.intentType === "clear") {
    modeLabel = "我有明确的问题"
    items = normalizeIntentQuestions(d.intentQuestions, defaultProductId)
  } else if (d.intentType === "rough") {
    modeLabel = "我只有大致业务方向"
    items = normalizeIntentRoughItems(d.intentRoughItems, d.intentRough ?? "", defaultProductId)
  }
  const lines = items
    .filter((q) => (q.text ?? "").trim())
    .map((q, i) => {
      const product =
        !q.productId || q.productId === "__brand__"
          ? (d.brandName ?? "").trim() || "品牌整体"
          : (products.find((p) => p.id === q.productId)?.name?.trim() ?? "")
      return `Top ${i + 1} · 【${product}】${(q.text ?? "").trim()}`
    })
  if (!lines.length) return "—"
  const body = lines.join(" | ")
  return modeLabel ? `${modeLabel}：${body}` : body
}

function rowOf(r: RequestRecord): string[] {
  const d = r.data
  const domestic = isDomesticFormData(d)
  const enterpriseExample = [d.strengthMarket, d.strengthTech, d.strengthBrand, d.strengthEcosystem, d.strengthOther]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(flattenCellText)
    .join("；")
  return [
    r.code,
    STATUS_META[r.status].label,
    flattenCellText(d.companyName),
    flattenCellText(d.contactName),
    flattenCellText(d.contactTitle),
    flattenCellText(d.contactPhone),
    flattenCellText(d.brandName),
    (d.brandAliases ?? []).filter((a) => a.trim()).map(flattenCellText).join("、"),
    scopeLabel(d.scopeType),
    formatProductsText(d),
    d.hasOverseasSite === "yes" ? flattenCellText(d.overseasSiteUrl) : "无",
    domestic
      ? "—"
      : d.targetCustomer === "toc"
      ? "A、TOC（个人消费者）"
      : d.targetCustomer === "tob"
        ? "B、TOB（企业/机构客户）"
        : d.targetCustomer === "both"
          ? "C、TOC & TOB（两类用户均覆盖）"
          : "—",
    regionLabel(d.regions),
    (d.platforms ?? []).join("、"),
    flattenCellText(d.optimizeBackground),
    formatIntentText(d),
    requestGoalLabel(d),
    domestic ? domesticPeriodLabel(d) : "—",
    domestic ? flattenCellText(d.budget ?? "") || "—" : "—",
    domestic ? flattenCellText(d.expectedStartDate ?? "") || "—" : "—",
    domestic ? enterpriseExample || "—" : "—",
    formatRequestOwner(r.owner, r.ownerEmploymentStatus),
    r.submittedAt,
  ]
}

function escapeCsv(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

export function exportCsv(records: RequestRecord[], filename: string) {
  const lines = [HEADERS, ...records.map(rowOf)].map((cols) => cols.map(escapeCsv).join(","))
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`)
}

export function exportSingleExcel(record: RequestRecord) {
  exportCsv([record], `${record.code}.csv`)
}

/** PDF 由 HTML 模板渲染，模板见 modules/requests/export/request-export-view.tsx */
export async function exportSinglePdf(record: RequestRecord): Promise<PdfExportResult> {
  return exportSinglePdfFromTemplate(record)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
