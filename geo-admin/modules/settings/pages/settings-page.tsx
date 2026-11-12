import { SettingsGuard } from "../components/settings-guard"
import { SettingsView } from "../components/settings-view"

export function SettingsPage() {
  return (
    <SettingsGuard>
      <SettingsView />
    </SettingsGuard>
  )
}
