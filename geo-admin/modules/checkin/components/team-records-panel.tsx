"use client"

import { useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Checkbox } from "@/shared/ui/checkbox"
import { DatePicker } from "@/shared/ui/date-picker"
import { Label } from "@/shared/ui/label"
import { CHECKIN_TYPE_FILTER_OPTIONS } from "../lib/filter-constants"
import { RecordList } from "./record-list"
import { useTeamCheckins } from "../hooks/useTeamCheckins"
import { cn } from "@/shared/lib/utils"

interface TeamRecordsPanelProps {
  enabled: boolean
}

export function TeamRecordsPanel({ enabled }: TeamRecordsPanelProps) {
  const {
    filters,
    toggleUserId,
    toggleType,
    updateFilters,
    resetFilters,
    hasActiveFilters,
    records,
    stats,
    memberOptions,
    loading,
    error,
  } = useTeamCheckins(enabled)
  const [showBreakdown, setShowBreakdown] = useState(false)

  if (!enabled) return null

  const breakdown = stats?.userBreakdown ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">成员</legend>
            {memberOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无成员数据</p>
            ) : (
              <ul className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-border/60 p-2">
                {memberOptions.map((item) => {
                  const checked = filters.userIds.includes(item.userId)
                  return (
                    <li key={item.userId}>
                      <Label
                        htmlFor={`member-${item.userId}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50",
                          checked && "bg-primary/5",
                        )}
                      >
                        <Checkbox
                          id={`member-${item.userId}`}
                          checked={checked}
                          onCheckedChange={() => toggleUserId(item.userId)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{item.userName}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                            {item.userId}
                          </span>
                        </span>
                      </Label>
                    </li>
                  )
                })}
              </ul>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">打卡类型</legend>
            <ul className="space-y-1.5 rounded-lg border border-border/60 p-2">
              {CHECKIN_TYPE_FILTER_OPTIONS.map((item) => {
                const checked = filters.types.includes(item.value)
                return (
                  <li key={item.value}>
                    <Label
                      htmlFor={`type-${item.value}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50",
                        checked && "bg-primary/5",
                      )}
                    >
                      <Checkbox
                        id={`type-${item.value}`}
                        checked={checked}
                        onCheckedChange={() => toggleType(item.value)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{item.label}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{item.value}</span>
                      </span>
                    </Label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <DatePicker
            value={filters.fromDate}
            onChange={(fromDate) => updateFilters({ fromDate })}
            placeholder="开始日期"
            aria-label="开始日期"
          />
          <DatePicker
            value={filters.toDate}
            onChange={(toDate) => updateFilters({ toDate })}
            placeholder="结束日期"
            min={filters.fromDate || undefined}
            aria-label="结束日期"
          />
        </div>

        {hasActiveFilters && (
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFilters}>
              清除筛选
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-muted-foreground">
        {loading && !stats ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </span>
        ) : stats ? (
          <>
            <span>
              共 <strong className="font-medium text-foreground">{stats.total}</strong> 条
            </span>
            <span className="text-border">·</span>
            <span>
              <strong className="font-medium text-foreground">{stats.uniqueUsers}</strong> 人打卡
            </span>
            <span className="text-border">·</span>
            <span>
              到达 {stats.arriveCount} / 结束 {stats.leaveCount}
            </span>
          </>
        ) : (
          <span>暂无数据</span>
        )}
      </div>

      {breakdown.length > 1 && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium"
            onClick={() => setShowBreakdown((v) => !v)}
          >
            <span>按成员汇总（{breakdown.length} 人）</span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showBreakdown && "rotate-180")} />
          </button>
          {showBreakdown && (
            <div className="border-t border-border/60 px-2 pb-2">
              {breakdown.map((item) => {
                const active = filters.userIds.includes(item.userId)
                return (
                  <button
                    key={item.userId}
                    type="button"
                    onClick={() => toggleUserId(item.userId)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "hover:bg-muted/50",
                    )}
                  >
                    <span>
                      <span className="font-medium">{item.userName}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{item.userId}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {item.count} 次
                      <span className="ml-2 text-xs">
                        到达 {item.arriveCount} · 结束 {item.leaveCount}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <RecordList records={records} variant="team" loading={loading} />
    </div>
  )
}
