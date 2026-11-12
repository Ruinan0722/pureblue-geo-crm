"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { useSalesNames } from "@/modules/crm/hooks/use-directory-options"
import { batchAssignCustomerOwner } from "@/modules/crm/services/crm-api"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  customerIds: string[]
  onSuccess: (owner: string, succeededIds: string[]) => void
}

export function BatchAssignOwnerDialog({ open, onOpenChange, customerIds, onSuccess }: Props) {
  const [owner, setOwner] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { names: salesOptions } = useSalesNames(owner ? [owner] : [])

  async function handleConfirm() {
    const name = owner.trim()
    if (!name) {
      toast.error("请选择销售负责人")
      return
    }
    if (customerIds.length === 0) {
      toast.error("请至少选择一个客户")
      return
    }
    setSubmitting(true)
    try {
      const result = await batchAssignCustomerOwner(customerIds, name)
      const ok = result.succeeded?.length ?? 0
      const fail = result.failed?.length ?? 0
      const succeededIds = (result.succeeded ?? [])
        .map((item) => item.customerId || (item as { customer_id?: string }).customer_id || "")
        .filter(Boolean)
      if (ok > 0) {
        onSuccess(result.owner, succeededIds)
      }
      if (fail === 0) {
        toast.success(`已将 ${ok} 个客户分配给「${result.owner}」`)
        onOpenChange(false)
        setOwner("")
      } else if (ok === 0) {
        const reason = result.failed?.[0]?.reason || "分配失败"
        toast.error(`全部失败：${reason}`)
      } else {
        const sample = (result.failed ?? [])
          .slice(0, 3)
          .map((item) => {
            const nameHint = item.companyName || (item as { company_name?: string }).company_name
            const reason = item.reason || item.customerId || (item as { customer_id?: string }).customer_id
            return nameHint ? `${nameHint}：${reason}` : reason
          })
          .join("；")
        toast.warning(`成功 ${ok} 个，失败 ${fail} 个。${sample}${fail > 3 ? "…" : ""}`)
        onOpenChange(false)
        setOwner("")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量分配负责人失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
        if (!next) setOwner("")
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量分配负责人</DialogTitle>
          <DialogDescription>
            将已选的 {customerIds.length} 个客户统一指定给同一位销售。仅对您有权限查看的客户生效。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-sm font-medium">销售负责人</label>
          <SearchableSelect
            value={owner}
            onChange={setOwner}
            options={toSelectOptions(salesOptions)}
            placeholder="选择或搜索销售"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" disabled={submitting || !owner.trim()} onClick={() => void handleConfirm()}>
            {submitting ? "分配中…" : "确认分配"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
