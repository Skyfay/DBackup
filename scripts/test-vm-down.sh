#!/bin/bash
#
# Stops (or optionally deletes) the SSH test VM created by test-vm-up.sh.
#
# Usage:
#   pnpm run test:vm:down            # stop the VM, keep its disk/containers
#   pnpm run test:vm:down -- --delete  # permanently delete the VM

set -e

VM_NAME="${VM_NAME:-dbackup-test-vm}"

if ! command -v multipass &> /dev/null; then
    echo "❌ Multipass is not installed."
    exit 1
fi

if ! multipass info "$VM_NAME" &> /dev/null; then
    echo "VM '$VM_NAME' does not exist. Nothing to do."
    exit 0
fi

if [ "$1" = "--delete" ]; then
    echo "🗑️  Deleting VM '$VM_NAME' permanently (containers and disk are gone)..."
    multipass delete "$VM_NAME"
    multipass purge
    echo "✓ Deleted."
else
    echo "⏸️  Stopping VM '$VM_NAME' (disk and containers are preserved)..."
    multipass stop "$VM_NAME"
    echo "✓ Stopped. Run 'pnpm run test:vm:up' to resume, or pass --delete to remove it entirely."
fi
