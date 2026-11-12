"use client"
import { useRef, useState } from "react"
import Link from "next/link"
import { MessageSquarePlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { SearchableSelect } from "@/shared/ui/searchable-select"
import { DatePicker } from "@/shared/ui/date-picker"
import { chinaDateISO } from "@/shared/lib/datetime"
import { Pill } from "./ui"
import { MentionTextarea } from "./member-picker"
import { FollowUpComposer, FollowUpRecords } from "./follow-up-panel"
import { FOLLOW_TYPE_OPTIONS, coerceFollowType, followTypeLabel, type FollowType } from "../lib/crm-data"
export type UnifiedCustomerFollowUp = {
  id: string
  source: "customer" | "opportunity"
  author: string
  content: string
  date: string
  followType?: FollowType
  nextFollowAt?: string
  contactName?: string
  coverageOwner?: string
  fromLead?: boolean
  opportunityId?: string
  opportunityName?: string
  stageLabel?: string
  sourceLabel: "客户跟进" | "商机跟进" | "售前反馈"
}
export type CustomerFollowUpInput = { content: string; followType: FollowType; contactId: string; contactName: string; nextFollowAt: string; mentions: string[] }
export function CustomerFollowUpTab({ unifiedFollowUps, canAddFollow, followContacts, nextFollowAt, staffNames, onSave }: {
  unifiedFollowUps: UnifiedCustomerFollowUp[]; canAddFollow: boolean; followContacts: { id: string; name: string }[];
  nextFollowAt?: string | null; staffNames: string[]; onSave: (input: CustomerFollowUpInput) => Promise<void>
}) {
  const [followFilter, setFollowFilter] = useState<"all" | "customer" | "opportunity">("all")
  const [note, setNote] = useState("")
  const [noteFollowType, setNoteFollowType] = useState<FollowType | "">("")
  const [noteContactId, setNoteContactId] = useState("")
  const [noteNextFollowAt, setNoteNextFollowAt] = useState("")
  const [mentions, setMentions] = useState<string[]>([])
  const saving = useRef(false)
  const localToday = chinaDateISO
  const customerFollowUps = unifiedFollowUps.filter((item) => item.source === "customer")
  const opportunityFollowUps = unifiedFollowUps.filter((item) => item.source === "opportunity")
  const visibleFollowUps = followFilter === "all" ? unifiedFollowUps : followFilter === "customer" ? customerFollowUps : opportunityFollowUps
  async function submitNote() {
    if (saving.current) return
    if (!note.trim()) { toast.error("请输入跟进内容"); return }
    if (!noteFollowType) { toast.error("请选择跟进方式"); return }
    const contact = followContacts.find((item) => item.id === noteContactId)
    if (!contact) { toast.error("请选择本次跟进的联系人"); return }
    const planned = noteNextFollowAt.slice(0, 10)
    if (planned && planned < localToday()) { toast.error("下次计划跟进不能早于今天"); return }
    saving.current = true
    try {
      await onSave({ content: note.trim(), followType: noteFollowType, contactId: contact.id, contactName: contact.name, nextFollowAt: planned, mentions })
      setNote(""); setMentions([]); setNoteFollowType(""); setNoteContactId(""); setNoteNextFollowAt("")
      toast.success(planned ? `跟进已记录，已安排下次跟进 ${planned}` : nextFollowAt ? "跟进已记录，原下次跟进计划已清除" : "跟进记录已添加")
    } catch (error) { toast.error(error instanceof Error ? error.message : "保存失败，填写内容已保留") }
    finally { saving.current = false }
  }
  return (
           <div className="rounded-2xl border border-border bg-card p-5">
             <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
               <div className="flex items-start gap-3">
                 <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                   <MessageSquarePlus className="size-4" />
                 </div>
                 <div>
                 <h2 className="text-sm font-semibold tracking-tight">统一客户跟进时间线</h2>
                 <p className="mt-1 text-xs leading-5 text-muted-foreground">
                   按时间倒序汇总客户与关联商机的全部沟通记录，不再需要在两个区域之间切换查找。
                 </p>
                 </div>
               </div>
               <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-muted/40 p-1" aria-label="跟进记录筛选">
                 {([
                   { value: "all" as const, label: "全部", count: unifiedFollowUps.length },
                   { value: "customer" as const, label: "客户跟进", count: customerFollowUps.length },
                   { value: "opportunity" as const, label: "商机跟进", count: opportunityFollowUps.length },
                 ]).map((item) => (
                   <Button
                     key={item.value}
                     type="button"
                     size="sm"
                     variant={followFilter === item.value ? "default" : "ghost"}
                     className="h-8 gap-1.5 px-2.5 text-xs"
                     onClick={() => setFollowFilter(item.value)}
                   >
                     {item.label}
                     <span className="tabular-nums opacity-70">{item.count}</span>
                   </Button>
                 ))}
               </div>
             </div>
             {canAddFollow && (
               <div className="mt-5 border-t border-border/70 pt-5">
                 <div className="mb-3 flex items-center justify-between gap-2">
                   <div>
                     <p className="text-sm font-semibold">新增客户跟进</p>
                     <p className="mt-0.5 text-xs text-muted-foreground">记录本次沟通结果，并安排下一次跟进。</p>
                   </div>
                   <Pill label="客户跟进" tone="neutral" />
                 </div>
                <FollowUpComposer
                footerLeft={
                  nextFollowAt ? (
                    <Pill label={`计划 ${nextFollowAt.slice(0, 10)}`} tone="warning" />
                  ) : null
                }
                footerRight={
                  <Button className="shrink-0 gap-1.5" onClick={() => void submitNote()}>
                    <MessageSquarePlus className="size-4" />
                    保存跟进
                  </Button>
                }
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">跟进方式 *</label>
                    <SearchableSelect
                      value={noteFollowType}
                      onChange={(v) => setNoteFollowType(coerceFollowType(v))}
                      options={FOLLOW_TYPE_OPTIONS}
                      placeholder="选择方式"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">联系人 *</label>
                    <SearchableSelect
                      value={noteContactId}
                      onChange={setNoteContactId}
                      options={followContacts.map((contact) => ({
                        value: contact.id,
                        // 职务作为联系人的独立字段展示，不在姓名尾部追加
                        label: contact.name,
                      }))}
                      placeholder={followContacts.length ? "选择联系人" : "暂无联系人"}
                      disabled={!followContacts.length}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">下次跟进</label>
                    <DatePicker
                      value={noteNextFollowAt}
                      min={localToday()}
                      onChange={(v) => {
                        const day = (v || "").slice(0, 10)
                        if (day && day < localToday()) {
                          toast.error("下次跟进不能早于今天")
                          return
                        }
                        setNoteNextFollowAt(day)
                      }}
                      placeholder="选择日期"
                    />
                  </div>
                </div>
                <MentionTextarea
                  rows={3}
                  placeholder="记录沟通结果、客户反馈和下一步动作；输入 @ 可提及成员"
                  value={note}
                  onChange={setNote}
                  onMentionsChange={setMentions}
                  options={staffNames}
                />
               </FollowUpComposer>
               </div>
             )}
             <FollowUpRecords
               variant="timeline"
               records={visibleFollowUps.map((item) => {
                 return {
                   id: item.id,
                   author: item.author,
                   date: item.date,
                   content: item.content,
                   accent: item.source === "customer" && item.fromLead ? ("warning" as const) : ("default" as const),
                   pills: (
                     <>
                       <Pill
                         label={item.sourceLabel}
                         tone={item.sourceLabel === "售前反馈" ? "warning" : item.source === "opportunity" ? "info" : "neutral"}
                       />
                       {item.stageLabel ? <Pill label={item.stageLabel} tone="neutral" /> : null}
                       {item.opportunityId ? (
                         <Link
                           href={`/opportunities/${item.opportunityId}`}
                           className="text-xs text-primary hover:underline"
                         >
                           关联商机：{item.opportunityName} &gt;
                         </Link>
                       ) : null}
                       {item.coverageOwner ? <Pill label={`归属 ${item.coverageOwner}`} tone="info" /> : null}
                       {item.fromLead ? <Pill label="线索带入" tone="warning" /> : null}
                       {item.followType ? <Pill label={followTypeLabel(item.followType)} tone="info" /> : null}
                       {item.contactName ? <Pill label={`联系人：${item.contactName}`} tone="neutral" /> : null}
                       {item.nextFollowAt ? (
                         <Pill label={`下次计划 ${item.nextFollowAt.slice(0, 10)}`} tone="warning" />
                       ) : null}
                     </>
                   ),
                 }
               })}
               emptyText={
                 followFilter === "all"
                   ? "暂无跟进记录"
                   : followFilter === "customer"
                     ? "暂无客户跟进记录"
                     : "暂无商机跟进记录"
               }
             />
          </div>
  )
}
