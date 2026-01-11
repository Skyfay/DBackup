import { createId } from "@/lib/id";
import {
  NotificationChannel,
  NotificationChannelInput,
  NotificationChannelType,
} from "@/lib/types";

export function createNotificationChannel(
  current: NotificationChannel[],
  input: NotificationChannelInput
): { next: NotificationChannel[]; created: NotificationChannel } {
  const created: NotificationChannel = {
    id: createId("notify"),
    ...input,
  };

  return { next: [created, ...current], created };
}

export function channelLabel(channel: NotificationChannel) {
  const icons: Record<NotificationChannelType, string> = {
    email: "Email",
    discord: "Discord",
    webhook: "Webhook",
  };

  return `${icons[channel.type]} → ${channel.target}`;
}
