/** Every engine the lab runs in containers, in the order of the catalog. */

import { FIREBIRD } from "./firebird";
import { MONGODB } from "./mongodb";
import { MSSQL } from "./mssql";
import { MARIADB, MYSQL } from "./mysql";
import { POSTGRES } from "./postgres";
import { REDIS, VALKEY } from "./redis";
import type { Engine, EngineSpec } from "./types";

export const ENGINES: EngineSpec[] = [MYSQL, MARIADB, POSTGRES, MONGODB, MSSQL, REDIS, VALKEY, FIREBIRD];

export function engineOf(id: Engine): EngineSpec {
    const found = ENGINES.find((spec) => spec.id === id);
    if (!found) throw new Error(`The lab has no engine ${id}`);
    return found;
}
