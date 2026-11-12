import type { Metadata } from "next"
import { IntakeForm } from "@/modules/intake"

export const metadata: Metadata = {
  title: "海外需求填报",
}

export default function IntakeOverseasPage() {
  return <IntakeForm variant="overseas" />
}
