export type GroupWithStats = {
    id: string;
    name: string;
    permissions: string[];
    createdAt: Date;
    updatedAt: Date;
    _count: {
        users: number;
    }
}
