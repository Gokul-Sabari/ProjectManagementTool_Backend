# Project, stage, upload and discussion API plan

Status: implementation authorized by the user's follow-up instruction to create the APIs.

Read-only schema inspection confirmed project, task-type and discussion definitions in both configured company databases. Neither database contains tbl_Project_Stage, a stage-file table or stage_Id on tbl_Task_Type. Supply a new, unapplied migration for those additions; do not alter live databases during implementation. Discussion timestamps are CreatedAt. Use company-local UserId for authors and members. Discussion access requires membership; existing members may add members. Project operations require an authenticated company user. Uploads use a bounded binary request body and a fileName query parameter, avoiding an additional multipart dependency. This contract is documented explicitly in Swagger.

## Objective

Implement working SQL Server APIs for project creation, project task types and SDLC stages, stage images/common files, and the existing discussion tables. Document implemented routes in Swagger with request schemas, authentication, examples and response codes.

The supplied root AGENTS.md requires an approved plan for changes affecting more than three files or crossing modules. No PLANS.md was found in this extraction, so this plan records scope, dependencies, steps and verification explicitly.

## Required schema details

- Project table name and full columns, SQL types, primary key, identity, required fields and defaults.
- Task-type table and its relationship to projects and stages. Confirm whether stage_Id is a single foreign key or refers to a mapping table; do not assume a comma-separated list.
- Full tbl_Project_Stage definition; only Id, Project_Id and Company_Id are currently known.
- Stage upload table definition and stage reference column; storage directory and file limits/types.
- SQL types, keys, identity/default/null constraints for the four supplied discussion tables.
- Confirm project-only versus stage-level discussions. Supplied topics currently have Project_Id but no stage reference.
- Confirm whether User_Id in discussions is the local company user ID or portal global user ID, and who may manage topics, members and uploads.

## Proposed routes

All routes live under /api and require the existing Authorization token and authenticated company context. Paths below are proposed until schema confirmation.

| Area | Routes |
| --- | --- |
| Projects | GET/POST /api/projects; GET/PATCH /api/projects/{projectId} |
| Task types | GET/POST /api/projects/{projectId}/task-types |
| Stages | GET/POST /api/projects/{projectId}/stages; PATCH /api/projects/{projectId}/stages/{stageId} |
| Stage uploads | GET/POST /api/projects/{projectId}/stages/{stageId}/files; GET /api/projects/{projectId}/stages/{stageId}/files/{fileId}/download |
| Topics | GET/POST /api/projects/{projectId}/discussions; GET/PATCH /api/projects/{projectId}/discussions/{topicId} |
| Members | GET/POST /api/projects/{projectId}/discussions/{topicId}/members |
| Messages | GET/POST /api/projects/{projectId}/discussions/{topicId}/messages |
| Discussion uploads | GET/POST /api/projects/{projectId}/discussions/{topicId}/files; GET /api/projects/{projectId}/discussions/{topicId}/files/{fileId}/download |

Deletion is outside this initial scope until required behavior and permissions are confirmed. Stage attachments and discussion attachments remain distinct. Stage-level discussion routes require an existing or approved schema relationship.

## Implementation

1. Confirm schemas and permissions using supplied definitions or explicitly authorized read-only schema inspection. Do not change existing database structures or invent table columns.
2. Add modules exposing index.mjs entry points, with separate routes, controllers, services and SQL models. Register routes in app.mjs before the JSON 404. Reuse existing company pools and central error middleware.
3. Derive Company_Id and User_Id from authenticated context. Verify project, stage, topic and file relationships before reads or writes. Enforce topic membership/management rules once confirmed. Never accept a client-selected identity as authentication.
4. Use parameterized queries, transactions for multi-step writes, bounded list pagination and consistent { success, data, message } responses. Keep SQL out of controllers.
5. Implement actual multipart uploads with a maintained parser if approved; never parse multipart bodies manually. Save generated filenames outside the public directory, enforce configured limits/types, and expose downloads through authorized routes. Clean up uploaded files when metadata writes fail. Decide parser dependency and limits before implementation.
6. Update Swagger to describe only executable operations, including token authentication, multipart upload forms and download responses. Preserve login documentation.

## Verification

- Run npm test and syntax checks for changed modules; no lint script currently exists.
- Add meaningful mocked database tests for company isolation, ownership/membership checks, input validation, parameter binding, transaction rollback and upload failures.
- Verify Swagger JSON, local UI assets and documented route registration.
- Use an approved test database for real create/read/update/upload/download checks; do not write sample data into an unspecified database.
- Open the working Swagger page and verify the new operations render.

## Delivery boundaries

No .env, shared helpers, existing migrations or CI changes. New dependencies require approval. Any needed database change requires a separately described new migration and approval. Keep implementation in reviewable increments; this directory currently has no usable Git repository for branch/PR operations.

## Implemented result

Implemented project, task-type, stage, topic/member/message and binary upload/download routes with Swagger definitions. Added backend/db/migrations/0001_project_stages.sql and an explicit per-company migration runner. The live database was inspected read-only; no migration or sample writes were applied. Existing project/topic SELECT queries were verified in both configured company databases. Swagger on localhost:5005 serves 26 operations including login. Browser automation was unavailable during final verification; HTTP documentation and local assets were verified instead.
