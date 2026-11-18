# Plan: Repair stage ID generation

Module: projects
Status: Draft, awaiting human approval

## Goal and current behavior

Read-only inspection on 2026-11-17 confirmed company 1 dbo.tbl_Project_Stage.Id is nullable bigint, is not IDENTITY and has no default. All three existing rows have null IDs. Company 2 has no dbo.tbl_Project_Stage. The API omits Id on insert because the original table migration defines an identity column; that migration skips tables that already exist.

## Scope and steps

1. Inspect existing keys, defaults, triggers, references and stage ID column types read-only before finalizing the migration.
2. Add a NEW numbered SQL migration without modifying 0001_project_stages.sql. For an existing non-identity table, acquire an exclusive table lock in a transaction, reject duplicate non-null IDs or incompatible existing defaults, and create a bigint sequence starting above the maximum existing ID. Assign sequence-generated IDs to null rows, add a sequence default for future inserts, make Id NOT NULL and enforce uniqueness if no equivalent key exists. Preserve all existing non-null IDs and project/stage data. Identity tables need no repair. Do not use MAX(Id)+1 on each API insert.
3. Verify bigint stage IDs remain compatible with existing tbl_Task_Type.stage_Id and attachment references; stop for a revised plan if incompatible references require broader schema changes.
4. Add targeted checks/documentation for generated IDs and the existing-table repair path. Keep the API's database-generated ID behavior.

## Database application

Prepare and review the exact SQL first. Applying the repair to company 1 requires explicit approval for that concrete migration. Do not apply it to company 2 or create sample rows in live databases. Applying 0001 to this existing table may fail when creating attachment foreign keys before the repair runs, so establish and document a safe repair-before-bootstrap order for company 1.

## Acceptance and verification

- Existing null IDs receive distinct generated values.
- Existing non-null IDs and stage content remain unchanged.
- Future API inserts receive an ID through a database default.
- Uniqueness and NOT NULL are enforced, and repeated application is safe.
- Run npm test; inspect migration behavior with a designated test database when available. Verify live metadata and null/duplicate counts read-only after any separately approved application.

## Risks and rollback

SQL Server cannot add IDENTITY to an existing column directly. A sequence default avoids rebuilding the table. Once generated IDs are referenced, removing them is unsafe; prefer forward repair. No DROP, TRUNCATE, table rebuild, live sample writes or automatic linking of unassigned task types is authorized.

## Progress log

- 2026-11-17: Read-only inspection confirmed the schema mismatch and three null IDs in company 1. No database writes performed.

## Decision log

- 2026-11-17: Propose sequence-based IDs to retain the existing bigint column and preserve stage rows.
