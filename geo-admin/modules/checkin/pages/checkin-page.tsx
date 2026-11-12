import { CheckinView } from "../components/checkin-view"

export function CheckinPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-muted/20 via-background to-background">
      <div className="px-5 py-6 lg:px-8">
        <CheckinView />
      </div>
    </div>
  )
}
