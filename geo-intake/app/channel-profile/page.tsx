import type { Metadata } from "next"
import { ChannelProfileForm } from "@/modules/channel-profile/channel-profile-form"

export const metadata: Metadata = { title: "渠道资料单", description: "填写渠道合作资料，我们将尽快与您联系。" }

export default function Page() { return <ChannelProfileForm /> }
