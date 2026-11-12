"use client"

import { useState } from "react"
import { ClipboardList, MapPinCheck, Users } from "lucide-react"
import { useAuth } from "@/modules/auth"
import { canViewTeamCheckins } from "@/modules/auth/lib/permissions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { validateCheckinAttachmentFiles } from "../lib/attachment-limits"
import { RecordList } from "./record-list"
import { TeamRecordsPanel } from "./team-records-panel"
import { VisitCheckInPanel } from "./visit-checkin-panel"
import { CheckinStatusCard } from "./checkin-status-card"
import { CheckinAttachmentPicker } from "./checkin-attachment-picker"
import { useCheckIn } from "../hooks/useCheckIn"

export function CheckinView() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState("checkin")
  const [pickerError, setPickerError] = useState("")
  const canViewTeam = user ? canViewTeamCheckins(user) : false
  const {
    records,
    recordsLoading,
    recordsError,
    status,
    message,
    currentPosition,
    currentAddress,
    addressStatus,
    addressError,
    addressDegraded,
    locationErrorReason,
    locationQualityWarning,
    locationPermission,
    isRefreshingLocation,
    isResolvingAddress,
    refreshLocation,
    retryGeocode,
    activeVisitId,
    selectedFiles,
    setSelectedFiles,
    checkIn,
    locationUsableForCheckin,
    isLoading,
  } = useCheckIn(user?.id)

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="mx-auto w-full max-w-3xl">
      <TabsList className={`mb-4 grid h-10 w-full ${canViewTeam ? "grid-cols-3" : "grid-cols-2"}`}>
        <TabsTrigger value="checkin" className="gap-1.5">
          <MapPinCheck className="size-4" />
          打卡
        </TabsTrigger>
        <TabsTrigger value="records" className="gap-1.5">
          <ClipboardList className="size-4" />
          我的记录
        </TabsTrigger>
        {canViewTeam && (
          <TabsTrigger value="team" className="gap-1.5">
            <Users className="size-4" />
            团队记录
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="checkin" className="space-y-4">
        <CheckinStatusCard
          position={currentPosition}
          address={currentAddress}
          addressStatus={addressStatus}
          addressError={addressError}
          addressDegraded={addressDegraded}
          locationErrorReason={locationErrorReason}
          locationQualityWarning={locationQualityWarning}
          locationPermission={locationPermission}
          isRefreshingLocation={isRefreshingLocation}
          isResolvingAddress={isResolvingAddress}
          onRefreshLocation={refreshLocation}
          onRetryGeocode={retryGeocode}
          activeVisitId={activeVisitId}
        />
        <CheckinAttachmentPicker
          selectedFiles={selectedFiles}
          isLoading={isLoading}
          required={!activeVisitId}
          error={pickerError}
          onPickFiles={(files) => {
            const result = validateCheckinAttachmentFiles(selectedFiles, files)
            if (result.error) {
              setPickerError(result.error)
              return
            }
            setPickerError("")
            setSelectedFiles(result.files)
          }}
          onRemoveFile={(index) => {
            setPickerError("")
            setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
          }}
          onClearFiles={() => {
            setPickerError("")
            setSelectedFiles([])
          }}
        />
        <VisitCheckInPanel
          activeVisitId={activeVisitId}
          onCheckIn={checkIn}
          isLoading={isLoading}
          message={message}
          status={status}
          requiresPhoto={!activeVisitId}
          hasPhoto={selectedFiles.length > 0}
          locationUsable={locationUsableForCheckin}
        />
      </TabsContent>

      <TabsContent value="records">
        <RecordList records={records} loading={recordsLoading} error={recordsError} />
      </TabsContent>

      {canViewTeam && (
        <TabsContent value="team">
          <TeamRecordsPanel enabled={activeTab === "team"} />
        </TabsContent>
      )}
    </Tabs>
  )
}
