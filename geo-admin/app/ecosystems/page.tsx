import { EcosystemManagementPage } from "@/modules/crm/components/ecosystems/ecosystem-management-page"
import { requireCrmSection } from "@/modules/crm/lib/require-section"
export default async function Page() { await requireCrmSection("channels"); return <EcosystemManagementPage /> }
