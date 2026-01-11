import { AdapterManager } from "@/components/adapter-manager";

export default function NotificationsPage() {
    return (
         <AdapterManager
            type="notification"
            title="Notifications"
            description="Configure channels to receive alerts about your backups."
        />
    )
}
