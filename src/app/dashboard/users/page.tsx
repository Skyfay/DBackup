import { getUsers } from "@/app/actions/user";
import { UserTable } from "./user-table";
import { CreateUserDialog } from "./create-user-dialog";

export default async function UsersPage() {
    const users = await getUsers();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Users</h2>
                    <p className="text-muted-foreground">
                        Manage users and their access to the system.
                    </p>
                </div>
                <CreateUserDialog />
            </div>

            <UserTable data={users} />
        </div>
    );
}
