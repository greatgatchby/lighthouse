#!/bin/sh
# Restore from a backup produced by backup.sh.
# Usage: ./scripts/restore.sh backups/db/lighthouse-2026-08-18.dump
set -eu

DUMP="${1:?usage: restore.sh <path-to-dump>}"
DATABASE_URL="${DATABASE_URL:-postgres://lighthouse:lighthouse@localhost:5432/lighthouse}"

echo "This will REPLACE the current database with $DUMP"
printf "Type 'restore' to continue: "
read -r answer
[ "$answer" = "restore" ] || { echo "aborted"; exit 1; }

pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP"
echo "database restored. Copy backups/storage/* back into ./storage if needed."
