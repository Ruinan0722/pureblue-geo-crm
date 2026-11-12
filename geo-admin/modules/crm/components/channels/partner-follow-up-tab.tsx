"use client"
import { useState } from "react"
import { CustomerFollowUpTab, type UnifiedCustomerFollowUp } from "../customer-follow-up-tab"
import { coerceFollowType, oppStageMeta } from "../../lib/crm-data"
import { sortFollowUpsNewestFirst } from "../../lib/follow-up-sort"
import { useStaffNames } from "../../hooks/use-directory-options"
import { createChannelResource, type ChannelPartner, type ChannelContact, type ChannelFollowUp, type ChannelOpportunity } from "../../services/channel-management"
import { createNotifications } from "../../services/crm-directory"

export function PartnerFollowUpTab({ partner, contacts, followups, opportunities, canWrite, onSaved }: {
  partner: ChannelPartner; contacts: ChannelContact[]; followups: ChannelFollowUp[]; opportunities: ChannelOpportunity[]; canWrite: boolean; onSaved: () => void
}) {
  const { names } = useStaffNames()
  const [plan, setPlan] = useState<string | null | undefined>(partner.nextFollowAt)
  const records: UnifiedCustomerFollowUp[] = sortFollowUpsNewestFirst([
    ...followups.map((row) => ({ id: row.id, source: "customer" as const, author: row.authorName, content: row.content, date: row.createdAt,
      followType: coerceFollowType(row.followType) || undefined, contactName: row.contactName || contacts.find((contact) => contact.id === row.contactId)?.name,
      nextFollowAt: row.nextFollowAt || undefined, sourceLabel: "客户跟进" as const })),
    ...opportunities.flatMap((opp) => [
      ...(opp.notes || []).map((row) => ({ id: `opportunity-${opp.id}-sales-${row.id}`, source: "opportunity" as const, author: row.author, content: row.content, date: row.date,
        followType: row.followType, nextFollowAt: row.nextFollowAt, opportunityId: opp.id, opportunityName: opp.name, stageLabel: oppStageMeta(opp.stageCode).label, sourceLabel: "商机跟进" as const })),
      ...(opp.advisorNotes || []).map((row) => ({ id: `opportunity-${opp.id}-advisor-${row.id}`, source: "opportunity" as const, author: row.author, content: row.content, date: row.date,
        opportunityId: opp.id, opportunityName: opp.name, stageLabel: oppStageMeta(opp.stageCode).label, sourceLabel: "售前反馈" as const })),
    ]),
  ])
  return <CustomerFollowUpTab unifiedFollowUps={records} canAddFollow={canWrite} followContacts={contacts} nextFollowAt={plan} staffNames={names}
    onSave={async ({ content, ...options }) => {
      await createChannelResource(partner.id, "follow-ups", { content, ...options, nextFollowAt: options.nextFollowAt || null })
      setPlan(options.nextFollowAt || null)
      // Notification delivery is best-effort after the follow-up itself has been saved.
      if (options.mentions.length) void createNotifications(options.mentions.map((targetName) => ({ targetName, message: `在「${partner.brandName || partner.name}」的跟进中提及了你：${content}`, href: `${partner.partnerType === "strategic_ecosystem" ? "/ecosystems/" : "/channels/"}${partner.id}?tab=follow-ups` }))).catch(() => undefined)
      onSaved()
    }} />
}
