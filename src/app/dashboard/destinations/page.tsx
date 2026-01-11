import { AdapterManager } from "@/components/adapter-manager";

export default function DestinationsPage() {
    return (
         <AdapterManager
            type="storage"
            title="Destinations"
            description="Configure where your backups should be stored."
        />
    )
}
