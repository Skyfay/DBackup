"use client"

import { useSession } from "@/lib/auth-client"
import { formatInTimeZone } from "date-fns-tz"

interface DateDisplayProps {
  date: Date | string
  format?: string
  className?: string
}

export function DateDisplay({ date, format = "Pp", className }: DateDisplayProps) {
  const { data: session } = useSession()
  const userTimezone = session?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  if (!date) return null;

  // Ensure date is a Date object
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Convert and format the date
  // Note: formatInTimeZone handles the "conversion" (displaying the instant in that TZ)
  const formattedDate = formatInTimeZone(dateObj, userTimezone, format)

  return <time dateTime={dateObj.toISOString()} className={className} suppressHydrationWarning>{formattedDate}</time>
}
