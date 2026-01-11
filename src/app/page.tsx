import { Dashboard } from "@/components/dashboard/dashboard";
import {
  mockBackupTargets,
  mockNotificationChannels,
  mockStorageLocations,
} from "@/lib/data/mock-data";

export default function Home() {
  return (
    <Dashboard
      initialBackupTargets={mockBackupTargets}
      initialStorageLocations={mockStorageLocations}
      initialNotificationChannels={mockNotificationChannels}
    />
  );
}
