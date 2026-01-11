import { BaseAdapter, DatabaseAdapter, StorageAdapter, NotificationAdapter } from "./interfaces";

type AdapterType = 'database' | 'storage' | 'notification';

class AdapterRegistry {
    private adapters: Map<string, BaseAdapter> = new Map();

    register(adapter: BaseAdapter) {
        if (this.adapters.has(adapter.id)) {
            console.warn(`Adapter with id ${adapter.id} is already registered. Overwriting.`);
        }
        this.adapters.set(adapter.id, adapter);
    }

    get(id: string): BaseAdapter | undefined {
        return this.adapters.get(id);
    }

    getAll(): BaseAdapter[] {
        return Array.from(this.adapters.values());
    }

    getByType(type: AdapterType): BaseAdapter[] {
        return this.getAll().filter(adapter => {
            if (type === 'database') return (adapter as any).type === 'database';
            if (type === 'storage') return (adapter as any).type === 'storage';
            if (type === 'notification') return (adapter as any).type === 'notification';
            return false;
        });
    }

    getDatabaseAdapters(): DatabaseAdapter[] {
        return this.getByType('database') as DatabaseAdapter[];
    }

    getStorageAdapters(): StorageAdapter[] {
        return this.getByType('storage') as StorageAdapter[];
    }

    getNotificationAdapters(): NotificationAdapter[] {
        return this.getByType('notification') as NotificationAdapter[];
    }
}

export const registry = new AdapterRegistry();
