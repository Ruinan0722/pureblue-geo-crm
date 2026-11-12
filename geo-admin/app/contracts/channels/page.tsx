import { ChannelContractRegistry } from "@/modules/crm/components/channels/channel-contract-list"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page({ searchParams }: { searchParams: Promise<{ create?: string; partner?: string; opportunity?: string }> }) {
  await requireCrmSection("contracts")
  const query = await searchParams
  return <div className="px-5 py-6 lg:px-8"><ChannelContractRegistry create={query.create === "1"} partnerId={query.partner} opportunityId={query.opportunity} /></div>
}
