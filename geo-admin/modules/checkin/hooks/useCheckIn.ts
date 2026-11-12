"use client"

import { useCallback, useEffect, useState } from "react"
import { resolveActiveVisitId } from "../lib/attachment-limits"
import { reverseGeocodeDetailed } from "../services/amap"
import { createCheckinRecord, fetchActiveVisitId, fetchCheckinRecords } from "../services/checkin-api"
import { deleteCheckinAttachments, uploadCheckinAttachments } from "../services/checkin-attachments"
import type { AddressInfo, CheckinRecord, GeoPosition } from "../lib/types"
import { formatBeijingTime } from "../utils/beijingTime"
import {
  GeolocationError,
  getCurrentPosition,
  getInsecureContextMessage,
  queryGeolocationPermission,
  type GeolocationFailureReason,
} from "../utils/geolocation"

type CheckInStatus = "idle" | "loading" | "success" | "error"
type AddressStatus = "idle" | "loading" | "ready" | "error"

function toLocationError(error: unknown): { message: string; reason: GeolocationFailureReason } {
  if (error instanceof GeolocationError) {
    return { message: error.message, reason: error.reason }
  }

  return {
    message: error instanceof Error ? error.message : "定位失败",
    reason: "unknown",
  }
}

function accuracyHint(position: GeoPosition): string {
  if (position.accuracy != null && position.accuracy > 500) {
    return "定位精度较低，坐标可能偏差较大。电脑端请关闭 VPN 后重试，或改用手机 GPS 打卡。"
  }
  return ""
}

