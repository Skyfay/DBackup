"use client"

import { useCallback } from "react"
import { useSession } from "@/lib/auth-client"
import { formatInTimeZone } from "date-fns-tz"

/**
 * Hook that returns a date formatting function respecting user preferences
 * (timezone, dateFormat, timeFormat). Useful for Recharts formatters and
 * other places where a React component (DateDisplay) cannot be used.
 *
 * Uses the same logic as DateDisplay to resolve localized format tokens
 * (P, PP, p, pp, Pp, etc.) to the user's configured formats.
 */
export function useDateFormatter() {
  const { data: session } = useSession()

  // @ts-expect-error - types might not be generated yet
  const userTimezone = session?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  // @ts-expect-error - types might not be generated yet
  const dateFormat = session?.user?.dateFormat || "P"
  // @ts-expect-error - types might not be generated yet
  const timeFormat = session?.user?.timeFormat || "p"

  const formatDate = useCallback(
    (date: Date | string, fmt: string = "Pp"): string => {
      const dateObj = typeof date === "string" ? new Date(date) : date

      let usedFormat = fmt

      const isLocalizedDate = /^[P]+$/.test(fmt)
      const isLocalizedTime = /^[p]+$/.test(fmt)
      const isLocalizedBoth = /^[P]+\s*[p]+$/.test(fmt)

      if (isLocalizedBoth) {
        usedFormat = `${dateFormat} ${timeFormat}`
      } else if (isLocalizedDate) {
        usedFormat = dateFormat
      } else if (isLocalizedTime) {
        usedFormat = timeFormat
      }

      return formatInTimeZone(dateObj, userTimezone, usedFormat)
    },
    [userTimezone, dateFormat, timeFormat]
  )

  return { formatDate }
}
