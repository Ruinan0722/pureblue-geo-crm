"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, Search, Star, Plus } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Button } from "@/shared/ui/button"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import { CreateCustomerDialog } from "@/modules/crm/components/create-customer-dialog"
import {
  CUSTOMER_STATUSES,
  REGIONS,
  customerStatusMeta,
  daysSinceDate,
  latestFollowDate,
  normalizeCustomerStatus,
  type Contact,
  type Customer,
  type CustomerStatus,
} from "@/modules/crm/lib/crm-data"
import { IndustryFilter } from "@/modules/crm/components/industry-filter"
import {
  StatCards,
  FilterSelect,
  FilterField,
  FilterChips,
  FilterGrid,
  EmptyState,
} from "@/modules/crm/components/ui"
import { DateRangePicker } from "@/shared/ui/date-range-picker"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import type { CustomerListFilters } from "@/modules/crm/services/crm-api"
import { fetchCustomerStats, type CustomerStats } from "@/modules/crm/services/crm-api"
import { useMineOnlyFilter } from "@/modules/crm/hooks/use-mine-only"
import { MineOnlyToggle } from "@/modules/crm/components/mine-only-toggle"
import { ContentLoadingOverlay } from "@/shared/ui/content-loading"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { useAuth } from "@/modules/auth"
import { canDo } from "@/modules/auth/lib/permissions"
import { DEFAULT_LIST_PAGE_SIZE } from "@/shared/lib/list-pagination"
import { ListPagination } from "@/shared/ui/list-pagination"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"
import { useSessionRestoredOpen } from "@/shared/hooks/use-form-draft"

const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

type CustomerSortKey =
  | "name"
  | "industry"
  | "region"
  | "owner"
  | "counts"
  | "lastFollowAt"
  | "unfollowDays"
  | "nextFollowAt"
  | "status"

type CustomerQuery = {
  companyName: string
  brandName: string
  owner: string
  status: CustomerStatus | "all"
  industry: string[]
  industryL2: string[]
  region: string
  keyOnly: "all" | "key"
  lastFollowFrom: string
  lastFollowTo: string
  nextFollowFrom: string
  nextFollowTo: string
  relation: "all" | "opp" | "contract" | "none"
}

const EMPTY_QUERY: CustomerQuery = {
  companyName: "",
  brandName: "",
  owner: "",
  status: "all",
  industry: [],
  industryL2: [],
  region: "all",
  keyOnly: "all",
  lastFollowFrom: "",
  lastFollowTo: "",
  nextFollowFrom: "",
  nextFollowTo: "",
  relation: "all",
}

function customerUnfollowDays(customer: Customer): number | null {
  return daysSinceDate(latestFollowDate(customer.notes) || customer.lastFollowAt)
}

/** 兼容旧 sessionStorage：单值 / "all" / 逗号串 → 数组 */
function coerceMulti(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter((v) => v && v !== "all")
  }
  if (typeof raw === "string") {
    const t = raw.trim()
    if (!t || t === "all") return []
    return t
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((v) => v && v !== "all")
  }
  return []
}

function joinCsv(values: unknown): string | undefined {
  const cleaned = (Array.isArray(values) ? values : coerceMulti(values))
    .map((v) => String(v).trim())
    .filter((v) => v && v !== "all")
  return cleaned.length > 0 ? cleaned.join(",") : undefined
}

function toApiFilters(query: CustomerQuery, page: number, mineOnly: boolean): CustomerListFilters {
  return {
    companyName: query.companyName.trim() || undefined,
    brandName: query.brandName.trim() || undefined,
    owner: mineOnly ? undefined : query.owner.trim() || undefined,
    status: query.status,
    industry: joinCsv(query.industry),
    industryL2: joinCsv(query.industryL2),
    region: query.region,
    keyOnly: query.keyOnly === "key",
    lastFollowFrom: query.lastFollowFrom || undefined,
    lastFollowTo: query.lastFollowTo || undefined,
    nextFollowFrom: query.nextFollowFrom || undefined,
    nextFollowTo: query.nextFollowTo || undefined,
    relation: query.relation !== "all" ? query.relation : undefined,
    mineOnly: mineOnly || undefined,
    coverageScope: mineOnly ? "self" : undefined,
    page,
    pageSize: PAGE_SIZE,
  }
}

const CONTACT_STATUS_ORDER: CustomerStatus[] = [
  "awaiting_contact",
  "connected",
  "opportunity_following",
  "cooperating",
  "stopped",
]

const CONTACT_STATUS_COLORS: Record<CustomerStatus, string> = {
  awaiting_contact: "bg-orange-500",
  connected: "bg-blue-500",
  opportunity_following: "bg-amber-400",
  cooperating: "bg-emerald-500",
  stopped: "bg-slate-400",
  potential: "bg-orange-500",
  following: "bg-blue-500",
  lost: "bg-slate-400",
}

