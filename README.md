# Project management backend

Project management backend with authentication, project/task-type/stage APIs, discussion topics, members, messages and private file uploads. Ticket, report, menu and frontend routes are excluded.

## Setup

Run commands in this directory:

```powershell
npm install
Copy-Item .env.example .env
# Fill .env with your approved database credentials and existing password encryption keys.
npm start
```

Default port: 9002. No production credentials or user records are included. Requires the existing SQL Server portal/company tables and login stored procedures; this project does not create a database. Configure companies through COMPANY1_* variables (additional COMPANY2_*, etc. supported), or local companies.json with id, name, host, user, password and database fields. Company configuration only reads this project's file or an explicit COMPANIES_FILE, never the parent project's file. Unrelated report-table initialization was removed.

## Routes

Each prefix `/api/authorization`, `/api/configuration/login`, and `/api/login` supports:

- POST `/` and `/login`: existing username/password login contract, with optional companyId.
- POST `/switch-company` and `/switchCompany`
- POST `/logout`
- GET `/verify`
- GET `/userAuth`
- POST `/userPortal/login`
- GET `/userPortal/accounts`

Request fields, response shapes and session/company behavior come from the existing login controller. Protected operations use the existing Authorization token handling. Generic server errors are sanitized. Legacy password formats and session storage are retained; this extraction does not redesign authentication. Use HTTPS in deployment.

## Verification

`npm test` checks login and project API validation, company isolation, discussion membership, topic creation, upload cleanup and Swagger responses with mocks. Real database writes and migrations have not been integration tested against a designated test database. No lint script is configured.

## Project APIs and Swagger

Run `npm install`, then `npm start`. Open `/api-docs` on the configured PORT (currently observed as 5005; default is 9002). Swagger UI assets are installed locally. Log in, copy the intended company's token from `data.currentCompany`, and enter it in **Authorize** without a Bearer prefix.

All project routes start with `/api/projects`. Company and author IDs come from the token; user IDs in request bodies refer to company-local `tbl_Users.UserId` values. Authenticated company users may create/update projects and stages. Discussions are project-level; only topic members may read/update a topic, add members, send messages or access its attachments. Creating a topic adds the caller automatically.

| Resource | Methods and path |
| --- | --- |
| Projects | GET/POST `/api/projects`; GET/PUT `/api/projects/{projectId}` |
| Task types | GET/POST `/api/projects/{projectId}/task-types`; PUT `/api/projects/{projectId}/task-types/{taskTypeId}` |
| Stages | GET/POST `/api/projects/{projectId}/stages`; GET/PUT `/api/projects/{projectId}/stages/{stageId}` |
| Topics | GET/POST `/api/projects/{projectId}/discussions`; GET/PUT `/api/projects/{projectId}/discussions/{topicId}` |
| Members | GET/POST `/api/projects/{projectId}/discussions/{topicId}/members` |
| Messages | GET/POST `/api/projects/{projectId}/discussions/{topicId}/messages` |
| Stage files | GET/POST `/api/projects/{projectId}/stages/{stageId}/files` |
| Discussion files | GET/POST `/api/projects/{projectId}/discussions/{topicId}/files` |
| Downloads | GET `{stage-or-discussion-files-path}/{fileId}/download` |

List requests accept `offset` (default 0) and `limit` (default 50, maximum 100). PUT replaces editable values; include optional values you want to retain. Swagger shows the complete request bodies.

### Missing stage schema

Read-only inspection found the existing project, task-type and four discussion tables in both configured company databases. Their discussion timestamp column is `CreatedAt`. Neither company has `tbl_Project_Stage`, `tbl_Project_Stage_Files`, or `tbl_Task_Type.stage_Id`.

The unapplied migration `backend/db/migrations/0001_project_stages.sql` creates those stage tables and adds the nullable task-type stage reference. Each project has multiple stages, and each task type optionally selects one stage. Existing task types remain unassigned. No existing rows are rewritten. Stage/task-type requests return an actionable HTTP 503 until this migration is applied.

After selecting the intended database environment, apply to one configured company at a time:

```powershell
npm run migrate -- --company 1
# Run separately for another company only if intended:
# npm run migrate -- --company 2
```

The runner records applied files in that company's `SchemaMigrations` table and skips them on repeat runs. It never chooses the portal database. The migration has not been applied as part of implementation.

### Files

Uploads accept a raw binary body with `Content-Type: application/octet-stream` and `?fileName=requirements.png`, up to 10 MiB per file. In Swagger, choose the file in the upload operation. This supports images and common files without an extra multipart dependency. Files live in private, ignored `uploads/projects/` storage with generated names; back up this directory with the database. File metadata uses `tbl_Project_Stage_Files` or the existing `tbl_Discussion_Files`. Failed metadata writes clean up the uploaded bytes.

Downloads require the same project/topic access and return attachments with content sniffing disabled. Existing legacy file paths are not served; importing old storage paths needs a separate mapping. The API does not expose the upload directory as static content.
