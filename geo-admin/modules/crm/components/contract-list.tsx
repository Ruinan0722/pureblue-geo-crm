"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Button } from "@/shared/ui/button"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import { canDo } from "@/modules/auth/lib/permissions"
import { useMineOnlyFilter } from "@/modules/crm/hooks/use-mine-only"
import { MineOnlyToggle } from "@/modules/crm/components/mine-only-toggle"
import { NewContractDialog } from "@/modules/crm/components/contract-form-dialog"
import { useSessionRestoredOpen } from "@/shared/hooks/use-form-draft"
import { useAuth } from "@/modules/auth"
import {
  CONTRACT_SOURCES,
  CONTRACT_STATUS_META,
  CONTRACT_TYPES,
  PROJECT_STATUS_META,
  contractOwnerNames,
  money,
  type ContractStatus,
  type ProjectStatus,
} from "@/modules/crm/lib/crm-data"
import {
  Pill,
  StatCards,
  FilterChips,
  FilterField,
  FilterGrid,
  FilterSelect,
  RangeFilterField,
  EmptyState,
} from "@/modules/crm/components/ui"
import { SortableTh, sortRows, useTableSort } from "@/shared/lib/table-sort"
import { DEFAULT_LIST_PAGE_SIZE, paginateSlice } from "@/shared/lib/list-pagination"
import { ListPagination } from "@/shared/ui/list-pagination"
import { TableCellTip } from "@/shared/ui/cell-tip"
import { usePersistedListApplied } from "@/shared/hooks/use-persisted-list-state"

type ContractSortKey = "code" | "company" | "type" | "amount" | "owners" | "projectStatus" | "status"

type ContractQuery = {
  keyword: string
  status: ContractStatus | "all"
  typeFilter: string
  sourceFilter: string
  projectStatus: string
  amountMin: string
  amountMax: string
}

const EMPTY_QUERY: ContractQuery = {
  keyword: "",
  status: "all",
  typeFilter: "all",
  sourceFilter: "all",
  projectStatus: "all",
  amountMin: "",
  amountMax: "",
}

const PROJECT_STATUSES = Object.keys(PROJECT_STATUS_META) as ProjectStatus[]
const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

