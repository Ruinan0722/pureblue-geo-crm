"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, ChevronUp, Crown, History, LockKeyhole, Plus, Search, ShieldCheck, Trash2, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Checkbox } from "@/shared/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Input } from "@/shared/ui/input"
import {
  TEAM_ROLE_OPTIONS,
  teamPermissionLabel,
  type TeamCollaborationState,
  type TeamEntityType,
  type TeamMemberRole,
  type TeamPermission,
} from "@/modules/crm/lib/team-collaboration"
import {
  createNotifications,
  fetchStaffDirectoryMembers,
  type DirectoryMember,
  type MentionScope,
} from "@/modules/crm/services/crm-directory"
import {
  addTeamCollaborationMembers,
  fetchTeamCollaboration,
  removeTeamCollaborationMember,
  updateTeamCollaborationPermission,
} from "@/modules/crm/services/team-collaboration"

type Props = {
  entityType: TeamEntityType
  entityId: string
  entityName: string
  ownerName: string
  ownerDepartment?: string
  ownerRoleLabel?: string
  canManage: boolean
  currentUserName: string
}

const permissionStyles: Record<TeamPermission, string> = {
  edit: "border-blue-200 bg-blue-50 text-blue-700",
  read: "border-slate-200 bg-slate-50 text-slate-600",
}

const roleStyles: Record<TeamMemberRole, string> = {
  销售: "bg-sky-50 text-sky-700",
  解决方案: "bg-violet-50 text-violet-700",
  客户成功: "bg-emerald-50 text-emerald-700",
  管理者: "bg-amber-50 text-amber-700",
  其他协作: "bg-slate-100 text-slate-600",
}

function entityLabel(entityType: TeamEntityType) {
  return entityType === "customer" ? "客户" : "商机"
}

function departmentFallback(member: DirectoryMember) {
  const fromDirectory = member.departmentNames?.filter(Boolean).join(" / ")
  if (fromDirectory) return fromDirectory
  const role = String(member.role || "")
  if (/solution|presale|advisor|方案|售前/i.test(role)) return "解决方案部"
  if (/success|delivery|客户成功|交付/i.test(role)) return "客户成功部"
  if (/sales|销售/i.test(role)) return "销售部"
  return "未标注部门"
}

