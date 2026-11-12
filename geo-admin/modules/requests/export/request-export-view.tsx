/**
 * PDF 导出 HTML 模板 — 在此文件定制版式与样式。
 * 预览：/requests/{id}/export-preview
 * 样式：同目录 export.css（rex-* class，仅 hex 色，兼容 html2canvas）
 * 修改 export.css 后请同步 public/request-export.css
 */
import {
  domesticPeriodLabel,
  isDomesticFormData,
  normalizeIntentQuestions,
  normalizeIntentRoughItems,
  regionTags,
  requestGoalLabel,
  scopeLabel,
  type GeoFormData,
} from "@/modules/intake"
import { STATUS_META } from "../lib/status"
import { formatRequestOwner } from "../lib/format-owner"
import type { RequestRecord } from "../lib/types"
import { PillBadge, StepBadge, TopBadge } from "./export-badges"
import "./export.css"

function ExportSection({
  step,
  title,
  desc,
  breakBefore,
  children,
}: {
  step: string
  title: string
  desc?: string
  breakBefore?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className="rex-section request-export-section"
      {...(breakBefore ? { "data-pdf-break": "before" } : {})}
    >
      <div className="rex-section-head">
        <StepBadge label={step} />
        <div className="rex-section-head-text">
          <h2 className="rex-section-title">{title}</h2>
          {desc && <p className="rex-section-desc">{desc}</p>}
        </div>
      </div>
      <div className="rex-fields">{children}</div>
    </section>
  )
}

function ExportField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rex-pdf-field">
      <p className="rex-field-label">{label}</p>
      <div className="rex-field-value">{children}</div>
    </div>
  )
}

function intentProductLabel(d: GeoFormData, productId: string): string {
  if (!productId || productId === "__brand__") return (d.brandName ?? "").trim() || "品牌整体"
  return (d.products ?? []).find((p) => p.id === productId)?.name?.trim() ?? ""
}

function defaultIntentProductId(d: GeoFormData): string {
  if (d.scopeType === "specific") {
    const first = (d.products ?? []).find((p) => p.name?.trim())
    if (first) return first.id
  }
  return "__brand__"
}

