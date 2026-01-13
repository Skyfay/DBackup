"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Trash, Pencil } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { deleteUser } from "@/app/actions/user"
import { toast } from "sonner"
import { User } from "@prisma/client"
import { format } from "date-fns"
import { DataTable } from "@/components/ui/data-table"
import { useState } from "react"
import { EditUserDialog } from "./edit-user-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DateDisplay } from "@/components/date-display"

interface UserTableProps {
    data: User[];
}

export function UserTable({ data }: UserTableProps) {
    const [editingUser, setEditingUser] = useState<User | null>(null)

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

    const columns: ColumnDef<User>[] = [
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
            <DataTable columns={columns} data={data} searchKey="email" />
            <EditUserDialog
                user={editingUser}
                open={!!editingUser}
                onOpenChange={(open) => !open && setEditingUser(null)}
            />
        </>
    )
}
