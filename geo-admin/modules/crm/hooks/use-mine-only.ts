"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { canSeeTeamPools } from "@/modules/auth/lib/permissions"
import { readRaw, writeRaw } from "@/shared/lib/storage"

const STORAGE_KEY = "crm-mine-only"

/** 「只看自己」开关：凡能看见他人对接池（服务端 data_scope 非 own）的用户可切换，
 * 由数据范围驱动而不是角色名单，管理员/运营/超管同样可见（后端始终按范围过滤，仅作 UX 筛选）。 */
export function useMineOnlyFilter() {
  const { user } = useAuth()
  const available = user ? canSeeTeamPools(user) : false

  const [mineOnly, setMineOnlyState] = useState(false)

  useEffect(() => {
    if (!available) {
      setMineOnlyState(false)
      return
    }
    setMineOnlyState(readRaw("session", STORAGE_KEY) === "1")
  }, [available])

  const setMineOnly = useCallback(
    (next: boolean) => {
      if (!available) return
      setMineOnlyState(next)
      writeRaw("session", STORAGE_KEY, next ? "1" : "0")
    },
    [available],
  )

  return {
    mineOnly: available && mineOnly,
    setMineOnly,
    available,
  }
}
