import { createId } from "@/lib/id";
import { StorageLocation, StorageLocationInput } from "@/lib/types";

export function createStorageLocation(
  current: StorageLocation[],
  input: StorageLocationInput
): { next: StorageLocation[]; created: StorageLocation } {
  const created: StorageLocation = {
    id: createId("store"),
    ...input,
  };

  return { next: [created, ...current], created };
}
