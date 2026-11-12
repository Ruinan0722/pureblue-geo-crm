import type { Metadata } from "next"
import { IntakeForm } from "@/modules/intake"

export const metadata: Metadata = {
  title: "国内需求填报",
}

export default function IntakeDomesticPage() {
  return <IntakeForm variant="domestic" />
}