function Avatar({ name, owner = false }: { name: string; owner?: boolean }) {
  return (
    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${owner ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
      {(name || "未").slice(-2)}
    </div>
  )
}

export function TeamCollaborationCard({
  entityType,
  entityId,
  entityName,
  ownerName,
  ownerDepartment = "销售部",
  ownerRoleLabel = "负责人",
  canManage,
  currentUserName,
}: Props) {
  const [state, setState] = useState<TeamCollaborationState>({ members: [], activities: [] })
  const [teamLoading, setTeamLoading] = useState(true)
  const [directory, setDirectory] = useState<DirectoryMember[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [selectedRole, setSelectedRole] = useState<TeamMemberRole>("其他协作")
  const [selectedPermission, setSelectedPermission] = useState<TeamPermission>("read")
  const [activityOpen, setActivityOpen] = useState(false)

  useEffect(() => {
    let active = true
    setTeamLoading(true)
    void fetchTeamCollaboration(entityType, entityId)
      .then((payload) => {
        if (active) setState(payload)
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "加载协作团队失败")
      })
      .finally(() => {
        if (active) setTeamLoading(false)
      })
    return () => {
      active = false
    }
  }, [entityId, entityType])

  useEffect(() => {
    let active = true
    setDirectoryLoading(true)
    // 团队协作是跨部门选人，不按 @提及范围过滤；开发环境成员也应出现在候选列表。
    void fetchStaffDirectoryMembers()
      .then((members) => {
        if (active) setDirectory(members)
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "加载成员通讯录失败")
      })
      .finally(() => {
        if (active) setDirectoryLoading(false)
      })
    return () => {
      active = false
    }
  }, [entityId, entityType])

  const availableMembers = useMemo(() => {
    const occupied = new Set([ownerName, ...state.members.map((item) => item.name)].filter(Boolean))
    const keyword = search.trim().toLowerCase()
    return directory.filter((member) => {
      if (!member.name || occupied.has(member.name)) return false
      if (!keyword) return true
      return `${member.name} ${member.departmentNames?.join(" ") || ""}`.toLowerCase().includes(keyword)
    })
  }, [directory, ownerName, search, state.members])

  async function notify(targetName: string, message: string) {
    if (!targetName || targetName === currentUserName) return
    const scope: MentionScope = entityType === "customer" ? "customers" : "opportunities"
    const href = entityType === "customer" ? `/customers/${entityId}` : `/opportunities/${entityId}`
    try {
      await createNotifications([{ targetName, message, href }], scope)
    } catch {
      toast.warning("成员已更新，但站内通知发送失败")
    }
  }

  function toggleSelection(name: string, checked: boolean) {
    setSelectedNames((current) => checked ? [...new Set([...current, name])] : current.filter((item) => item !== name))
  }

  async function handleAdd() {
    if (!selectedNames.length) {
      toast.error("请至少选择一位协作成员")
      return
    }
    const selectedMembers = selectedNames.map((name) => {
      const directoryMember = directory.find((item) => item.name === name)
      return {
        userId: directoryMember?.id || "",
        name,
        role: selectedRole,
        permission: selectedPermission,
      }
    })
    try {
      const next = await addTeamCollaborationMembers(
        entityType,
        entityId,
        selectedMembers.map(({ userId, role, permission }) => ({ userId, role, permission })),
      )
      setState(next)
      setOpen(false)
      setSelectedNames([])
      setSearch("")
      toast.success(`已添加 ${selectedMembers.length} 位协作成员`)
      await Promise.all(selectedMembers.map((member) => notify(
        member.name,
        `你已加入${entityLabel(entityType)}「${entityName}」团队，角色：${member.role}，权限：${teamPermissionLabel(member.permission)}`,
      )))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加协作成员失败")
    }
  }

  async function handlePermission(memberId: string, permission: TeamPermission) {
    const member = state.members.find((item) => item.id === memberId)
    if (!member || member.permission === permission) return
    try {
      const next = await updateTeamCollaborationPermission(entityType, entityId, memberId, permission)
      setState(next)
      toast.success(`已将 ${member.name} 调整为${teamPermissionLabel(permission)}`)
      await notify(member.name, `你在${entityLabel(entityType)}「${entityName}」中的权限已调整为${teamPermissionLabel(permission)}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "调整成员权限失败")
    }
  }

  async function handleRemove(memberId: string) {
    const member = state.members.find((item) => item.id === memberId)
    if (!member) return
    try {
      const next = await removeTeamCollaborationMember(entityType, entityId, memberId)
      setState(next)
      toast.success(`已将 ${member.name} 移出团队`)
      await notify(member.name, `你已被移出${entityLabel(entityType)}「${entityName}」团队，相关访问权限已收回`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移除协作成员失败")
    }
  }

  const total = state.members.length + (ownerName ? 1 : 0)

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600"><UsersRound className="h-4 w-4" /></span>
              <h3 className="font-semibold text-slate-900">{entityLabel(entityType)}团队成员</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{total} 人</span>
            </div>
            <p className="mt-1 pl-10 text-xs text-slate-500">共同查看和推进该{entityLabel(entityType)}，权限由负责人统一管理</p>
          </div>
          {canManage ? (
            <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />添加成员
            </Button>
          ) : null}
        </div>

        <div className="divide-y divide-slate-100 px-5">
          {ownerName ? (
            <div className="flex items-center gap-3 py-4">
              <Avatar name={ownerName} owner />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{ownerName}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"><Crown className="h-3 w-3" />{ownerRoleLabel}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{ownerDepartment}</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"><ShieldCheck className="h-3.5 w-3.5" />管理权限</span>
            </div>
          ) : null}

          {state.members.map((member) => (
            <div key={member.id} className="group flex items-center gap-3 py-3.5">
              <Avatar name={member.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{member.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleStyles[member.role]}`}>{member.role}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{member.department}</p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`调整 ${member.name} 的权限`}
                    className={`h-8 rounded-lg border px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-100 ${permissionStyles[member.permission]}`}
                    value={member.permission}
                    onChange={(event) => void handlePermission(member.id, event.target.value as TeamPermission)}
                  >
                    <option value="read">只读</option>
                    <option value="edit">可编辑</option>
                  </select>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    aria-label={`移除 ${member.name}`}
                    onClick={() => void handleRemove(member.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${permissionStyles[member.permission]}`}>
                  {member.permission === "read" ? <LockKeyhole className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {teamPermissionLabel(member.permission)}
                </span>
              )}
            </div>
          ))}

          {teamLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">正在加载团队成员…</p>
          ) : null}

          {!teamLoading && !state.members.length ? (
            <div className="py-6 text-center">
              <UsersRound className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">暂未添加协作成员</p>
              {canManage ? <p className="mt-1 text-xs text-slate-400">可邀请售前、客户成功或管理者共同跟进</p> : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
            <span><strong className="text-slate-700">只读：</strong>查看资料、跟进、动态与附件</span>
            <span><strong className="text-slate-700">可编辑：</strong>可新增跟进、更新资料与附件</span>
          </div>
          {state.activities.length ? (
            <div className="mt-3 border-t border-slate-200 pt-2.5">
              <button type="button" className="flex w-full items-center justify-between text-xs font-medium text-slate-600" onClick={() => setActivityOpen((value) => !value)}>
                <span className="inline-flex items-center gap-1.5"><History className="h-3.5 w-3.5" />最近变更记录（{state.activities.length}）</span>
                {activityOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {activityOpen ? (
                <div className="mt-2 space-y-2">
                  {state.activities.slice(0, 5).map((activity) => (
                    <div key={activity.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      <p><span className="font-medium text-slate-700">{activity.operator}</span> · {activity.memberName} · {activity.detail}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{activity.createdAt}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setSelectedNames([])
          setSearch("")
        }
      }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>添加{entityLabel(entityType)}协作成员</DialogTitle>
            <DialogDescription>支持多选。选择团队角色和访问权限后，成员会立即收到站内通知。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="搜索姓名或部门" />
            </div>

            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
              {directoryLoading ? <p className="px-4 py-8 text-center text-sm text-slate-500">正在加载组织通讯录…</p> : null}
              {!directoryLoading && !availableMembers.length ? <p className="px-4 py-8 text-center text-sm text-slate-500">没有可添加的成员</p> : null}
              {availableMembers.map((member) => {
                const checked = selectedNames.includes(member.name)
                return (
                  <label key={member.id || member.name} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50">
                    <Checkbox checked={checked} onCheckedChange={(value) => toggleSelection(member.name, Boolean(value))} />
                    <Avatar name={member.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800">{member.name}</span>
                      <span className="block truncate text-xs text-slate-500">{departmentFallback(member)}</span>
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">团队角色</span>
                <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as TeamMemberRole)}>
                  {TEAM_ROLE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">访问权限</span>
                <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={selectedPermission} onChange={(event) => setSelectedPermission(event.target.value as TeamPermission)}>
                  <option value="read">只读 — 仅查看</option>
                  <option value="edit">可编辑 — 可新增和更新</option>
                </select>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={!selectedNames.length} onClick={() => void handleAdd()}>确认添加{selectedNames.length ? `（${selectedNames.length}）` : ""}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
