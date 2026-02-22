import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { RestoreClient } from "./restore-client";

export default async function RestorePage() {
    const permissions = await getUserPermissions();
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);

    if (!canRestore) {
        redirect("/dashboard/storage");
    }

    return <RestoreClient />;
}
