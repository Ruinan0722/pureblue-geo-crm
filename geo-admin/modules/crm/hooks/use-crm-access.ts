"use client"

import { useAuth } from "@/modules/auth/context/auth-provider"
import {
  canEditSectionFromPermissions,
  hasPermission,
  type SectionKey,
} from "@/modules/auth/lib/permissions"

/** 合同数据可见范围：无 / 仅本人签约 / 本部门 / 全部 */
export type ContractScope = "none" | "own" | "dept" | "all"

/** 展示用角色文案（工作台等；运行时权限以 RBAC 为准） */
export const ROLE_META: Record<string, { label: string; desc: string }> = {
  sdr: { label: "SDR", desc: "线索跟进与转化；首页工作台" },
  sales: { label: "销售", desc: "客户、需求与商机推进；合同默认只读" },
  leader: { label: "销售 Leader", desc: "负责部门及下级销售的经营与签约数据" },
  ops: { label: "销售运营", desc: "维护合同与经营数据；可查看线索" },
  presales: { label: "售前顾问", desc: "全量商机只读；顾问反馈与数据看板" },
  viewer: { label: "客户成功", desc: "交付项目维护与进度跟进" },
  overseas: { label: "海外运营", desc: "全量可见海外归属：需求、商机、合同、项目、海外填报与数据看板" },
  marketing: { label: "市场", desc: "线索、客户与数据看板只读" },
  marketing_leader: { label: "市场负责人", desc: "经营链路只读；可编辑线索" },
  admin: { label: "管理员", desc: "全部数据与系统设置；可开放业务身份" },
  super_admin: { label: "超级管理员", desc: "唯一；可设置/取消管理员" },
  customer: { label: "客户", desc: "仅客户填报" },
}

/**
 * CRM 页面对齐原型 `useRole`：
 * - 可见：section:*
 * - 可编辑：对应 *:write（或 request:edit / section:settings）
 * - 顾问反馈：opportunities:advisor
 * - 合同范围：由 dataScope 映射
 */
export function useRole() {
  const { user, role, canAccess } = useAuth()
  const permissions = user?.permissions ?? []

  const canEdit = (section: SectionKey) => canEditSectionFromPermissions(permissions, section)

  const canEditAdvisor = hasPermission(permissions, "opportunities:advisor")

  const dataScope = user?.dataScope ?? "own"
  const contractScope: ContractScope = !canAccess("contracts")
    ? "none"
    : dataScope === "all"
      ? "all"
      : dataScope === "department"
        ? "dept"
        : "own"

  const identity = {
    name: user?.name,
    dept: user?.departmentNames?.[0],
  }

  return {
    role: role ?? "sales",
    canEdit,
    canEditAdvisor,
    dataScope,
    contractScope,
    identity,
    user,
    canAccess,
  }
}

export function useCrmAccess() {
  return useRole()
}
