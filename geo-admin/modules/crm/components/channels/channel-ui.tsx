"use client"

import { createContext, useContext, useId, useRef, useState, type ReactNode, type RefObject } from "react"
import { AlertCircle, Check, ChevronDown, Handshake, Loader2, X } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog"
import { cn } from "@/shared/lib/utils"
import { CHANNEL_OPPORTUNITY_STAGES } from "@/modules/crm/lib/crm-data"

export const ChannelReturnFocusContext = createContext<RefObject<HTMLElement | null> | undefined>(undefined)

export function ChannelBadge({ value, kind = "level" }: { value?: string | null; kind?: "level" | "contract" | "stage" }) {
  const positive = kind === "contract" ? value === "是" : kind === "stage" ? value === "赢单" : value === "重点合作"
  const muted = !value || ["否", "暂不考虑", "输单", "黑名单"].includes(value)
  const label = kind === "contract" ? value === "是" ? "已签约" : value === "否" ? "未签约" : value : value
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium", positive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : muted ? "bg-muted text-muted-foreground" : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300")}>
    <span className="size-1.5 rounded-full bg-current opacity-70" />{label || "未设置"}
  </span>
}

export function ChannelEmpty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
    <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border bg-muted/40 text-muted-foreground"><Handshake className="size-6" /></div>
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
}

export function ChannelError({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null
  return <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
    <AlertCircle className="mt-0.5 size-4 shrink-0" />
    <span className="min-w-0 flex-1 break-words">{message}</span>
    {retry && <button type="button" onClick={retry} className="shrink-0 font-medium underline underline-offset-4">重新加载</button>}
  </div>
}

export function ChannelLoading({ label = "正在加载…" }: { label?: string }) {
  return <div role="status" className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{label}</div>
}

export function Field({ label, children, required, hint }: { label: string; children: ReactNode; required?: boolean; hint?: string }) {
  return <label className="block min-w-0 space-y-2">
    <span className="block text-xs font-medium">{label}{required && <span className="ml-1 text-destructive">*</span>}</span>
    {children}
    {hint && <span className="block text-[11px] leading-5 text-muted-foreground">{hint}</span>}
  </label>
}

export function NativeSelect({ value, onChange, options, label, placeholder = "请选择", disabled, required }: {
  value: string; onChange: (value: string) => void; options: readonly string[] | { value: string; label: string }[]
  label: string; placeholder?: string; disabled?: boolean; required?: boolean
}) {
  return <div className="relative">
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}
      className="h-9 w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-8 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50">
      <option value="">{placeholder}</option>
      {options.map((item) => typeof item === "string" ? <option key={item} value={item}>{item}</option> : <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground" />
  </div>
}

export function ChannelModal({ open, onClose, title, description, children, footer, dirty = false, busy = false, wide = false }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer: ReactNode
  dirty?: boolean; busy?: boolean; wide?: boolean
}) {
  const [discard, setDiscard] = useState(false)
  const returnFocus = useContext(ChannelReturnFocusContext)
  const popupRef = useRef<HTMLDivElement>(null)
  function requestClose() {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent ref={popupRef} finalFocus={returnFocus ?? true} showCloseButton={false} className={cn("grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg", wide && "sm:max-w-2xl")}>
        <div className="relative border-b px-6 py-5 pr-14">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {description && <DialogDescription className="mt-2 text-xs leading-5">{description}</DialogDescription>}
          <Button type="button" variant="ghost" size="icon-sm" className="absolute right-4 top-4" aria-label="关闭弹窗" disabled={busy} onClick={requestClose}><X className="size-4" /></Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-6">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-6 py-4"><Button type="button" variant="outline" disabled={busy} onClick={requestClose}>取消</Button>{footer}</div>
      </DialogContent>
      <Dialog open={discard} onOpenChange={setDiscard}>
      <DialogContent finalFocus={popupRef}>
        <DialogTitle>放弃未保存的内容？</DialogTitle>
        <DialogDescription>关闭后，本次填写的内容将不会保存。</DialogDescription>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setDiscard(false)}>继续编辑</Button>
          <Button variant="destructive" onClick={() => { setDiscard(false); onClose() }}>放弃修改</Button>
        </div>
      </DialogContent>
      </Dialog>
    </Dialog>
  </>
}

export function SaveButton({ busy, form, label = "保存" }: { busy: boolean; form?: string; label?: string }) {
  return <Button type="submit" form={form} disabled={busy} className="min-w-24">{busy && <Loader2 className="size-3.5 animate-spin" />}{busy ? "正在保存…" : label}</Button>
}

export function StageProgress({ stage }: { stage: string }) {
  const current = CHANNEL_OPPORTUNITY_STAGES.findIndex((item) => item === stage)
  return <ol aria-label={"商机阶段：" + stage} className="mt-4 grid grid-cols-4 gap-1">
    {CHANNEL_OPPORTUNITY_STAGES.map((item, index) => <li key={item} className="min-w-0">
      <div className={cn("mb-2 h-1 rounded-full", current >= index ? "bg-primary" : "bg-muted")} />
      <span className={cn("flex items-center gap-1 text-[10px] sm:text-xs", current === index ? "font-medium text-primary" : "text-muted-foreground")}>
        {index < current && <Check className="hidden size-3 shrink-0 sm:block" />}{item}
      </span>
    </li>)}
  </ol>
}

export function displayDate(value?: string | null, withTime = false) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) })
}

export function useChannelFormId() {
  return "channel-form-" + useId().replace(/:/g, "")
}
