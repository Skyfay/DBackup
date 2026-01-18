import * as React from "react"

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { orientation?: "horizontal" | "vertical", decorative?: boolean }) {
  return (
    <div
      data-orientation={orientation}
      className={
        "shrink-0 bg-border " +
        (orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]") +
        (className ? " " + className : "")
      }
      {...props}
    />
  )
}
