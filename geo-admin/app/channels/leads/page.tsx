import { requireCrmSection } from "@/modules/crm/lib/require-section"
import { ChannelLeadList } from "@/modules/crm/components/channel-lead-list"
export default async function Page() { await requireCrmSection("channels"); return <ChannelLeadList assigned /> }
