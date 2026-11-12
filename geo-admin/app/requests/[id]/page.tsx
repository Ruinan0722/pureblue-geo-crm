import { RequestDetailPage } from "@/modules/requests"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RequestDetailPage id={id} />
}
