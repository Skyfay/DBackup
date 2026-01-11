import { AdapterManager } from "@/components/adapter-manager";

export default function SourcesPage() {
    return (
        <AdapterManager
            type="database"
            title="Sources"
            description="Configure the databases you want to backup."
        />
    )
}
