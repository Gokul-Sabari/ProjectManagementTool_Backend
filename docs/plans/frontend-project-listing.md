# Connect Software_tool_Frontend to the project backend

Status: implemented after the user's repeated instruction to connect the frontend; filesystem escalation approved the external frontend edits.

## Scope

Connect C:/Users/Admin/Downloads/gitticketing/Software_tool_Frontend to this backend, focusing on authenticated project listing and project details. Preserve the existing visual design. Do not replace real API failures with demo records.

## Findings

- src/MockWorkspace.tsx renders initialProjects and changes them only in memory.
- src/api.ts has no project API functions and its login type omits data.currentCompany.
- src/App.tsx does not select the company token from data.currentCompany, so the backend's valid login response may fail frontend sign-in.
- vite.config.ts has no /api proxy. Without VITE_API_BASE_URL, requests currently go to Vite rather than the backend.
- Frontend encryption requires VITE_PASSWORD_KEY even though this backend accepts plaintext passwords transported over HTTPS (localhost HTTP for development).
- Backend runs on configured port 5005. GET /api/projects and GET /api/projects/{projectId} return the actual tbl_Project_Master columns.
- Frontend has build and lint commands, but no test script.

## Changes

1. Update vite.config.ts to proxy relative /api requests to http://localhost:5005 for local development. Retain explicit API-base configuration support without changing .env files.
2. Update src/api.ts with accurate company-login and ProjectMaster types, authenticated project listing/detail requests, bounded pagination, and request cancellation support.
3. Update src/App.tsx to select the requested company's token and identity from data.currentCompany. Send the password through the backend's supported contract without requiring a browser encryption secret. Preserve company selection and session persistence.
4. Update src/MockWorkspace.tsx to receive the session, fetch actual projects using React Query, handle loading/empty/error/retry states, and display real project details, status codes, dates and project-head IDs. Cache by authenticated company/session to avoid showing another company's data. Remove demo projects from the connected listing.
5. Connect the existing New project action to POST /api/projects for the fields supported by the form, invalidate/refetch the listing after success, and report errors. Stage selections must not appear saved unless the stage API succeeds; stage initialization depends on the unapplied migration. Keep unsupported task operations visibly unavailable rather than suggesting they persist.
6. Add only the styling needed for API states and accurate project details if the current CSS cannot accommodate them. Keep discussion/stage integration outside this listing-focused change; show honest empty/unavailable states instead of mock data attached to live projects.

## Validation

- Run npm run build and npm run lint in the frontend.
- Run backend npm test if any backend changes become necessary; none are planned initially.
- Verify /api proxy and project response mapping, nullable values, selected-company tokens, and pagination.
- Verify listing, empty/error/retry states and successful creation refresh with mocks or an approved test account. Do not use unknown credentials or create sample records in a live database.
- Open the frontend in the browser if the browser connection is available; otherwise report that limit and verify HTTP/build results.

## Permissions and boundaries

The frontend directory is outside the current writable root. Request filesystem escalation for concrete frontend edits and build outputs after plan approval. No new dependencies, shared-folder changes, .env changes, database migrations or live sample writes are part of this integration.

## Result and validation

- Updated frontend src/api.ts, src/App.tsx and vite.config.ts; added src/ConnectedWorkspace.tsx. Preserved the original mock workspace source, but App now renders the connected workspace.
- Connected projects/details, pagination, search within the current page, refresh and New project persistence. Stages, task types, topic lists and message lists use authenticated read APIs. Unsupported local-only task mutations and demo discussion records are not shown in the connected workspace.
- Both company-login response formats are supported, including encrypted currentCompany with plaintext availableCompanies. Password login no longer depends on a client encryption secret. Identity lookup uses the Bearer-compatible verify endpoint.
- Frontend build and lint passed. Runtime API-client checks passed for URL/pagination, project mapping, authorization/company headers, errors and selected-company login response handling.
- HTTP checks confirmed localhost:5173 serves the frontend and proxies /api/projects to the backend (JSON 401 without authentication), and Swagger is reachable through the proxy.
- Browser automation was unavailable. A real user sign-in, live project creation and stage migration were not performed. Stage reads surface the backend's migration-required error until the missing schema is applied.
- Existing user changes to frontend .env.example and package-lock.json were preserved.

## Full API integration follow-up

The user subsequently requested all supported API actions in the frontend. Extended the same three frontend files (src/api.ts, src/App.tsx, src/ConnectedWorkspace.tsx) with project editing, stage create/detail/update, task-type create/update, topic create/detail/update, member listing/addition, message posting, and separate stage/discussion file upload/list/download controls. Added company switching, persisted session replacement, verification and server logout with an explicit local-only fallback on failure. All child lists now have pagination and retry/refresh controls; mutations refresh session-scoped query data. Binary uploads preserve the file bytes and enforce the backend's 10 MiB limit. No new dependencies or environment edits.

Build and lint passed after implementation. Mocked runtime checks passed for every mutation path/method, encoded filenames, binary request bodies, file-size rejection, download errors and auth/company headers, plus verify/switch/logout requests. No real account credentials, live sample writes or migrations were used. Database migration scope was requested from the user separately and remains unapproved pending a target choice. Actual task CRUD and deletion operations have no corresponding backend routes and are not presented as working features.
