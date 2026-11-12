"use client"

import { Check, Globe } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import {
  AI_PLATFORM_OPTIONS,
  DOMESTIC_AI_PLATFORM_OPTIONS,
  DOMESTIC_OPTIMIZATION_GOALS,
  OPTIMIZATION_GOALS,
  brandDisplay,
  domesticPeriodLabel,
  intentDisplayItems,
  isDomesticFormData,
  regionTags,
  requestGoalLabel,
  scopeLabel,
  type GeoFormData,
  type ProductItem,
} from "@/modules/intake"
import { SectionCard } from "@/modules/intake/components/form-bits"

function TopBadge({ rank }: { rank: number }) {
  return (
    <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums tracking-wide text-primary">
      Top {rank}
    </span>
  )
}

function DetailField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

function ReadonlyChoice({
  selected,
  title,
  desc,
}: {
  selected: boolean
  title: string
  desc?: string
}) {
  if (!selected) return null
  return (
    <div className="flex w-full items-start gap-3 rounded-xl border border-primary bg-accent/50 p-4 ring-1 ring-inset ring-primary/30">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground">
        <Check className="size-3" />
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {desc ? <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{desc}</span> : null}
      </span>
    </div>
  )
}

function ProductRowLabel({ label }: { label: string }) {
  return (
    <span className="flex h-8 w-12 shrink-0 items-center justify-end text-xs font-medium text-muted-foreground">
      {label}
    </span>
  )
}

