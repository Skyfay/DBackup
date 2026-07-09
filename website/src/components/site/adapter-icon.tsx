"use client";

import { Icon } from "@iconify/react";
import { getAdapterIcon, getAdapterColor } from "@/lib/adapter-icons";

export function AdapterIcon({
  adapterId,
  className,
}: {
  adapterId: string;
  className?: string;
}) {
  const icon = getAdapterIcon(adapterId);
  const color = getAdapterColor(adapterId);

  return (
    <Icon
      icon={icon}
      className={className}
      {...(color ? { style: { color } } : {})}
    />
  );
}