export function useCheckIn(userId: string | undefined) {
  const [records, setRecords] = useState<CheckinRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsError, setRecordsError] = useState("")
  const [status, setStatus] = useState<CheckInStatus>("idle")
  const [message, setMessage] = useState("")
  const [currentPosition, setCurrentPosition] = useState<GeoPosition | null>(null)
  const [currentAddress, setCurrentAddress] = useState<AddressInfo | null>(null)
  const [addressStatus, setAddressStatus] = useState<AddressStatus>("idle")
  const [addressError, setAddressError] = useState("")
  const [addressDegraded, setAddressDegraded] = useState(false)
  const [locationErrorReason, setLocationErrorReason] = useState<GeolocationFailureReason | null>(null)
  const [locationQualityWarning, setLocationQualityWarning] = useState("")
  const [locationPermission, setLocationPermission] = useState<PermissionState | "unknown">("unknown")
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false)
  const [isResolvingAddress, setIsResolvingAddress] = useState(false)
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const applyActiveVisit = useCallback((visitId: string | null) => {
    setActiveVisitId(visitId)
  }, [])

  const loadRecords = useCallback(async () => {
    if (!userId) {
      setRecords([])
      setRecordsError("")
      setActiveVisitId(null)
      return
    }
    setRecordsLoading(true)
    setRecordsError("")
    try {
      const [next, serverVisitId] = await Promise.all([
        fetchCheckinRecords({ scope: "own" }),
        fetchActiveVisitId().catch(() => null),
      ])
      setRecords(next)
      const fromRecords = resolveActiveVisitId(next)
      applyActiveVisit(serverVisitId ?? fromRecords)
    } catch (error) {
      setRecords([])
      setRecordsError(error instanceof Error ? error.message : "获取打卡记录失败")
    } finally {
      setRecordsLoading(false)
    }
  }, [applyActiveVisit, userId])

  useEffect(() => {
    if (!userId) {
      setRecords([])
      setRecordsError("")
      setActiveVisitId(null)
      return
    }
    void loadRecords()
  }, [userId, loadRecords])

  const resolveAddress = useCallback(async (position: GeoPosition) => {
    setIsResolvingAddress(true)
    setAddressStatus("loading")
    setAddressError("")
    setAddressDegraded(false)

    const result = await reverseGeocodeDetailed(position.latitude, position.longitude)
    setCurrentAddress(result)
    setIsResolvingAddress(false)

    if (result.degraded) {
      setAddressStatus("error")
      setAddressDegraded(true)
      setAddressError(result.errorMessage ?? "中文地址解析失败")
      return result
    }

    setAddressStatus("ready")
    setAddressDegraded(false)
    return result
  }, [])

  const refreshLocation = useCallback(async () => {
    setIsRefreshingLocation(true)
    setAddressError("")
    setAddressDegraded(false)
    setLocationErrorReason(null)

    const permission = await queryGeolocationPermission()
    setLocationPermission(permission)

    const insecureMessage = getInsecureContextMessage()
    if (insecureMessage) {
      setCurrentPosition(null)
      setCurrentAddress(null)
      setLocationQualityWarning("")
      setAddressStatus("error")
      setAddressError(insecureMessage)
      setLocationErrorReason("insecure_context")
      setIsRefreshingLocation(false)
      return
    }

    try {
      const position = await getCurrentPosition()
      setCurrentPosition(position)
      setLocationQualityWarning(accuracyHint(position))
      setLocationErrorReason(null)
      setAddressStatus("loading")
      await resolveAddress(position)
    } catch (error) {
      const { message: errorMessage, reason } = toLocationError(error)
      setCurrentPosition(null)
      setCurrentAddress(null)
      setLocationQualityWarning("")
      setAddressStatus("error")
      setAddressError(errorMessage)
      setLocationErrorReason(reason)
    } finally {
      setIsRefreshingLocation(false)
    }
  }, [resolveAddress])

  const retryGeocode = useCallback(async () => {
    if (!currentPosition) {
      await refreshLocation()
      return
    }
    await resolveAddress(currentPosition)
  }, [currentPosition, refreshLocation, resolveAddress])

  useEffect(() => {
    void refreshLocation()
  }, [refreshLocation])

  const createRecord = useCallback(
    async (type: "arrive" | "leave") => {
      if (!userId) {
        setStatus("error")
        setMessage("请先登录后再打卡")
        return
      }

      if (type === "arrive" && selectedFiles.length === 0) {
        setStatus("error")
        setMessage("到达打卡需上传至少一张现场照片")
        return
      }

      setStatus("loading")
      setMessage("正在获取位置…")
      let uploadedIds: string[] = []

      try {
        const position = await getCurrentPosition()
        setCurrentPosition(position)
        setLocationQualityWarning(accuracyHint(position))
        setLocationErrorReason(null)
        setMessage("正在解析中文地址…")

        const geo = await resolveAddress(position)

        if (selectedFiles.length > 0) {
          setMessage("正在上传现场照片…")
          uploadedIds = await uploadCheckinAttachments(selectedFiles)
        }

        const visitId = type === "arrive" ? crypto.randomUUID() : activeVisitId
        if (!visitId) {
          throw new Error("请先到达打卡，再进行结束打卡")
        }

        setMessage("正在保存打卡记录…")
        const record = await createCheckinRecord({
          visitId,
          type,
          timestamp: Date.now(),
          beijingTime: formatBeijingTime(new Date()),
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          address: geo.address,
          province: geo.province,
          city: geo.city,
          district: geo.district,
          attachmentIds: uploadedIds.length > 0 ? uploadedIds : undefined,
        })

        setRecords((prev) => [record, ...prev])
        applyActiveVisit(type === "arrive" ? visitId : null)
        setSelectedFiles([])
        setStatus("idle")
        setMessage("")
      } catch (error) {
        if (uploadedIds.length > 0) {
          void deleteCheckinAttachments(uploadedIds)
        }
        if (error instanceof GeolocationError) {
          setLocationErrorReason(error.reason)
          setAddressError(error.message)
          setAddressStatus("error")
        }
        setStatus("error")
        setMessage(error instanceof Error ? error.message : "打卡失败")
      }
    },
    [activeVisitId, applyActiveVisit, resolveAddress, selectedFiles, userId],
  )

  const checkIn = useCallback(async () => {
    await createRecord(activeVisitId ? "leave" : "arrive")
  }, [activeVisitId, createRecord])

  return {
    records,
    recordsLoading,
    recordsError,
    reloadRecords: loadRecords,
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
    locationUsableForCheckin: Boolean(currentPosition),
    isLoading: status === "loading",
  }
}