function contactStatusCounts(contacts: Contact[]) {
  const counts = new Map<CustomerStatus, number>()
  for (const contact of contacts) {
    const status = normalizeCustomerStatus(contact.status)
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return CONTACT_STATUS_ORDER.filter((s) => counts.has(s)).map((s) => ({
    status: s,
    count: counts.get(s) ?? 0,
  }))
}

/** 客户列表「状态」列：以联系人为基本单位展示总数及状态占比分布。 */
function ContactStatusSummary({ contacts }: { contacts: Contact[] }) {
  const items = contactStatusCounts(contacts)
  const total = contacts.length

  return (
    <div className="flex min-w-[15rem] items-center gap-3">
      <span className="w-8 shrink-0 font-medium text-foreground">{total}人</span>
      <div
        className="flex h-3 min-w-32 flex-1 overflow-hidden rounded-full bg-muted"
        aria-label={total ? items.map(({ status, count }) => `${customerStatusMeta(status).label} ${count}人`).join("，") : "暂无联系人"}
      >
        {items.map(({ status, count }) => (
          <span
            key={status}
            className={CONTACT_STATUS_COLORS[status]}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${customerStatusMeta(status).label} ${count}人`}
          />
        ))}
      </div>
    </div>
  )
}

function ContactStatusDetails({ contacts }: { contacts: Contact[] }) {
  const items = contactStatusCounts(contacts)
  return (
    <div className="px-4 py-4">
      <p className="mb-3 text-sm text-muted-foreground">联系人状态分布</p>
      {items.length ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {items.map(({ status, count }) => (
            <div key={status} className="flex items-center gap-2 text-sm">
              <span className={`size-2.5 rounded-full ${CONTACT_STATUS_COLORS[status]}`} aria-hidden />
              <span>{customerStatusMeta(status).label}</span>
              <span className="font-semibold tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">暂无联系人</p>
      )}
    </div>
  )
}

export function CustomerList() {
  const router = useRouter()
  const {
    customers,
    customerStats,
    customerListTotal,
    customersListLoading,
    searchCustomers,
  } = useCrm()
  const { canAccess, canEdit: _canEdit } = useRole()
  const { user } = useAuth()
  /** 自拓建档入口与空态提示：有 customers:create（或遗留 customers:write）即展示 */
  const canCreateCustomer = canDo(user?.permissions ?? [], "customers:create", "customers:write")
  const { mineOnly, setMineOnly, available: mineOnlyAvailable } = useMineOnlyFilter()
  const [mineStats, setMineStats] = useState<CustomerStats | null>(null)
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useSessionRestoredOpen("crm:create-customer")
  const showOppContract = canAccess("opportunities") || canAccess("contracts")
  const { draft, setDraft, applied, setApplied, listStateReady } = usePersistedListApplied(
    `crm:customers-list:${user?.id || user?.name || "anonymous"}`,
    EMPTY_QUERY,
  )
  const { sort, toggleSort } = useTableSort<CustomerSortKey>()

  const totalPages = Math.max(1, Math.ceil(customerListTotal / PAGE_SIZE))
  const currentPage = Math.min(applied.page, totalPages)
  const displayStats = mineOnly && mineStats ? mineStats : customerStats

  useEffect(() => {
    if (!mineOnly) {
      setMineStats(null)
      return
    }
    let cancelled = false
    void fetchCustomerStats({ mineOnly: true })
      .then((stats) => {
        if (!cancelled) setMineStats(stats)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [mineOnly])

  // 统计卡片用 bootstrap 下发的 customerStats；转客户等写操作后再 refreshCustomerStats
  useEffect(() => {
    if (!listStateReady) return
    let cancelled = false
    void searchCustomers(toApiFilters(applied.query, applied.page, mineOnly))
      .then((result) => {
        if (cancelled) return
        const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
        if (applied.page > pages) {
          setApplied((prev) => ({ ...prev, page: pages }))
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "加载客户列表失败")
        }
      })
    return () => {
      cancelled = true
    }
  }, [applied, searchCustomers, mineOnly, listStateReady, setApplied])

  const sorted = useMemo(
    () =>
      sortRows(customers, sort, {
        name: (c) => c.brandName || c.companyName,
        industry: (c) => `${c.industryL1}/${c.industryL2 ?? ""}`,
        region: (c) => c.region,
        owner: (c) => c.owner,
        counts: (c) => (c.opportunityCount ?? 0) * 1000 + (c.contractCount ?? 0),
        lastFollowAt: (c) => c.lastFollowAt,
        unfollowDays: customerUnfollowDays,
        nextFollowAt: (c) => c.nextFollowAt || "",
        status: (c) => c.status,
      }),
    [customers, sort],
  )

  function patchDraft<K extends keyof CustomerQuery>(key: K, value: CustomerQuery[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function handleMineOnlyChange(next: boolean) {
    setMineOnly(next)
    setApplied((prev) => ({ ...prev, page: 1 }))
  }

  function handleSearch() {
    setApplied({ query: { ...draft }, page: 1 })
  }

  function handleReset() {
    setDraft(EMPTY_QUERY)
    setApplied({ query: EMPTY_QUERY, page: 1 })
  }

  /** 客户状态芯片：点击即查询，无需再点「查询」 */
  function handleStatusQuickChange(next: CustomerStatus | "all") {
    setDraft((prev) => ({ ...prev, status: next }))
    setApplied((prev) => ({ query: { ...prev.query, status: next }, page: 1 }))
  }

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === applied.page) return
    setApplied((prev) => ({ ...prev, page: next }))
  }


  return (
    <div className="space-y-3">
      <StatCards
        dense
        cols={5}
        items={[
          { label: "客户总数", value: displayStats.total },
          { label: "已合作", value: displayStats.cooperating, tone: "text-emerald-600" },
          {
            label: "商机跟进",
            value: displayStats.opportunityFollowing ?? 0,
            tone: "text-amber-600",
          },
          {
            label: "已建联",
            value: displayStats.connected ?? 0,
            tone: "text-primary",
          },
          { label: "重点客户", value: displayStats.key, tone: "text-amber-600" },
        ]}
      />

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {mineOnly
              ? `当前仅显示本人（${user?.name || "我"}）名下客户`
              : mineOnlyAvailable
                ? "默认显示全部客户主档，对接内容按销售隔离；可切换只看自己"
                : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {mineOnlyAvailable ? (
              <MineOnlyToggle
                value={mineOnly}
                onChange={handleMineOnlyChange}
                disabled={customersListLoading}
              />
            ) : null}
          </div>
        </div>
        <FilterGrid>
          <FilterField label="公司名称">
            <Input
              className="h-9"
              placeholder="请输入公司名称"
              value={draft.companyName}
              onChange={(e) => patchDraft("companyName", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="品牌名称">
            <Input
              className="h-9"
              placeholder="请输入品牌名称"
              value={draft.brandName}
              onChange={(e) => patchDraft("brandName", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="行业">
            <IndustryFilter
              industry={coerceMulti(draft.industry)}
              industryDetail={coerceMulti(draft.industryL2)}
              onValuesChange={(industry, industryL2) => {
                patchDraft("industry", industry)
                patchDraft("industryL2", industryL2)
              }}
            />
          </FilterField>
          <FilterField label="区域">
            <FilterSelect
              value={draft.region}
              onChange={(v) => patchDraft("region", v)}
              options={[{ value: "all", label: "全部区域" }, ...REGIONS.map((r) => ({ value: r, label: r }))]}
            />
          </FilterField>
          <FilterField label="销售负责人">
            <Input
              className="h-9"
              placeholder={mineOnly ? user?.name || "本人" : "请输入负责人"}
              value={mineOnly ? user?.name || "" : draft.owner}
              disabled={mineOnly}
              onChange={(e) => patchDraft("owner", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
            />
          </FilterField>
          <FilterField label="商机 / 合同">
            <FilterSelect
              value={draft.relation}
              onChange={(v) => patchDraft("relation", v as CustomerQuery["relation"])}
              options={[
                { value: "all", label: "全部客户" },
                { value: "opp", label: "有商机" },
                { value: "contract", label: "有合同" },
                { value: "none", label: "无商机且无合同" },
              ]}
            />
          </FilterField>
          <FilterField label="最近跟进">
            <DateRangePicker
              from={draft.lastFollowFrom}
              to={draft.lastFollowTo}
              onChange={({ from, to }) =>
                setDraft((prev) => ({
                  ...prev,
                  lastFollowFrom: from,
                  lastFollowTo: to,
                }))
              }
              placeholder="选择最近跟进日期范围"
            />
          </FilterField>
          <FilterField label="下次计划跟进">
            <DateRangePicker
              from={draft.nextFollowFrom}
              to={draft.nextFollowTo}
              onChange={({ from, to }) =>
                setDraft((prev) => ({
                  ...prev,
                  nextFollowFrom: from,
                  nextFollowTo: to,
                }))
              }
              placeholder="选择下次计划跟进日期范围"
            />
          </FilterField>
          <FilterField label="重点客户">
            <FilterSelect
              value={draft.keyOnly}
              onChange={(v) => patchDraft("keyOnly", v as "all" | "key")}
              options={[
                { value: "all", label: "全部客户" },
                { value: "key", label: "仅重点客户" },
              ]}
            />
          </FilterField>
        </FilterGrid>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <FilterChips
              value={applied.query.status}
              onChange={handleStatusQuickChange}
              options={[
                { value: "all", label: "全部状态" },
                ...CUSTOMER_STATUSES.map((s) => ({
                  value: s,
                  label: customerStatusMeta(s).label,
                })),
              ]}
            />
          </div>
          {canCreateCustomer ? (
            <Button type="button" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新建客户
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={handleReset}>
            重置
          </Button>
          <Button type="button" className="gap-1.5" onClick={handleSearch}>
            <Search className="size-4" />
            查询
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        {customersListLoading ? <ContentLoadingOverlay label="正在加载客户列表…" /> : null}
        <TableCellTip>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                <SortableTh label="客户 / 品牌" sortKey="name" sort={sort} onToggle={toggleSort} />
                <SortableTh label="行业" sortKey="industry" sort={sort} onToggle={toggleSort} />
                <SortableTh label="区域" sortKey="region" sort={sort} onToggle={toggleSort} />
                <SortableTh label="销售负责人" sortKey="owner" sort={sort} onToggle={toggleSort} />
                {showOppContract && (
                  <SortableTh label="商机 / 合同" sortKey="counts" sort={sort} onToggle={toggleSort} />
                )}
                <SortableTh label="最近跟进" sortKey="lastFollowAt" sort={sort} onToggle={toggleSort} />
                <SortableTh label="未跟进天数" sortKey="unfollowDays" sort={sort} onToggle={toggleSort} />
                <SortableTh label="下次计划跟进" sortKey="nextFollowAt" sort={sort} onToggle={toggleSort} />
                <SortableTh label="状态" sortKey="status" sort={sort} onToggle={toggleSort} />
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <Fragment key={c.id}>
                  <tr
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/30"
                  onClick={() => router.push(`/customers/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      router.push(`/customers/${c.id}`)
                    }
                  }}
                >
                  <td className="max-w-0 px-4 py-3">
                    <p
                      className="flex items-center gap-1.5 truncate font-medium"
                      title={[c.companyName, c.brandName].filter(Boolean).join(" / ") || undefined}
                    >
                      {c.isKey && (
                        <span title="重点客户">
                          <Star
                            className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                            aria-label="重点客户"
                          />
                        </span>
                      )}
                      <span className="min-w-0 truncate">
                        <span>{c.companyName || c.brandName || "—"}</span>
                        {c.brandName && c.brandName !== c.companyName ? (
                          <span className="font-normal text-muted-foreground"> · {c.brandName}</span>
                        ) : null}
                      </span>
                    </p>
                  </td>
                  <td className="max-w-0 whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <span
                      className="block truncate"
                      title={[c.industryL1, c.industryL2].filter(Boolean).join(" / ") || undefined}
                    >
                      {c.industryL1}
                      {c.industryL2 ? ` / ${c.industryL2}` : ""}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">{c.region}</td>
                  <td className="max-w-0 truncate px-4 py-3">{c.owner}</td>
                  {showOppContract && (
                    <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">
                      {c.opportunityCount ?? 0} / {c.contractCount ?? 0}
                    </td>
                  )}
                  <td className="max-w-0 truncate px-4 py-3 text-xs text-muted-foreground">{c.lastFollowAt}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-amber-600">
                    {(() => {
                      const days = customerUnfollowDays(c)
                      return days == null ? "—" : `未跟进 ${days}天`
                    })()}
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 text-xs text-amber-600">
                    {c.nextFollowAt?.slice(0, 10) || "未安排"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ContactStatusSummary contacts={c.contacts ?? []} />
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary hover:underline"
                        aria-expanded={expandedCustomerId === c.id}
                        aria-controls={`customer-status-details-${c.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedCustomerId((current) => current === c.id ? null : c.id)
                        }}
                      >
                        详情
                        {expandedCustomerId === c.id ? (
                          <ChevronDown className="size-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => router.push(`/customers/${c.id}`)}>
                      查看详情
                    </Button>
                  </td>
                  </tr>
                  {expandedCustomerId === c.id ? (
                    <tr id={`customer-status-details-${c.id}`} className="border-b border-border bg-secondary/20">
                      <td colSpan={showOppContract ? 10 : 9}>
                        <ContactStatusDetails contacts={c.contacts ?? []} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </TableCellTip>
        {sorted.length === 0 && !customersListLoading && (
          <EmptyState
            text={
              customerListTotal === 0
                ? canCreateCustomer
                  ? "暂无可见客户。可点击「新建客户」自拓建档，或由线索转客户后继续跟进。"
                  : "暂无可见客户。销售可查看自己负责的客户。"
                : "没有符合条件的客户"
            }
          />
        )}
      </div>

      <ListPagination
        total={customerListTotal}
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={goToPage}
        loading={customersListLoading}
        label="家客户"
      />

      {canCreateCustomer ? (
        <CreateCustomerDialog open={createOpen} onOpenChange={setCreateOpen} />
      ) : null}
    </div>
  )
}