function ProductReadonlyCard({ product, rank }: { product: ProductItem; rank: number }) {
  const rows: { label: string; value: string }[] = [
    { label: "名称", value: product.name },
    { label: "功能", value: product.fn },
    { label: "用户", value: product.users },
    { label: "场景", value: product.scenario },
  ]
  if (product.competitors?.trim()) {
    rows.push({ label: "竞品", value: product.competitors })
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <TopBadge rank={rank} />
        <span className="text-foreground">产品 / 服务</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <ProductRowLabel label={r.label} />
            <p className="min-h-8 flex-1 rounded-lg border border-transparent bg-muted/30 px-2.5 py-1.5 text-sm leading-relaxed">
              {r.value.trim() || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function IntentReadonlyList({ data }: { data: GeoFormData; domestic?: boolean }) {
  const { modeLabel, items } = intentDisplayItems(data)
  if (!data.intentType) {
    return <p className="text-sm text-muted-foreground">未填写，由项目团队协助挖掘</p>
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <ReadonlyChoice selected={data.intentType === "clear"} title="我有明确的问题" />
        <ReadonlyChoice selected={data.intentType === "rough"} title="我只有大致业务方向" />
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">未填写具体内容</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
          {modeLabel ? <p className="text-xs font-medium text-muted-foreground">{modeLabel}</p> : null}
          {items.map((item) => (
            <div
              key={`${item.rank}-${item.text}`}
              className="flex items-start gap-2 rounded-lg border border-border bg-card p-3"
            >
              <TopBadge rank={item.rank} />
              <div className="min-w-0 flex-1 text-sm leading-relaxed">
                {item.productLabel ? (
                  <span className="font-medium text-foreground">【{item.productLabel}】</span>
                ) : null}
                <span className="text-foreground">{item.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlatformChips({ options, selected }: { options: readonly string[]; selected: string[] }) {
  const extras = selected.filter((p) => !options.includes(p))
  const all = [...options, ...extras]
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((opt) => {
        const active = selected.includes(opt)
        return (
          <span
            key={opt}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground/50",
            )}
          >
            {active && <Check className="size-3.5" />}
            {opt}
          </span>
        )
      })}
    </div>
  )
}

function enterpriseExampleText(data: GeoFormData): string {
  const legacyItems = [
    ["市场业绩", data.strengthMarket],
    ["技术能力", data.strengthTech],
    ["品牌口碑", data.strengthBrand],
    ["生态与合规实力", data.strengthEcosystem],
    ["其他竞争优势", data.strengthOther],
  ].filter((item): item is [string, string] => Boolean(item[1]?.trim()))

  if (legacyItems.length === 1 && legacyItems[0][0] === "市场业绩") {
    return legacyItems[0][1].trim()
  }
  return legacyItems.map(([label, value]) => `${label}：${value.trim()}`).join("\n") || "—"
}

export function RequestDetailContent({ data }: { data: GeoFormData }) {
  const products = (data.products ?? []).filter((p) => p.name?.trim())
  const domestic = isDomesticFormData(data)
  const regionList = regionTags(data.regions)
  const selectedGoals = data.goals?.length ? data.goals : data.goal ? [data.goal] : []
  const competitorList = (data.brandCompetitors ?? []).map((c) => c.trim()).filter(Boolean)

  if (domestic) {
    return (
      <div className="space-y-6">
        <SectionCard step="一" title="项目联系人" desc="收集公司及联系人信息">
          <DetailField label="1. 公司名称">
            <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.companyName || "—"}</p>
          </DetailField>
          <div>
            <p className="text-sm font-medium">2. 项目联系人</p>
            <div className="mt-2.5 grid gap-4 sm:grid-cols-3">
              <DetailField label="姓名">
                <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.contactName || "—"}</p>
              </DetailField>
              <DetailField label="职位">
                <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.contactTitle || "—"}</p>
              </DetailField>
              <DetailField label="手机号">
                <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.contactPhone || "—"}</p>
              </DetailField>
            </div>
          </div>
        </SectionCard>

        <SectionCard step="二" title="品牌与产品信息" desc="收集品牌、优化范围、产品介绍及官网信息">
          <DetailField label="3. 希望优化的品牌名称">
            <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.brandName || "—"}</p>
          </DetailField>
          <DetailField label="4. 优化对象">
            <div className="grid gap-2 sm:grid-cols-2">
              <ReadonlyChoice selected={data.scopeType === "brand_only"} title="仅优化品牌整体" />
              <ReadonlyChoice selected={data.scopeType === "specific"} title="优化具体产品或服务" />
            </div>
          </DetailField>
          {data.scopeType === "specific" && (
            <div className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
              <DetailField label="产品 / 服务名称">
                {products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <div className="space-y-3">
                    {products.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
                        <TopBadge rank={i + 1} />
                        <span className="text-sm">{p.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </DetailField>
            </div>
          )}
          <DetailField label="5. 是否有国内官方网站？">
            <div className="grid gap-2 sm:grid-cols-2">
              <ReadonlyChoice selected={data.hasOverseasSite === "yes"} title="有官网" />
              <ReadonlyChoice selected={data.hasOverseasSite === "no"} title="暂无官网" />
            </div>
            {!data.hasOverseasSite ? <p className="text-sm text-muted-foreground">—</p> : null}
            {data.hasOverseasSite === "yes" && data.overseasSiteUrl ? (
              <a
                href={data.overseasSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm text-primary hover:underline"
              >
                <Globe className="size-3.5 shrink-0" />
                {data.overseasSiteUrl}
              </a>
            ) : null}
          </DetailField>
        </SectionCard>

        <SectionCard step="三" title="GEO 优化需求" desc="意图、平台、周期、目标与竞争力">
          <DetailField label="6. 您希望用户搜索什么问题时看到您的品牌？">
            <IntentReadonlyList data={data} domestic />
          </DetailField>
          <DetailField label="7. 竞品">
            {competitorList.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <div className="space-y-2">
                {competitorList.map((c, i) => (
                  <div
                    key={`${c}-${i}`}
                    className="flex items-start gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <TopBadge rank={i + 1} />
                    <span className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">{c}</span>
                  </div>
                ))}
              </div>
            )}
          </DetailField>
          <DetailField label="8. 希望优化的 AI 平台">
            <PlatformChips options={DOMESTIC_AI_PLATFORM_OPTIONS} selected={data.platforms ?? []} />
          </DetailField>
          <DetailField label="9. 希望优化的周期">
            <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{domesticPeriodLabel(data)}</p>
          </DetailField>
          <DetailField label="10. 预算">
            <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">
              {data.budget?.trim() || "—"}
            </p>
          </DetailField>
          <DetailField label="11. 您的预计执行时间">
            <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">
              {data.expectedStartDate?.trim() || "—"}
            </p>
          </DetailField>
          <DetailField label="12. 您的具体优化目标">
            <div className="grid gap-2 sm:grid-cols-2">
              {DOMESTIC_OPTIMIZATION_GOALS.map((g) => (
                <ReadonlyChoice key={g.value} selected={(data.goals ?? []).includes(g.value)} title={g.label} />
              ))}
            </div>
            {(data.goals ?? []).some((g) => !DOMESTIC_OPTIMIZATION_GOALS.some((x) => x.value === g)) && (
              <p className="mt-2 text-sm">{requestGoalLabel(data)}</p>
            )}
          </DetailField>
          <DetailField label="13. 企业实力" hint="如：市场业绩、技术能力、品牌口碑声誉、生态优势等">
            <p className="whitespace-pre-line rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm leading-relaxed">
              {enterpriseExampleText(data)}
            </p>
          </DetailField>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionCard step="一" title="项目联系人" desc="收集公司及联系人信息">
        <DetailField label="1. 公司名称" hint="本次合作对应的公司主体">
          <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.companyName || "—"}</p>
        </DetailField>
        <div>
          <p className="text-sm font-medium">2. 联系人信息</p>
          <p className="mt-1 text-xs text-muted-foreground">对接联系人姓名、职位与手机号</p>
          <div className="mt-2.5 grid gap-4 sm:grid-cols-3">
            <DetailField label="联系人姓名">
              <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.contactName || "—"}</p>
            </DetailField>
            <DetailField label="职位">
              <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.contactTitle || "—"}</p>
            </DetailField>
            <DetailField label="手机号">
              <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{data.contactPhone || "—"}</p>
            </DetailField>
          </div>
        </div>
      </SectionCard>

      <SectionCard step="二" title="品牌与产品信息" desc="收集品牌、优化范围、目标用户、产品介绍及官网信息">
        <DetailField label="3. 希望优化的品牌名称">
          <p className="rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm">{brandDisplay(data)}</p>
        </DetailField>

        <DetailField label="4. 本次优化范围">
          <div className="grid gap-2 sm:grid-cols-2">
            <ReadonlyChoice
              selected={data.scopeType === "brand_only"}
              title="仅优化品牌整体"
              desc="只针对品牌名称做整体优化"
            />
            <ReadonlyChoice
              selected={data.scopeType === "specific"}
              title="优化具体产品或服务"
              desc="针对具体的产品或服务做优化"
            />
          </div>
          {data.scopeType && data.scopeType !== "brand_only" && data.scopeType !== "specific" && (
            <p className="mt-2 text-sm">{scopeLabel(data.scopeType)}</p>
          )}
        </DetailField>

        {data.scopeType === "specific" && (
          <div className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
            <DetailField label="请简单介绍该产品或服务" hint="按优先级从高到低（Top 1 为最高优先级）">
              {products.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <div className="space-y-3">
                  {products.map((p, i) => (
                    <ProductReadonlyCard key={p.id} product={p} rank={i + 1} />
                  ))}
                </div>
              )}
            </DetailField>
          </div>
        )}

        <DetailField label="5. 品牌核心目标用户">
          <div className="grid gap-2">
            <ReadonlyChoice selected={data.targetCustomer === "toc"} title="A、TOC" desc="个人消费者：品牌核心目标用户为普通个人消费者，聚焦个体日常消费场景" />
            <ReadonlyChoice selected={data.targetCustomer === "tob"} title="B、TOB" desc="企业/机构客户：品牌核心目标用户为企业、机构、组织等商业客户" />
            <ReadonlyChoice selected={data.targetCustomer === "both"} title="C、TOC & TOB" desc="两类用户均覆盖：同时覆盖个人消费者与企业、机构等商业客户" />
          </div>
          {!data.targetCustomer ? (
            <p className="mt-2 text-sm text-muted-foreground">—</p>
          ) : data.targetCustomer !== "toc" && data.targetCustomer !== "tob" && data.targetCustomer !== "both" ? (
            <p className="mt-2 text-sm">{data.targetCustomer}</p>
          ) : null}
        </DetailField>
        <DetailField label="6. 是否有海外官方网站？">
          <div className="grid gap-2 sm:grid-cols-2">
            <ReadonlyChoice selected={data.hasOverseasSite === "yes"} title="有海外官网" />
            <ReadonlyChoice selected={data.hasOverseasSite === "no"} title="暂无海外官网" />
          </div>
          {data.hasOverseasSite === "yes" && data.overseasSiteUrl ? (
            <a
              href={data.overseasSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm text-primary hover:underline"
            >
              <Globe className="size-3.5 shrink-0" />
              {data.overseasSiteUrl}
            </a>
          ) : null}
        </DetailField>
      </SectionCard>

      <SectionCard step="三" title="GEO 优化需求" desc="收集国家语言、平台、优化背景、用户问题及优化目标">
        <DetailField label="7. 希望优化的 AI 平台">
          <PlatformChips options={AI_PLATFORM_OPTIONS} selected={data.platforms ?? []} />
        </DetailField>

        <DetailField label="8. 各平台重点优化的国家与语言">
          {regionList.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {regionList.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center rounded-full border border-primary bg-primary px-3.5 py-1.5 text-sm text-primary-foreground"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
        </DetailField>

        <DetailField label="9. 优化背景" hint="选填">
          {data.optimizeBackground ? (
            <p className="whitespace-pre-line rounded-lg border border-input bg-muted/30 px-2.5 py-2 text-sm leading-relaxed">
              {data.optimizeBackground}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">未填写</p>
          )}
        </DetailField>

        <DetailField label="10. 您希望用户搜索什么问题时看到您的品牌？" hint="选填">
          <IntentReadonlyList data={data} />
        </DetailField>

        <DetailField label="11. 您的具体优化目标">
          <div className="grid gap-2 sm:grid-cols-2">
            {OPTIMIZATION_GOALS.map((g) => (
              <ReadonlyChoice
                key={g.value}
                selected={selectedGoals.includes(g.value)}
                title={g.label}
                desc={g.desc}
              />
            ))}
          </div>
          {selectedGoals.some((goal) => !OPTIMIZATION_GOALS.some((g) => g.value === goal)) && (
            <p className="mt-2 text-sm">{requestGoalLabel(data)}</p>
          )}
        </DetailField>
      </SectionCard>
    </div>
  )
}
