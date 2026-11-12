import { ChannelContractDetail } from "@/modules/crm/components/channels/channel-contract-detail"
import { requireCrmSection } from "@/modules/crm/lib/require-section"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { await requireCrmSection("contracts"); const { id } = await params; return <ChannelContractDetail id={id} partnerType="strategic_ecosystem" /> }
