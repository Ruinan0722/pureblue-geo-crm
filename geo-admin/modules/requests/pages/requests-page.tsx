import { InvitePanel } from "@/modules/invites"
import { RequestList } from "../components/request-list"

export function RequestsPage() {
  return (
    <div>
      <div className="space-y-6 px-5 py-6 lg:px-8">
        <InvitePanel />
        <RequestList />
      </div>
    </div>
  )
}