function IntentBlock({ data: d }: { data: GeoFormData }) {
  const defaultProductId = defaultIntentProductId(d)
  const items =
    d.intentType === "clear"
      ? normalizeIntentQuestions(d.intentQuestions, defaultProductId)
      : d.intentType === "rough"
        ? normalizeIntentRoughItems(d.intentRoughItems, d.intentRough ?? "", defaultProductId)
        : []
  const filled = items.filter((q) => (q.text ?? "").trim())
  if (!filled.length) return <span className="rex-muted">—</span>

  const mode =
    d.intentType === "clear" ? "我有明确的问题" : d.intentType === "rough" ? "我只有大致业务方向" : ""

  return (
    <div>
      {mode && <p className="rex-intent-mode">{mode}</p>}
      {filled.map((q, i) => {
        const product = intentProductLabel(d, q.productId ?? "")
        return (
          <div key={q.id ?? i} className="rex-subcard" style={{ marginTop: i > 0 ? 8 : 0 }}>
            <TopBadge rank={i + 1} />
            <p className="rex-subcard-text">
              {product && <strong>【{product}】</strong>}
              {(q.text ?? "").trim()}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function ProductBlock({ data: d }: { data: GeoFormData }) {
  const products = (d.products ?? []).filter((p) => p.name?.trim())
  if (!products.length) return <span className="rex-muted">—</span>

  return (
    <div>
      {products.map((p, i) => (
        <div key={p.id} className="rex-product-card" style={{ marginTop: i > 0 ? 12 : 0 }}>
          <div className="rex-product-title-row">
            <TopBadge rank={i + 1} />
            <span className="rex-product-title-text">{p.name}</span>
          </div>
          <table className="rex-dl-table">
            <tbody>
              <tr>
                <th>1. 产品功能</th>
                <td>{p.fn || "—"}</td>
              </tr>
              <tr>
                <th>2. 主要用户群体</th>
                <td>{p.users || "—"}</td>
              </tr>
              <tr>
                <th>3. 应用场景</th>
                <td>{p.scenario || "—"}</td>
              </tr>
              {p.competitors?.trim() && (
                <tr>
                  <th>4. 竞品</th>
                  <td>{p.competitors}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function enterpriseExampleText(d: GeoFormData): string {
  const legacyItems = [
    ["市场业绩", d.strengthMarket],
    ["技术能力", d.strengthTech],
    ["品牌口碑", d.strengthBrand],
    ["生态与合规实力", d.strengthEcosystem],
    ["其他竞争优势", d.strengthOther],
  ].filter((item): item is [string, string] => Boolean(item[1]?.trim()))

  if (legacyItems.length === 1 && legacyItems[0][0] === "市场业绩") return legacyItems[0][1].trim()
  return legacyItems.map(([label, value]) => `${label}：${value.trim()}`).join("\n") || "—"
}

export function RequestExportView({ record }: { record: RequestRecord }) {
  const d = record.data
  const aliases = (d.brandAliases ?? []).filter((a) => a.trim())
  const domestic = isDomesticFormData(d)

  return (
    <div id="request-export-root">
      <header className="rex-header request-export-section">
        <div className="rex-header-row">
          <div className="rex-header-left">
            <img src="/brand-qinglan.svg" alt="清蓝" className="rex-logo" width={200} height={32} />
            <div className="rex-header-divider">
              <p className="rex-title-sub">{domestic ? "国内 GEO 需求收集" : "海外 GEO 需求收集"}</p>
              <h1 className="rex-title-main">客户需求详情</h1>
            </div>
          </div>
          <div className="rex-header-right">
            <PillBadge text={STATUS_META[record.status].label} />
            <span className="rex-code">{record.code}</span>
          </div>
        </div>
      </header>

      <ExportSection step="一" title="项目联系人" desc="收集公司及联系人信息">
        <ExportField label="1. 公司名称">{d.companyName || "—"}</ExportField>
        <ExportField label="2. 联系人信息">
          <table className="rex-contact-table">
            <tbody>
              <tr>
                <th>联系人姓名</th>
                <th>职位</th>
                <th>手机号</th>
              </tr>
              <tr>
                <td>{d.contactName || "—"}</td>
                <td>{d.contactTitle || "—"}</td>
                <td>{d.contactPhone || "—"}</td>
              </tr>
            </tbody>
          </table>
        </ExportField>
      </ExportSection>

      {domestic ? (
        <>
          <ExportSection step="二" title="品牌与产品信息" desc="收集品牌、优化范围、产品介绍及官网信息">
            <ExportField label="3. 希望优化的品牌名称">
              <p className="rex-plain">{d.brandName || "—"}</p>
              {aliases.length > 0 && <p className="rex-alias">品牌别名：{aliases.join("、")}</p>}
            </ExportField>
            <ExportField label="4. 优化对象">{scopeLabel(d.scopeType)}</ExportField>
            {d.scopeType === "specific" && (
              <ExportField label="产品 / 服务名称">
                {(d.products ?? []).filter((p) => p.name?.trim()).map((p) => p.name.trim()).join("、") || "—"}
              </ExportField>
            )}
            <ExportField label="5. 是否有国内官方网站？">
              {d.hasOverseasSite === "yes" ? d.overseasSiteUrl || "—" : d.hasOverseasSite === "no" ? "暂无官网" : "—"}
            </ExportField>
          </ExportSection>

          <ExportSection step="三" title="GEO 优化需求" desc="收集意图、平台、周期、目标与企业实力">
            <ExportField label="6. 您希望用户搜索什么问题时看到您的品牌？">
              <IntentBlock data={d} />
            </ExportField>
            <ExportField label="7. 竞品">{(d.brandCompetitors ?? []).filter((c) => c.trim()).join("、") || "—"}</ExportField>
            <ExportField label="8. 希望优化的 AI 平台">{(d.platforms ?? []).join("、") || "—"}</ExportField>
            <ExportField label="9. 希望优化的周期">{domesticPeriodLabel(d)}</ExportField>
            <ExportField label="10. 预算">{d.budget?.trim() || "—"}</ExportField>
            <ExportField label="11. 您的预计执行时间">{d.expectedStartDate?.trim() || "—"}</ExportField>
            <ExportField label="12. 您的具体优化目标">
              <PillBadge text={requestGoalLabel(d)} fill="#dbeafe" textColor="#1e40af" height={28} />
            </ExportField>
            <ExportField label="13. 企业实力">{enterpriseExampleText(d)}</ExportField>
          </ExportSection>
        </>
      ) : (
        <>
      <ExportSection step="二" title="品牌与产品信息" desc="收集品牌、优化范围、目标用户、产品介绍及官网信息">
        <ExportField label="3. 希望优化的品牌名称">
          <p className="rex-plain">{d.brandName || "—"}</p>
          {aliases.length > 0 && <p className="rex-alias">品牌别名：{aliases.join("、")}</p>}
        </ExportField>
        <ExportField label="4. 本次优化范围">{scopeLabel(d.scopeType)}</ExportField>
        {d.scopeType === "specific" && (
          <ExportField label="请简单介绍该产品或服务">
            <ProductBlock data={d} />
          </ExportField>
        )}
        <ExportField label="5. 品牌核心目标用户">
          {d.targetCustomer === "toc"
            ? "A、TOC（个人消费者）"
            : d.targetCustomer === "tob"
              ? "B、TOB（企业/机构客户）"
              : d.targetCustomer === "both"
                ? "C、TOC & TOB（两类用户均覆盖）"
              : "—"}
        </ExportField>
        <ExportField label="6. 是否有海外官方网站？">
          {d.hasOverseasSite === "yes" ? d.overseasSiteUrl || "—" : d.hasOverseasSite === "no" ? "暂无海外官网" : "—"}
        </ExportField>
      </ExportSection>

      <ExportSection step="三" title="GEO 优化需求" desc="收集国家语言、平台、优化背景、用户问题及优化目标">
        <ExportField label="7. 希望优化的 AI 平台">{(d.platforms ?? []).join("、") || "—"}</ExportField>
        <ExportField label="8. 各平台重点优化的国家与语言">
          {regionTags(d.regions).length ? regionTags(d.regions).join("；") : "—"}
        </ExportField>
        <ExportField label="9. 优化背景">{(d.optimizeBackground ?? "").trim() || "—"}</ExportField>
        <ExportField label="10. 您希望用户搜索什么问题时看到您的品牌？">
          <IntentBlock data={d} />
        </ExportField>
        <ExportField label="11. 您的具体优化目标">
          <PillBadge text={requestGoalLabel(d)} fill="#dbeafe" textColor="#1e40af" height={28} />
        </ExportField>
      </ExportSection>
        </>
      )}

      <ExportSection step="附" title="跟进信息" desc="内部管理字段">
        <ExportField label="跟进人">{formatRequestOwner(record.owner, record.ownerEmploymentStatus)}</ExportField>
        <ExportField label="提交时间">{record.submittedAt || "—"}</ExportField>
      </ExportSection>
    </div>
  )
}
