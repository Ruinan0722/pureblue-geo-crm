import { RequestDetail } from "../components/request-detail"

export function RequestDetailPage({ id }: { id: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <RequestDetail id={id} />
    </div>
  )
}
