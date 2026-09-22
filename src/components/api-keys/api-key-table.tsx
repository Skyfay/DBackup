"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Trash, RotateCcw, Power, PowerOff } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { deleteApiKey, toggleApiKey, rotateApiKey, bulkDeleteApiKeys, bulkToggleApiKeys } from "@/app/actions/auth/api-key"
import { toast } from "sonner"
import { DateDisplay } from "@/components/utils/date-display"
import { DataTable, type BulkAction } from "@/components/ui/data-table"
import { unwrapBulkAction } from "@/lib/bulk-request"
import { Badge } from "@/components/ui/badge"
import { useMemo, useState } from "react"
import { ApiKeyRevealDialog } from "./api-key-reveal-dialog"
import type { ApiKeyListItem } from "@/services/auth/api-key-service"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ApiKeyTableProps {
    data: ApiKeyListItem[]
    canManage: boolean
}

export function ApiKeyTable({ data, canManage }: ApiKeyTableProps) {
    const [revealedKey, setRevealedKey] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

    const handleDelete = async (id: string) => {
        setConfirmDelete(null)
        toast.promise(deleteApiKey(id), {
            loading: "Deleting API key...",
            success: (data) => {
                if (data.success) return "API key deleted successfully"
                throw new Error(data.error)
            },
            error: (err) => `Error: ${err.message}`,
        })
    }

    const handleToggle = async (id: string, enabled: boolean) => {
        toast.promise(toggleApiKey(id, enabled), {
            loading: enabled ? "Enabling API key..." : "Disabling API key...",
            success: (data) => {
                if (data.success) return enabled ? "API key enabled" : "API key disabled"
                throw new Error(data.error)
            },
            error: (err) => `Error: ${err.message}`,
        })
    }

    const handleRotate = async (id: string) => {
        toast.promise(rotateApiKey(id), {
            loading: "Rotating API key...",
            success: (result) => {
                if (result.success && result.data) {
                    setRevealedKey(result.data.rawKey)
                    return "API key rotated - save the new key now"
                }
                throw new Error(result.error)
            },
            error: (err) => `Error: ${err.message}`,
        })
    }

    const bulkActions = useMemo<BulkAction<ApiKeyListItem>[]>(() => {
        if (!canManage) return []

        return [
            {
                id: "enable",
                labels: { verb: "enable", verbPast: "enabled", noun: "API key" },
                icon: Power,
                isAvailable: (rows) => rows.some((key) => !key.enabled),
                itemName: (key) => key.name,
                run: (rows) => unwrapBulkAction(bulkToggleApiKeys(rows.map((key) => key.id), true)),
            },
            {
                id: "disable",
                labels: { verb: "disable", verbPast: "disabled", noun: "API key" },
                icon: PowerOff,
                isAvailable: (rows) => rows.some((key) => key.enabled),
                itemName: (key) => key.name,
                run: (rows) => unwrapBulkAction(bulkToggleApiKeys(rows.map((key) => key.id), false)),
            },
            {
                id: "delete",
                labels: { verb: "delete", verbPast: "deleted", noun: "API key" },
                icon: Trash,
                variant: "destructive",
                itemName: (key) => key.name,
                confirm: {
                    title: (rows) => `Delete ${rows.length} API key${rows.length === 1 ? "" : "s"}?`,
                    description: () =>
                        "Any integration using one of these keys loses access immediately.",
                    confirmLabel: "Delete",
                },
                run: (rows) => unwrapBulkAction(bulkDeleteApiKeys(rows.map((key) => key.id))),
            },
        ]
    }, [canManage])

    const columns: ColumnDef<ApiKeyListItem>[] = [
        {
            accessorKey: "name",
            header: "Name",
            cell: ({ row }) => (
                <span className="font-medium">{row.getValue("name")}</span>
            ),
        },
        {
            accessorKey: "prefix",
            header: "Key",
            cell: ({ row }) => (
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                    {row.getValue("prefix")}...
                </code>
            ),
        },
        {
            accessorKey: "permissions",
            header: "Permissions",
            cell: ({ row }) => {
                const perms = row.original.permissions
                return (
                    <Badge variant="secondary">
                        {perms.length} permission{perms.length !== 1 ? "s" : ""}
                    </Badge>
                )
            },
        },
        {
            accessorKey: "enabled",
            header: "Status",
            cell: ({ row }) => {
                const enabled = row.original.enabled
                const expired = row.original.expiresAt && new Date(row.original.expiresAt) < new Date()
                if (expired) {
                    return <Badge variant="destructive">Expired</Badge>
                }
                return enabled ? (
                    <Badge variant="default">Active</Badge>
                ) : (
                    <Badge variant="secondary">Disabled</Badge>
                )
            },
        },
        {
            accessorKey: "lastUsedAt",
            header: "Last Used",
            cell: ({ row }) => {
                const lastUsed = row.original.lastUsedAt
                return lastUsed ? <DateDisplay date={lastUsed} /> : <span className="text-muted-foreground text-xs">Never</span>
            },
        },
        {
            accessorKey: "expiresAt",
            header: "Expires",
            cell: ({ row }) => {
                const expiresAt = row.original.expiresAt
                return expiresAt ? <DateDisplay date={expiresAt} /> : <span className="text-muted-foreground text-xs">Never</span>
            },
        },
        {
            accessorKey: "createdAt",
            header: "Created",
            cell: ({ row }) => <DateDisplay date={row.original.createdAt} />,
        },
    ]

    if (canManage) {
        columns.push({
            id: "actions",
            cell: ({ row }) => {
                const key = row.original
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleToggle(key.id, !key.enabled)}>
                                {key.enabled ? (
                                    <>
                                        <PowerOff className="mr-2 h-4 w-4" />
                                        Disable
                                    </>
                                ) : (
                                    <>
                                        <Power className="mr-2 h-4 w-4" />
                                        Enable
                                    </>
                                )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRotate(key.id)}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Rotate Key
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmDelete(key.id)}
                            >
                                <Trash className="mr-2 h-4 w-4" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        })
    }

    return (
        <>
            <DataTable
                columns={columns}
                data={data}
                enableRowSelection={canManage}
                getRowId={(key) => key.id}
                bulkActions={bulkActions}
            />

            {/* Reveal dialog for rotated keys */}
            <ApiKeyRevealDialog
                rawKey={revealedKey}
                open={!!revealedKey}
                onOpenChange={(open) => !open && setRevealedKey(null)}
            />

            {/* Confirm delete dialog */}
            <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. Any integrations using this key will immediately lose access.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => confirmDelete && handleDelete(confirmDelete)}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
