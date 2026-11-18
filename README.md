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

## Serve the frontend and API on one port

From this directory, run `npm run build:frontend` to build the sibling `Software_tool_Frontend` project into this backend's `frontend/` directory. Then run `npm start`; Express serves the frontend and `/api` routes from the same configured port (9002 by default). Rebuild the frontend after making UI changes. For local development, start the backend and Vite separately; Vite proxies `/api` to port 9002 by default, configurable with `VITE_PROJECTMANAGEMENT_API_TARGET`.

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

`npm test` checks login and project API validation, company isolation, company-wide discussion access, topic creation, upload cleanup and Swagger responses with mocks. Real database writes and migrations have not been integration tested against a designated test database. No lint script is configured.

## Project APIs and Swagger

Run `npm install`, then `npm start`. Open `/api-docs` on the configured PORT (currently observed as 5005; default is 9002). Swagger UI assets are installed locally. Log in, copy the intended company's token from `data.currentCompany`, and enter it in **Authorize** without a Bearer prefix.

All project routes start with `/api/projects`. Company and author IDs come from the token; user IDs in request bodies refer to company-local `tbl_Users.UserId` values. Authenticated company users may create/update projects and stages. Discussions are project-level and scoped to the owning company: every authenticated user in that company can view discussion history, send messages, and access attachments without being added as a participant. Creating a topic still records its creator in the legacy membership table.

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

Create stages in the same `POST /api/projects` request by supplying an optional `stages` array (maximum 100):

```json
{
  "Project_Name": "Customer Portal",
  "stages": [
    { "Stage_Name": "Requirements", "Sort_Order": 1, "IsActive": 1 },
    { "Stage_Name": "Development", "Sort_Order": 2, "IsActive": 1 }
  ]
}
```

The project and stages are saved in one transaction; any stage failure rolls back the project. The response contains the project fields and a `stages` array of created records. Omitting stages or supplying an empty array preserves project-only creation. Nested stages are supported during creation only.

### Stage storage compatibility

The API does not apply database migrations. It expects `dbo.tbl_Project_Stage.Id` to be a generated, unique `BIGINT`; `dbo.tbl_Task_Type.stage_Id` and `dbo.tbl_Project_Stage_Files.Stage_Id` must also be `BIGINT`. The stage file table uses `Id int IDENTITY`, `Stage_Id bigint`, `Project_Id bigint`, `Company_Id int`, `User_Id int`, `File_Name nvarchar(500)`, `File_Path nvarchar(500)`, `File_Type nvarchar(100)`, `File_Size int`, and `CreatedAt datetime2` with a `SYSUTCDATETIME()` default. File IDs remain `int`.

The checked-in `backend/db/migrations/0001_project_stages.sql` is an optional template for databases that do not already have these tables. Compare it with each company's actual schema before considering it; do not apply it to an existing stage table without checking its ID generation and related column types. Missing or incompatible stage/task-type tables and columns return HTTP 503 with an actionable message.

### Files

Uploads accept a raw binary body with `Content-Type: application/octet-stream` and `?fileName=requirements.png`, up to 10 MiB per file. In Swagger, choose the file in the upload operation. Files live in private, ignored `uploads/projects/` storage with generated names; back up this directory with the database. File metadata uses `tbl_Project_Stage_Files` for stage files or the existing `tbl_Discussion_Files` for discussion attachments. Failed metadata writes clean up the uploaded bytes.

Downloads require the same project/topic access and return attachments with content sniffing disabled. Existing legacy file paths are not served; importing old storage paths needs a separate mapping. The API does not expose the upload directory as static content.
