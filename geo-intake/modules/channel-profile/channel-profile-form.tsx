"use client"

import { useRef, useState } from "react"
import { CheckCircle2, Handshake, Loader2, Send } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Field, SectionCard } from "@/modules/intake/components/form-bits"

const industries = ["工业制造", "科技互联网", "消费零售", "医疗健康", "金融", "教育", "地产建筑", "文旅餐饮", "农林牧渔", "政府与公共事业"]
const types = [{ value: "个人", hint: "个人资源推荐、个人合作" }, { value: "分销", hint: "通过分销方式开展业务合作" }, { value: "渠道", hint: "具备渠道资源和业务合作能力" }, { value: "生态", hint: "通过生态合作拓展业务" }]
const initial = { companyName: "", contactName: "", contactPhone: "", contactTitle: "", city: "", industry: "", channelType: "", signingMethod: "" }
type Values = typeof initial
const phoneRE = /^(?:1[3-9]\d{9}|0\d{9,11}|\+\d{7,15})(?:转\d{1,6})?$/

// getRandomValues also works on the existing HTTP LAN deployment.
function makeSubmissionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function ChannelProfileForm() {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Partial<Values>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const requestKey = useRef("")
  const inFlight = useRef(false)
  const lastPayload = useRef("")
  const complete = Object.values(values).filter((v) => v.trim()).length
  const selection = types.find((t) => t.value === values.channelType)

  function set(key: keyof Values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: "" }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const next: Partial<Values> = {}
    for (const key of Object.keys(values) as Array<keyof Values>) if (!values[key].trim()) next[key] = "请填写此项"
    if (values.contactPhone.trim() && !phoneRE.test(values.contactPhone.replace(/[\s()（）-]/g, ""))) next.contactPhone = "请输入有效手机号或带区号的联系电话"
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(`channel-${Object.keys(next)[0]}`)?.focus()
      return
    }
    inFlight.current = true
    setBusy(true); setError("")
    const payload = JSON.stringify(values)
    if (!requestKey.current || lastPayload.current !== payload) {
      requestKey.current = makeSubmissionKey()
      lastPayload.current = payload
    }
    try {
      const response = await fetch("/api/channel-intake/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, submissionKey: requestKey.current }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = body.error || body.detail
        throw new Error(typeof detail === "string" ? detail : response.status === 429 ? "提交过于频繁，请稍后重试" : "提交失败，请稍后重试")
      }
      setDone(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "网络连接失败，请稍后重试") }
    finally { setBusy(false); inFlight.current = false }
  }

  if (done) return <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center px-5 py-12 text-center" role="status">
    <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-primary/10"><CheckCircle2 className="size-10 text-primary" /></div>
    <h1 className="text-2xl font-semibold">提交成功</h1><p className="mt-3 text-sm text-muted-foreground">提交成功，我们会尽快与您联系</p>
    <p className="mt-2 text-xs text-muted-foreground">您的渠道合作资料已收到，无需重复提交。</p>
  </main>

  const textField = (key: keyof Values, label: string, placeholder: string, maxLength: number, tel = false) => <Field label={label} required error={errors[key]}>
    <Input id={`channel-${key}`} aria-label={label} aria-required="true" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `error-${key}` : undefined} inputMode={tel ? "tel" : "text"} autoComplete={key === "companyName" ? "organization" : key === "contactName" ? "name" : tel ? "tel" : key === "contactTitle" ? "organization-title" : "address-level2"} maxLength={maxLength} placeholder={placeholder} value={values[key]} onChange={(e) => set(key, e.target.value)} />
    {errors[key] && <span id={`error-${key}`} className="sr-only">{errors[key]}</span>}
  </Field>

  return <div>
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur"><div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-5 px-5">
      <div><h1 className="text-base font-semibold tracking-tight">渠道资料单</h1><p className="hidden text-xs text-muted-foreground sm:block">渠道合作资料收集</p></div>
      <div className="flex w-32 items-center gap-3" aria-label={`已填写 ${complete} 项，共 8 项`}><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${complete / 8 * 100}%` }} /></div><span className="text-xs text-muted-foreground">{complete}/8</span></div>
    </div></header>
    <main className="mx-auto max-w-3xl px-5 py-8 md:py-10">
      <div className="mb-7 rounded-2xl border border-border bg-card p-5 md:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"><Handshake className="size-3.5" />渠道合作</span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">渠道资料单</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">欢迎填写渠道合作资料，我们将尽快与您联系。<br />带 <span className="text-destructive">*</span> 为必填项。</p>
      </div>
      <form className="space-y-6" onSubmit={submit} noValidate>
        <SectionCard step="一" title="公司与联系人" desc="请填写公司完整名称及主要联系人的信息。">
          {textField("companyName", "公司名称", "请输入公司完整名称", 255)}
          <div className="grid gap-5 sm:grid-cols-2">{textField("contactName", "联系人", "请输入联系人姓名", 128)}{textField("contactTitle", "职位", "请输入职位", 128)}</div>
          <div className="grid gap-5 sm:grid-cols-2">{textField("contactPhone", "联系方式", "手机号或带区号的联系电话", 64, true)}{textField("city", "城市", "请输入所在城市", 128)}</div>
        </SectionCard>
        <SectionCard step="二" title="合作意向" desc="了解您所在的行业与期望的合作方式。">
          <Field label="行业" required error={errors.industry}><select id="channel-industry" aria-label="行业" aria-required="true" aria-invalid={!!errors.industry} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={values.industry} onChange={(e) => set("industry", e.target.value)}><option value="">请选择所属行业</option>{industries.map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="渠道类型" required hint={selection?.hint} error={errors.channelType}><select id="channel-channelType" aria-label="渠道类型" aria-required="true" aria-invalid={!!errors.channelType} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={values.channelType} onChange={(e) => set("channelType", e.target.value)}><option value="">请选择渠道类型</option>{types.map((item) => <option key={item.value} value={item.value}>{item.value} · {item.hint}</option>)}</select></Field>
          <Field label="签约方式" required hint={values.signingMethod === "直销" ? "我方直接与客户签署合同" : values.signingMethod === "渠道代理" ? "按渠道代理合作方式签署协议" : undefined} error={errors.signingMethod}><select id="channel-signingMethod" aria-label="签约方式" aria-required="true" aria-invalid={!!errors.signingMethod} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={values.signingMethod} onChange={(e) => set("signingMethod", e.target.value)}><option value="">请选择签约方式</option><option>直销</option><option>渠道代理</option></select></Field>
        </SectionCard>
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{busy ? "正在提交…" : "提交资料"}</Button>
      </form>
    </main>
  </div>
}
