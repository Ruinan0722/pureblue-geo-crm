import { requireCrmSection } from "@/modules/crm/lib/require-section"
import { ChannelProfileShare } from "@/modules/crm/components/channel-profile-share"
export default async function Page() { await requireCrmSection("leads"); return <ChannelProfileShare /> }
