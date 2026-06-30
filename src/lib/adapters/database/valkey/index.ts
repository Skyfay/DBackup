import type { DatabaseAdapter } from "@/lib/core/interfaces";
import { RedisSchema } from "@/lib/adapters/definitions";
import { RedisAdapter } from "../redis";

export const ValkeyAdapter: DatabaseAdapter = {
    ...RedisAdapter,
    id: "valkey",
    name: "Valkey",
    configSchema: RedisSchema,
};
