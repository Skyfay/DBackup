"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Trash, Pencil } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import { deleteGroup } from "@/app/actions/group"
import { toast } from "sonner"
import { DateDisplay } from "@/components/utils/date-display"
import { DataTable } from "@/components/ui/data-table"
import { useState } from "react"
import { EditGroupDialog } from "@/app/dashboard/users/edit-group-dialog"
import { Badge } from "@/components/ui/badge"
import { GroupWithStats } from "@/types"

interface GroupTableProps {
    data: GroupWithStats[];
    canManage: boolean;
}

export function GroupTable({ data, canManage }: GroupTableProps) {
    const [editingGroup, setEditingGroup] = useState<GroupWithStats | null>(null)

    const handleDelete = async (id: string) => {
        toast.promise(deleteGroup(id), {
            loading: 'Deleting group...',
            success: (data) => {
                if (data.success) {
                    return 'Group deleted successfully';
                } else {
                    throw new Error(data.error)
                }
            },
            error: (err) => `Error: ${err.message}`
        });
    }

    const columns: ColumnDef<GroupWithStats>[] = [
        {
            accessorKey: "name",
            header: "Name",
            cell: ({ row }) => <span className="font-medium">{row.getValue("name")}</span>
        },
        {
            accessorKey: "_count.users",
            header: "Members",
            cell: ({ row }) => (
                <Badge variant="secondary">
                    {row.original._count.users} Users
                </Badge>
            )
        },
        {
            accessorKey: "permissions",
            header: "Permissions",
            cell: ({ row }) => {
                return (
                    <span className="text-muted-foreground text-sm">
                        {row.original.permissions.length} permissions
                    </span>
                )
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
                const group = row.original

                if (!canManage) return null;

                // Protect SuperAdmin group
                const isSuperAdmin = group.name === "SuperAdmin";

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0" disabled={isSuperAdmin}>
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {!isSuperAdmin && (
                                <>
                                    <DropdownMenuItem onClick={() => setEditingGroup(group)}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Edit Group
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => handleDelete(group.id)}
                                    >
                                        <Trash className="mr-2 h-4 w-4" />
                                        Delete Group
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ]

    return (
        <>
            <DataTable columns={columns} data={data} />
            {editingGroup && (
                <EditGroupDialog
                    group={editingGroup}
                    open={!!editingGroup}
                    onOpenChange={(open: boolean) => !open && setEditingGroup(null)}
                />
            )}
        </>
    )
}
