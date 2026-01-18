"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Trash, Pencil } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { deleteUser } from "@/app/actions/user"
import { toast } from "sonner"
import { User } from "@prisma/client"
import { DataTable } from "@/components/ui/data-table"
import { useState } from "react"
import { EditUserDialogComponent as EditUserDialog } from "@/app/dashboard/users/edit-user-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DateDisplay } from "@/components/utils/date-display"
import { Badge } from "@/components/ui/badge"
import { GroupWithStats } from "@/types"

// Create an extended User type that includes the group relation
type UserWithGroup = User & {
    group?: GroupWithStats | null
}

interface UserTableProps {
    data: UserWithGroup[];
    groups: GroupWithStats[];
    canManage: boolean;
}

export function UserTable({ data, groups, canManage }: UserTableProps) {
    const [editingUser, setEditingUser] = useState<UserWithGroup | null>(null)

    const handleDelete = async (userId: string) => {
         toast.promise(deleteUser(userId), {
            loading: 'Deleting user...',
            success: (data) => {
                if(data.success) {
                    return 'User deleted successfully';
                } else {
                    throw new Error(data.error)
                }
            },
            error: (err) => `Error: ${err.message}`
        });
    }

    const columns: ColumnDef<UserWithGroup>[] = [
        {
            accessorKey: "image",
            header: "",
            cell: ({ row }) => {
                const image = row.getValue("image") as string;
                const name = row.getValue("name") as string;
                return (
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={image} alt={name} />
                        <AvatarFallback>{name?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                )
            },
        },
        {
            accessorKey: "name",
            header: "Name",
        },
        {
            accessorKey: "email",
            header: "Email",
        },
        {
            id: "group",
            header: "Group",
            cell: ({ row }) => {
                const group = row.original.group;
                return group ? (
                    <Badge variant="outline">{group.name}</Badge>
                ) : (
                    <span className="text-muted-foreground text-sm">-</span>
                );
            }
        },
        {
            accessorKey: "createdAt",
            header: "Created At",
            cell: ({ row }) => {
                return <div><DateDisplay date={row.getValue("createdAt")} format="PPp" /></div>
            },
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const user = row.original

                if (!canManage) return null;

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                onClick={() => navigator.clipboard.writeText(user.id)}
                            >
                                Copy User ID
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setEditingUser(user)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(user.id)}>
                                <Trash className="mr-2 h-4 w-4" />
                                Delete User
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ]

    return (
        <>
            <DataTable columns={columns} data={data} />
            {editingUser && (
                <EditUserDialog
                    user={editingUser}
                    groups={groups}
                    open={!!editingUser}
                    onOpenChange={(open) => !open && setEditingUser(null)}
                />
            )}
        </>
    )
}
