"use client"

import { useEffect, useState } from "react"
import { formatBeijingTime } from "../utils/beijingTime"

export function useBeijingTime(tickMs = 1000) {
  const [time, setTime] = useState(() => formatBeijingTime())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTime(formatBeijingTime())
    }, tickMs)

    return () => window.clearInterval(timer)
  }, [tickMs])

  return time
}
