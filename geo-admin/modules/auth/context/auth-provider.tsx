"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { AuthUser, Permission, StaffRole } from "@/modules/auth/lib/constants"
import { hasPermission, userCanAccessSection, type SectionKey } from "@/modules/auth/lib/permissions"

export type { SectionKey }

interface AuthContextValue {
  loading: boolean
  kind: "user" | "customer" | "anonymous"
  user: AuthUser | null
  role: StaffRole | "customer" | null
  feishuConfigured: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  canAccess: (s: SectionKey) => boolean
  can: (permission: Permission) => boolean
  isCustomerView: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<"user" | "customer" | "anonymous">("anonymous")
  const [user, setUser] = useState<AuthUser | null>(null)
  const [feishuConfigured, setFeishuConfigured] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
    if (res.ok) {
      const data = (await res.json()) as {
        kind: "user" | "customer"
        user?: AuthUser
        feishuConfigured?: boolean
      }
      setKind(data.kind)
      setUser(data.user ?? null)
      setFeishuConfigured(Boolean(data.feishuConfigured))
    } else {
      setKind("anonymous")
      setUser(null)
      const data = (await res.json().catch(() => ({}))) as { feishuConfigured?: boolean }
      setFeishuConfigured(Boolean(data.feishuConfigured))
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const logout = async () => {
    await fetch("/api/auth/me", { method: "DELETE" })
    setKind("anonymous")
    setUser(null)
    window.location.href = "/login"
  }

  const role: StaffRole | "customer" | null =
    kind === "user" ? (user?.role ?? null) : kind === "customer" ? "customer" : null

  const canAccess = (s: SectionKey) => {
    if (!role) return (s === "intake" || s === "intake_cn") && kind === "customer"
    if (role === "customer") return s === "intake" || s === "intake_cn"
    if (!user) return false
    return userCanAccessSection(user, s)
  }

  const can = (permission: Permission) => {
    if (!user) return false
    return hasPermission(user.permissions, permission)
  }

  const isCustomerView = kind === "customer"

  return (
    <AuthContext.Provider
      value={{ loading, kind, user, role, feishuConfigured, refresh, logout, canAccess, can, isCustomerView }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
