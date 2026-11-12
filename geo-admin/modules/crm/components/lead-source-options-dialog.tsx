"use client"

import { useEffect, useState } from "react"
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { DatePicker } from "@/shared/ui/date-picker"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table"
import {
  createLeadSourceOption,
  deleteLeadSourceOption,
  fetchLeadSourceOptions,
  updateLeadSourceOption,
  type LeadSourceOption,
} from "@/modules/crm/services/crm-api"

const PRIMARY_OPTIONS = ["三方会议", "自办会议", "机构引荐"].map((value) => ({ value, label: value }))
const FILTER_TYPE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "三方会议", label: "三方会议" },
  { value: "自办会议", label: "自办会议" },
  { value: "机构引荐", label: "机构引荐" },
] as const

function RequiredMark() {
  return <span className="text-destructive">*</span>
}

function TypeBadge({ type }: { type: string }) {
  const isThirdParty = type === "三方会议"
  const isInstitution = type === "机构引荐"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        isThirdParty
          ? "bg-primary/15 text-primary"
          : isInstitution
            ? "bg-amber-100 text-amber-700"
            : "bg-sky-100 text-sky-700",
      )}
    >
      {type}
    </span>
  )
}

function TypeSegmentedControl({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-muted/40 p-0.5">
      {FILTER_TYPE_OPTIONS.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value || "all"}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 rounded-md px-3 text-sm transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function LeadSourceOptionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<LeadSourceOption[]>([])
  const [primarySource, setPrimarySource] = useState("三方会议")
  const [startDate, setStartDate] = useState("")
  const [name, setName] = useState("")
  const [organizer, setOrganizer] = useState("")
  const [filterKeyword, setFilterKeyword] = useState("")
  const [filterPrimarySource, setFilterPrimarySource] = useState("")
  const [filterDate, setFilterDate] = useState("")
  const [editing, setEditing] = useState<LeadSourceOption | null>(null)
  const [editName, setEditName] = useState("")
  const [deleting, setDeleting] = useState<LeadSourceOption | null>(null)
  const [deletionReason, setDeletionReason] = useState("")
  const [loading, setLoading] = useState(false)

  async function reload(filters = {
    primarySource: filterPrimarySource,
    startDate: filterDate,
    keyword: filterKeyword,
  }) {
    setLoading(true)
    try {
      const rows = await fetchLeadSourceOptions({
        includeDisabled: true,
        primarySource: filters.primarySource || undefined,
        startDate: filters.startDate || undefined,
      })
      const keyword = filters.keyword.trim().toLowerCase()
      setItems(
        keyword
          ? rows.filter(
              (item) =>
                item.name.toLowerCase().includes(keyword) ||
                (item.organizer ?? "").toLowerCase().includes(keyword),
            )
          : rows,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载二级来源失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void reload()
  }, [open])

  function resetFilters() {
    setFilterKeyword("")
    setFilterPrimarySource("")
    setFilterDate("")
    void reload({ primarySource: "", startDate: "", keyword: "" })
  }

  async function addOption() {
    const isInstitution = primarySource === "机构引荐"
    if (!isInstitution && !startDate) return toast.error("请选择会议开始日期")
    if (!name.trim()) return toast.error(isInstitution ? "请输入机构名称" : "请输入会议名称")
    if (!isInstitution && !organizer.trim()) return toast.error("请输入会议主办方")
    setLoading(true)
    try {
      await createLeadSourceOption({
        primarySource,
        name: name.trim(),
        ...(isInstitution ? {} : { startDate, organizer: organizer.trim() }),
        sortOrder: items.length,
      })
      setStartDate("")
      setName("")
      setOrganizer("")
      await reload()
      toast.success("二级来源已新增，销售可在线索中选择")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增失败")
      setLoading(false)
    }
  }

  async function saveEdit() {
    if (!editing) return
    const nextName = editName.trim()
    if (!nextName) return toast.error("请输入二级来源名称")
    if (nextName === editing.name) {
      setEditing(null)
      return
    }
    setLoading(true)
    try {
      await updateLeadSourceOption(editing.id, { name: nextName })
      setEditing(null)
      setEditName("")
      await reload()
      toast.success("二级来源名称已更新")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败")
      setLoading(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    if (!deletionReason.trim()) return toast.error("请填写删除原因")
    setLoading(true)
    try {
      await deleteLeadSourceOption(deleting.id, deletionReason.trim())
      setDeleting(null)
      setDeletionReason("")
      await reload()
      toast.success("二级来源已删除")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
      setLoading(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(90vh,820px)] flex-col gap-4 sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>维护线索二级来源</DialogTitle>
          </DialogHeader>

          <section className="shrink-0 space-y-3 rounded-xl border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-medium">新增二级来源</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                会议类需填写日期与主办方；机构引荐只需填写机构名称，供 SDR 新增线索时勾选。
              </p>
            </div>
            <div
              className={cn(
                "grid items-end gap-3 sm:grid-cols-2",
                primarySource === "机构引荐"
                  ? "lg:grid-cols-[140px_minmax(0,1fr)_auto]"
                  : "lg:grid-cols-[140px_170px_minmax(0,1.2fr)_minmax(0,1fr)_auto]",
              )}
            >
              <div className="space-y-1.5">
                <Label className="gap-0.5 text-xs text-muted-foreground">
                  一级来源 <RequiredMark />
                </Label>
                <SearchableSelect
                  value={primarySource}
                  onChange={setPrimarySource}
                  options={PRIMARY_OPTIONS}
                  placeholder="一级来源"
                />
              </div>
              {primarySource !== "机构引荐" ? (
                <div className="space-y-1.5">
                  <Label className="gap-0.5 text-xs text-muted-foreground">
                    会议开始日期 <RequiredMark />
                  </Label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="年 / 月 / 日"
                    aria-label="会议开始日期"
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label className="gap-0.5 text-xs text-muted-foreground">
                  {primarySource === "机构引荐" ? "机构名称" : "会议名称"} <RequiredMark />
                </Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={primarySource === "机构引荐" ? "例如：某咨询机构" : "例如：2026 AI 营销增长大会"}
                  maxLength={128}
                  className="h-9"
                />
              </div>
              {primarySource !== "机构引荐" ? (
                <div className="space-y-1.5">
                  <Label className="gap-0.5 text-xs text-muted-foreground">
                    会议主办方 <RequiredMark />
                  </Label>
                  <Input
                    value={organizer}
                    onChange={(event) => setOrganizer(event.target.value)}
                    placeholder="例如：36氪"
                    maxLength={128}
                    className="h-9"
                  />
                </div>
              ) : null}
              <Button
                onClick={() => void addOption()}
                disabled={loading}
                className="h-9 gap-1.5 sm:col-span-2 lg:col-span-1"
              >
                <Plus className="size-4" />
                新增
              </Button>
            </div>
          </section>

          <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filterKeyword}
                onChange={(event) => setFilterKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void reload()
                }}
                placeholder="搜索名称 / 主办方"
                className="h-9 pl-9"
              />
            </div>
            {filterPrimarySource !== "机构引荐" ? (
              <DatePicker
                value={filterDate}
                onChange={setFilterDate}
                placeholder="年 / 月 / 日"
                aria-label="按会议日期筛选"
                className="w-full lg:w-[170px]"
              />
            ) : null}
            <TypeSegmentedControl
              value={filterPrimarySource}
              onChange={(value) => {
                setFilterPrimarySource(value)
                void reload({
                  primarySource: value,
                  startDate: filterDate,
                  keyword: filterKeyword,
                })
              }}
            />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={resetFilters} disabled={loading} className="h-9 px-3">
                重置
              </Button>
              <Button onClick={() => void reload()} disabled={loading} className="h-9 gap-1.5">
                <Search className="size-4" />
                查询
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
            {loading && items.length === 0 ? (
              <div className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载中…
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                没有符合条件的二级来源
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">一级来源</TableHead>
                    <TableHead className="px-4">二级来源名称</TableHead>
                    <TableHead className="px-4">主办方</TableHead>
                    <TableHead className="px-4">日期</TableHead>
                    <TableHead className="px-4 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="px-4 py-3">
                        <TypeBadge type={item.primarySource} />
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate px-4 py-3 font-medium">
                        {item.name}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                        {item.organizer || "—"}
                      </TableCell>
                      <TableCell className="px-4 py-3 tabular-nums text-muted-foreground">
                        {item.startDate || "—"}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loading}
                            onClick={() => {
                              setEditing(item)
                              setEditName(item.name)
                            }}
                            className="h-8 gap-1.5 text-primary hover:text-primary"
                          >
                            <Pencil className="size-3.5" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loading}
                            onClick={() => {
                              setDeleting(item)
                              setDeletionReason("")
                            }}
                            className="h-8 gap-1.5 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(next) => {
          if (!next) {
            setEditing(null)
            setEditName("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑二级来源名称</DialogTitle>
            <DialogDescription>
              仅修改当前这条记录的二级来源名称，一级来源与其它字段不会变化。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-meeting-name">二级来源名称</Label>
            <Input
              id="edit-meeting-name"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              maxLength={128}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveEdit()
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null)
                setEditName("")
              }}
            >
              取消
            </Button>
            <Button onClick={() => void saveEdit()} disabled={loading}>
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null)
            setDeletionReason("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除会议来源</DialogTitle>
            <DialogDescription>
              删除后销售将无法再选择该会议。请填写删除原因以便审计留痕。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-meeting-reason">
              删除原因 <RequiredMark />
            </Label>
            <Input
              id="delete-meeting-reason"
              value={deletionReason}
              onChange={(event) => setDeletionReason(event.target.value)}
              placeholder="请填写删除原因"
              maxLength={500}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void confirmDelete()
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleting(null)
                setDeletionReason("")
              }}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={loading}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