export function ContractList() {
  const router = useRouter()
  const { contracts, loading, ensureContractsLoaded, contractsLoading } = useCrm()
  const { contractScope, identity } = useRole()
  const { user } = useAuth()
  const { mineOnly, setMineOnly, available: mineOnlyAvailable } = useMineOnlyFilter()

  useEffect(() => {
    void ensureContractsLoaded().catch(() => undefined)
  }, [ensureContractsLoaded])
  const canCreateContract = canDo(user?.permissions ?? [], "contracts:create", "contracts:write")
  const { applied, setApplied } = usePersistedListApplied(
    `crm:contracts-list:${user?.id || user?.name || "anonymous"}`,
    EMPTY_QUERY,
  )
  const { keyword, status, typeFilter, sourceFilter, projectStatus, amountMin, amountMax } =
    applied.query
  const page = applied.page
  const [createOpen, setCreateOpen] = useSessionRestoredOpen((key) =>
    key.startsWith("crm:create-contract:"),
  )
  const { sort, toggleSort } = useTableSort<ContractSortKey>()

  function patchQuery<K extends keyof ContractQuery>(key: K, value: ContractQuery[K]) {
    setApplied((prev) => ({
      query: { ...prev.query, [key]: value },
      page: 1,
    }))
  }

  function handleMineOnlyChange(next: boolean) {
    setMineOnly(next)
    setApplied((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }

  function handleToggleSort(key: ContractSortKey) {
    toggleSort(key)
    setApplied((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }

  // 列表数据范围由 geo-api dataScope 过滤；此处仅做无权限空态
  const scoped = useMemo(() => {
    const base = contractScope === "none" ? [] : contracts
    if (!mineOnly || !user?.name) return base
    return base.filter((c) => contractOwnerNames(c).includes(user.name))
  }, [contracts, contractScope, mineOnly, user?.name])

  const scopeHint =
    mineOnly
      ? `当前仅显示本人（${user?.name || "我"}）相关合同`
      : contractScope === "own"
        ? "当前身份仅可查看本人相关的合同（服务端已按数据范围过滤）"
        : contractScope === "dept"
          ? `当前身份仅可查看本部门相关的合同${identity.dept ? `（${identity.dept}）` : ""}`
          : null

  const stats = useMemo(() => {
    const signed = scoped.filter((c) => c.status === "signed")
    return {
      total: scoped.length,
      signed: signed.length,
      pending: scoped.filter((c) => c.status === "pending").length,
      amount: signed.reduce((s, c) => s + (Number(c.amount) || 0), 0),
    }
  }, [scoped])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const rows = scoped.filter((c) => {
      const ms = status === "all" || c.status === status
      const mt = typeFilter === "all" || c.type === typeFilter
      const msrc = sourceFilter === "all" || (c.source || "") === sourceFilter
      const mp = projectStatus === "all" || c.projectStatus === projectStatus
      const mkw =
        !kw ||
        c.name.toLowerCase().includes(kw) ||
        c.company.toLowerCase().includes(kw) ||
        c.code.toLowerCase().includes(kw) ||
        contractOwnerNames(c).some((n) => n.toLowerCase().includes(kw))
      const amount = Number(c.amount || 0)
      const mMin = amountMin === "" || amount >= Number(amountMin)
      const mMax = amountMax === "" || amount <= Number(amountMax)
      return ms && mt && msrc && mp && mkw && mMin && mMax
    })
    return sortRows(rows, sort, {
      code: (c) => c.code || c.name,
      company: (c) => c.company,
      type: (c) => c.type,
      amount: (c) => c.amount,
      owners: (c) => contractOwnerNames(c).join(", "),
      projectStatus: (c) => c.projectStatus,
      status: (c) => c.status,
    })
  }, [scoped, keyword, status, typeFilter, sourceFilter, projectStatus, amountMin, amountMax, sort])

  const paged = useMemo(() => paginateSlice(filtered, page, PAGE_SIZE), [filtered, page])

  if (loading || contractsLoading) {
    return <div className="px-5 py-10 text-center text-sm text-muted-foreground">加载合同数据中…</div>
  }

  return (
    <div className="space-y-3">
      <StatCards
        dense
        items={[
          { label: "合同总数", value: stats.total },
          { label: "已签订", value: stats.signed, tone: "text-emerald-600" },
          { label: "待签订", value: stats.pending, tone: "text-amber-600" },
          { label: "已签约金额", value: money(stats.amount), tone: "text-primary" },
        ]}
      />

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{scopeHint || "按合同类型、来源与状态筛选"}</p>
          <div className="flex flex-wrap items-center gap-2">
            {mineOnlyAvailable ? (
              <MineOnlyToggle value={mineOnly} onChange={handleMineOnlyChange} />
            ) : null}
            {canCreateContract && (
              <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                新增合同
              </Button>
            )}
          </div>
        </div>
        <FilterGrid>
          <FilterField label="关键词">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="合同名称、客户或编号"
                value={keyword}
                onChange={(e) => patchQuery("keyword", e.target.value)}
              />
            </div>
          </FilterField>
          <FilterField label="合同类型">
            <FilterSelect
              value={typeFilter}
              onChange={(v) => patchQuery("typeFilter", v)}
              options={[
                { value: "all", label: "全部类型" },
                ...CONTRACT_TYPES.map((t) => ({ value: t, label: t })),
              ]}
              placeholder="全部类型"
            />
          </FilterField>
          <RangeFilterField
            label="金额（万元）"
            minValue={amountMin}
            maxValue={amountMax}
            onMinChange={(v) => patchQuery("amountMin", v)}
            onMaxChange={(v) => patchQuery("amountMax", v)}
            minProps={{ min: 0 }}
            maxProps={{ min: 0 }}
          />
          <FilterField label="项目状态">
            <FilterSelect
              value={projectStatus}
              onChange={(v) => patchQuery("projectStatus", v)}
              options={[
                { value: "all", label: "全部项目状态" },
                ...PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_META[s].label })),
              ]}
              placeholder="全部项目状态"
            />
          </FilterField>
          <FilterField label="合同来源">
            <FilterSelect
              value={sourceFilter}
              onChange={(v) => patchQuery("sourceFilter", v)}
              options={[
                { value: "all", label: "全部来源" },
                ...CONTRACT_SOURCES.map((s) => ({ value: s, label: s })),
              ]}
              placeholder="全部来源"
            />
          </FilterField>
        </FilterGrid>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">合同状态</span>
            <FilterChips
              value={status}
              onChange={(v) => patchQuery("status", v as ContractStatus | "all")}
              options={[
                { value: "all", label: "全部" },
                { value: "pending", label: "待签订" },
                { value: "signed", label: "已签订" },
                { value: "terminated", label: "签订后终止" },
                { value: "closed", label: "已关闭" },
                { value: "void", label: "已作废" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <TableCellTip>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                <SortableTh label="合同编号 / 名称" sortKey="code" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="客户" sortKey="company" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="类型" sortKey="type" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="金额" sortKey="amount" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="负责人" sortKey="owners" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="项目状态" sortKey="projectStatus" sort={sort} onToggle={handleToggleSort} />
                <SortableTh label="合同状态" sortKey="status" sort={sort} onToggle={handleToggleSort} />
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((c) => (
                <tr
                  key={c.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/30"
                  onClick={() => router.push(`/contracts/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      router.push(`/contracts/${c.id}`)
                    }
                  }}
                >
                  <td className="max-w-0 px-4 py-3">
                    <p
                      className="flex min-w-0 items-baseline gap-2 truncate"
                      title={[c.code, c.name].filter(Boolean).join(" / ") || undefined}
                    >
                      <span className="shrink-0 font-mono text-[10px] leading-none tracking-tight text-muted-foreground">
                        {c.code || "-"}
                      </span>
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                    </p>
                  </td>
                  <td className="max-w-0 whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <span className="block truncate" title={c.company || undefined}>
                      {c.company}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-4 py-3 text-muted-foreground">{c.type}</td>
                  <td className="max-w-0 truncate px-4 py-3 font-semibold tabular-nums">{money(c.amount)}</td>
                  <td className="max-w-0 whitespace-nowrap px-4 py-3">
                    <span className="block truncate" title={contractOwnerNames(c).join(", ") || undefined}>
                      {contractOwnerNames(c).join(", ") || "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Pill
                      label={PROJECT_STATUS_META[c.projectStatus]?.label ?? c.projectStatus ?? "—"}
                      tone={PROJECT_STATUS_META[c.projectStatus]?.tone ?? "muted"}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Pill
                      label={CONTRACT_STATUS_META[c.status]?.label ?? c.status ?? "—"}
                      tone={CONTRACT_STATUS_META[c.status]?.tone ?? "muted"}
                    />
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Button variant="outline" size="sm" onClick={() => router.push(`/contracts/${c.id}`)}>
                      查看详情
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </TableCellTip>
        {filtered.length === 0 && <EmptyState text="没有符合条件的合同" />}
      </div>
      <ListPagination
        total={paged.total}
        page={paged.currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={(next) => setApplied((prev) => ({ ...prev, page: next }))}
        label="份合同"
      />

      {createOpen && <NewContractDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  )
}
