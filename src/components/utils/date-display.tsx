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
  // @ts-ignore - types might not be generated yet
  const userTimezone = session?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  // @ts-ignore - types might not be generated yet
  const dateFormat = session?.user?.dateFormat || "P";
  // @ts-ignore - types might not be generated yet
  const timeFormat = session?.user?.timeFormat || "p";

  if (!date) return null;

  // Ensure date is a Date object
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Determine actual format
  let usedFormat = format;

  // Check if it is a localized format string that we should override
  // We override P, PP, PPP, PPPP and p, pp, ppp, pppp and combinations like Pp, PPpp
  const isLocalizedDate = /^[P]+$/.test(format);
  const isLocalizedTime = /^[p]+$/.test(format);
  // Allow optional whitespace between Date and Time parts (e.g. "PP p")
  const isLocalizedBoth = /^[P]+\s*[p]+$/.test(format);

  if (isLocalizedBoth) {
      usedFormat = `${dateFormat} ${timeFormat}`;
  } else if (isLocalizedDate) {
      usedFormat = dateFormat;
  } else if (isLocalizedTime) {
      usedFormat = timeFormat;
  }

  // Convert and format the date
  // Note: formatInTimeZone handles the "conversion" (displaying the instant in that TZ)
  const formattedDate = formatInTimeZone(dateObj, userTimezone, usedFormat)

  return <time dateTime={dateObj.toISOString()} className={className} suppressHydrationWarning>{formattedDate}</time>
}
