import { AppearanceForm } from "@/components/settings/appearance-form";

export default function SettingsPage() {
    return (
         <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
            </div>
             <div className="space-y-6">
                <AppearanceForm />
            </div>
        </div>
    )
}
