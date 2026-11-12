import { ChannelDetailPage } from "@/modules/crm/components/channels/channel-detail-page"
import { requireCrmSection } from "@/modules/crm/lib/require-section"
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
 await requireCrmSection("channels"); const [{ id }, query] = await Promise.all([params, searchParams]); return <ChannelDetailPage id={id} tab={query.tab} partnerType="strategic_ecosystem" />
}
