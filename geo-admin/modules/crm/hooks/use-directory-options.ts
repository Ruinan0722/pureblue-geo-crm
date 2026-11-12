"use client"

import { useEffect, useState } from "react"
import {
  fetchSalesColleagueNames,
  fetchStaffDirectory,
  type DirectoryQuery,
  type MentionScope,
} from "@/modules/crm/services/crm-directory"

export type { MentionScope, DirectoryQuery }

function mergeExtras(list: string[], extra: string[]): string[] {
  const merged = new Set(list)
  for (const name of extra) {
    if (name && name !== "未分配" && name !== "待分配") merged.add(name)
  }
  return Array.from(merged).sort((a, b) => a.localeCompare(b, "zh-CN"))
}

/** 飞书组织架构同步到 users 表的全部在职员工姓名。 */
export function useStaffNames(mentionScope?: MentionScope): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchStaffDirectory(mentionScope)
      .then((list) => {
        if (!cancelled) setNames(Array.from(new Set(list)))
      })
      .catch(() => {
        if (!cancelled) setNames([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mentionScope])

  return { names, loading }
}

/**
 * @ 候选：飞书组织架构中的全部在职成员。
 * scope/entityId 保留在调用签名中，便于各业务入口复用，不参与候选过滤。
 */
export function useMentionNames(
  scope: MentionScope,
  entityId?: string,
): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchStaffDirectory(scope)
      .then((list) => {
        if (!cancelled) setNames(Array.from(new Set(list)))
      })
      .catch(() => {
        if (!cancelled) setNames([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scope, entityId])

  return { names, loading }
}

/**
 * 按角色/部门取飞书正式成员（用于售前顾问、客户成功等下拉；不含全员组织树）。
 */
export function useDepartmentMemberNames(
  query: DirectoryQuery,
  extra: string[] = [],
): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const rolesKey = (query.roles ?? []).join(",")
  const deptsKey = (query.departmentNames ?? []).join(",")
  const scopeKey = query.mentionScope ?? ""
  const managedKey = query.managedOnly ? "managed" : "all"

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchStaffDirectory({
      mentionScope: query.mentionScope,
      roles: query.roles,
      departmentNames: query.departmentNames,
      managedOnly: query.managedOnly,
    })
      .then((list) => {
        if (!cancelled) setNames(mergeExtras(list, extra))
      })
      .catch(() => {
        if (!cancelled) setNames(mergeExtras([], extra))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // extra 仅用于补齐当前已选值
     
  }, [rolesKey, deptsKey, scopeKey, managedKey, extra.join("|")])

  return { names, loading }
}

/** 销售同事：飞书销售组织快照（FEISHU_SALES_DEPARTMENT_IDS 子树），非全公司通讯录 */
export function useSalesNames(extra: string[] = []): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchSalesColleagueNames()
      .then((list) => {
        if (cancelled) return
        setNames(mergeExtras(list, extra))
      })
      .catch(() => {
        if (!cancelled) {
          setNames(mergeExtras([], extra))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
     
  }, [extra.join("|")])

  return { names, loading }
}

/** SDR 成员：users.role=sdr 的在职成员（线索归属 SDR 下拉）。 */
export function useSdrNames(extra: string[] = []): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchStaffDirectory({ roles: ["sdr"] })
      .then((list) => {
        if (cancelled) return
        setNames(mergeExtras(list, extra))
      })
      .catch(() => {
        if (!cancelled) {
          setNames(mergeExtras([], extra))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [extra.join("|")])

  return { names, loading }
}
