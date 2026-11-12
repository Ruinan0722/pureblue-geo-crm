"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { useCrm } from "@/modules/crm/context/crm-provider"
import { CONTRACT_SOURCES, CONTRACT_TYPES, SIGN_TYPES } from "@/modules/crm/lib/crm-data"
import { MemberPicker } from "@/modules/crm/components/member-picker"
import { useSalesNames } from "@/modules/crm/hooks/use-directory-options"
import { fetchDirectManagerByName } from "@/modules/crm/services/crm-directory"
import { SearchableSelect, toSelectOptions } from "@/shared/ui/searchable-select"
import { useFormDraft } from "@/shared/hooks/use-form-draft"

type ContractFormState = {
  name: string
  customerId: string
  opportunityId: string
  type: string
  signType: string
  source: string
  owners: string[]
  signer: string
  signerContactName: string
  signerContactPhone: string
  signerContactAddress: string
  signerContactEmail: string
  invoiceInfo: string
  signerManager: string
  dept: string
  amount: string
}

/** 新增合同（支持锁定客户、绑定商机） */
export function NewContractDialog({
  open,
  onOpenChange,
  defaultCustomerId,
  defaultOpportunityId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultCustomerId?: string
  defaultOpportunityId?: string
  onCreated?: (contractId: string) => void
}) {
  const router = useRouter()
  const { customers, opportunities, createContract } = useCrm()
  const lockedCustomer = Boolean(defaultCustomerId)
  const draftKey = `crm:create-contract:${defaultCustomerId || "new"}:${defaultOpportunityId || "none"}`
  const [form, setForm] = useState<ContractFormState>({
    name: "",
    customerId: defaultCustomerId || "",
    opportunityId: defaultOpportunityId || "",
    type: CONTRACT_TYPES[0] as string,
    signType: SIGN_TYPES[0] as string,
    source: "",
    owners: [] as string[],
    signer: "",
    signerContactName: "",
    signerContactPhone: "",
    signerContactAddress: "",
    signerContactEmail: "",
    invoiceInfo: "",
    signerManager: "",
    dept: "",
    amount: "",
  })
  const [managerLoading, setManagerLoading] = useState(false)
  const { names: salesOptions } = useSalesNames([form.signer, ...form.owners].filter(Boolean))
  const { clearDraft } = useFormDraft({
    key: draftKey,
    schemaVersion: 1,
    open,
    value: form,
    onRestore: (data) =>
      setForm({
        ...data,
        customerId: defaultCustomerId || data.customerId,
        opportunityId: defaultOpportunityId || data.opportunityId,
      }),
    shouldPersist: (f) =>
      Boolean(f.name.trim() || f.customerId || f.signer.trim() || f.amount.trim() || f.owners.length),
  })
  const signerOptions = useMemo(() => {
    const set = new Set(salesOptions)
    if (form.signer) set.add(form.signer)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [salesOptions, form.signer])

  const customerOpps = useMemo(() => {
    const cid = form.customerId
    if (!cid) return []
    return opportunities
      .filter((o) => o.customerId === cid && o.stage !== "lost")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  }, [opportunities, form.customerId])

  async function applySigner(signer: string) {
    const name = signer.trim()
    if (!name) {
      setForm((prev) => ({ ...prev, signer: "", signerManager: "" }))
      return
    }
    setForm((prev) => ({ ...prev, signer: name }))
    setManagerLoading(true)
    try {
      const result = await fetchDirectManagerByName(name)
      setForm((prev) => ({
        ...prev,
        signer: name,
        signerManager: result.managerName || "",
      }))
      if (!result.managerName && result.message) {
        toast.message(result.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "查询直属上级失败，请手动填写")
    } finally {
      setManagerLoading(false)
    }
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.error("请填写合同名称")
      return
    }
    if (!form.customerId) {
      toast.error("请选择关联客户")
      return
    }
    const cust = customers.find((c) => c.id === form.customerId)
    const id = await createContract({
      name: form.name.trim(),
      customerId: form.customerId,
      company: cust?.companyName,
      region: cust?.region,
      city: cust?.city,
      type: form.type,
      signType: form.signType,
      source: form.source || undefined,
      owner: form.owners[0] || cust?.owner || "",
      owners: form.owners.length ? form.owners : cust?.owner ? [cust.owner] : [],
      signer: form.signer.trim(),
      signerContactName: form.signerContactName.trim(),
      signerContactPhone: form.signerContactPhone.trim(),
      signerContactAddress: form.signerContactAddress.trim(),
      signerContactEmail: form.signerContactEmail.trim(),
      invoiceInfo: form.invoiceInfo.trim(),
      signerManager: form.signerManager.trim(),
      dept: form.dept.trim(),
      amount: Number(form.amount) || 0,
      opportunityId: form.opportunityId || "",
    })
    onOpenChange(false)
    clearDraft()
    toast.success("合同已创建")
    if (onCreated) onCreated(id)
    else router.push(`/contracts/${id}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增合同</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同名称</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如：Anker 品牌 GEO 优化服务合同"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">关联客户</label>
            <SearchableSelect
              value={form.customerId}
              onChange={(customerId) =>
                setForm({
                  ...form,
                  customerId,
                  opportunityId:
                    form.opportunityId &&
                    opportunities.some((o) => o.id === form.opportunityId && o.customerId === customerId)
                      ? form.opportunityId
                      : "",
                })
              }
              options={customers.map((c) => ({
                value: c.id,
                label: c.brandName || c.companyName,
              }))}
              placeholder="请选择或搜索客户"
              disabled={lockedCustomer}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">关联商机（可选）</label>
            <SearchableSelect
              value={form.opportunityId || "__none__"}
              onChange={(v) => setForm({ ...form, opportunityId: !v || v === "__none__" ? "" : v })}
              options={[
                { value: "__none__", label: "暂不绑定" },
                ...customerOpps.map((o) => ({ value: o.id, label: o.name })),
              ]}
              placeholder={form.customerId ? "选择该客户下的商机" : "请先选择客户"}
              disabled={!form.customerId}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">合同需与商机绑定，便于签约与项目移交。</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">合同类型</label>
              <SearchableSelect
                value={form.type}
                onChange={(type) => setForm({ ...form, type })}
                options={toSelectOptions(CONTRACT_TYPES)}
                placeholder="选择合同类型"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">签约类型</label>
              <SearchableSelect
                value={form.signType}
                onChange={(signType) => setForm({ ...form, signType })}
                options={toSelectOptions(SIGN_TYPES)}
                placeholder="选择签约类型"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同来源</label>
            <SearchableSelect
              value={form.source}
              onChange={(source) => setForm({ ...form, source })}
              options={toSelectOptions(CONTRACT_SOURCES)}
              placeholder="选择合同来源"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同签订人</label>
            <SearchableSelect
              value={form.signer}
              onChange={(v) => void applySigner(v)}
              options={toSelectOptions(signerOptions)}
              placeholder="选择签订人"
            />
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="mb-3 text-xs font-medium text-foreground">联系人信息</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs text-muted-foreground">姓名</label><Input value={form.signerContactName} onChange={(e) => setForm({ ...form, signerContactName: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">电话</label><Input value={form.signerContactPhone} onChange={(e) => setForm({ ...form, signerContactPhone: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">地址</label><Input value={form.signerContactAddress} onChange={(e) => setForm({ ...form, signerContactAddress: e.target.value })} /></div>
              <div><label className="mb-1 block text-xs text-muted-foreground">邮箱</label><Input type="email" value={form.signerContactEmail} onChange={(e) => setForm({ ...form, signerContactEmail: e.target.value })} /></div>
            </div>
            <div className="mt-3"><label className="mb-1 block text-xs text-muted-foreground">开票信息</label><Input value={form.invoiceInfo} onChange={(e) => setForm({ ...form, invoiceInfo: e.target.value })} placeholder="抬头、税号、开户地址电话、开户行账号等" /></div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              直属上级{managerLoading ? "（查询中…）" : "（随签订人自动带入，可改）"}
            </label>
            <Input
              value={form.signerManager}
              onChange={(e) => setForm({ ...form, signerManager: e.target.value })}
              placeholder={managerLoading ? "正在查询直属上级…" : "选择签订人后自动带入"}
              disabled={managerLoading}
            />
          </div>
          <div>
            <MemberPicker
              value={form.owners}
              onChange={(owners) => setForm({ ...form, owners })}
              options={salesOptions}
              label="销售负责人（可多选）"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">签约部门</label>
            <Input
              value={form.dept}
              onChange={(e) => setForm({ ...form, dept: e.target.value })}
              placeholder="选填"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">合同金额（元）</label>
            <Input
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, "") })}
              placeholder="选填，可在签署时填写"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()}>创建合同</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
