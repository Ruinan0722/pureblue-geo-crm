"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { computeCheckinStats, filterCheckinRecords } from "../lib/stats-utils"
import { dateToEndTimestamp, dateToStartTimestamp, fetchCheckinRecords } from "../services/checkin-api"
import type { CheckinRecord, CheckinType, CheckinUserBreakdown } from "../lib/types"

export interface TeamCheckinFilters {
  /** 成员 userId（非姓名） */
  userIds: string[]
  /** 打卡类型 code：arrive | leave（非中文） */
  types: CheckinType[]
  fromDate: string
  toDate: string
}

const defaultFilters: TeamCheckinFilters = {
  userIds: [],
  types: [],
  fromDate: "",
  toDate: "",
}

function toDateApiFilters(filters: TeamCheckinFilters) {
  return {
    scope: "team" as const,
    from: filters.fromDate ? dateToStartTimestamp(filters.fromDate) : undefined,
    to: filters.toDate ? dateToEndTimestamp(filters.toDate) : undefined,
  }
}

export function useTeamCheckins(enabled: boolean) {
  const [filters, setFilters] = useState<TeamCheckinFilters>(defaultFilters)
  const [sourceRecords, setSourceRecords] = useState<CheckinRecord[]>([])
  const [memberOptions, setMemberOptions] = useState<CheckinUserBreakdown[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const records = useMemo(
    () => filterCheckinRecords(sourceRecords, filters),
    [sourceRecords, filters],
  )

  const stats = useMemo(() => computeCheckinStats(records), [records])

  const load = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError("")
    try {
      const nextRecords = await fetchCheckinRecords(toDateApiFilters(filters))
      setSourceRecords(nextRecords)
      setMemberOptions(computeCheckinStats(nextRecords).userBreakdown)
    } catch (err) {
      setSourceRecords([])
      setMemberOptions([])
      setError(err instanceof Error ? err.message : "加载团队打卡数据失败")
    } finally {
      setLoading(false)
    }
  }, [enabled, filters.fromDate, filters.toDate])

  useEffect(() => {
    void load()
  }, [load])

  const toggleUserId = useCallback((userId: string) => {
    setFilters((prev) => ({
      ...prev,
      userIds: prev.userIds.includes(userId)
        ? prev.userIds.filter((id) => id !== userId)
        : [...prev.userIds, userId],
    }))
  }, [])

  const toggleType = useCallback((type: CheckinType) => {
    setFilters((prev) => ({
      ...prev,
      types: prev.types.includes(type) ? prev.types.filter((item) => item !== type) : [...prev.types, type],
    }))
  }, [])

  const updateFilters = useCallback((patch: Partial<TeamCheckinFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters)
  }, [])

  const hasActiveFilters = useMemo(
    () => Boolean(filters.userIds.length || filters.types.length || filters.fromDate || filters.toDate),
    [filters],
  )

  return {
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
    reload: load,
  }
}
