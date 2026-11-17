# Create project API matching the supplied form

Status: awaiting approval under C:/Users/Admin/Downloads/AGENTS.md.

## Scope

Extend POST /api/projects for the supplied Create a project form. Preserve existing workspace changes and the current Project_Name, Project_Desc and nested stages contract. No dependencies or frontend changes are needed.

## Implementation

1. Accept optional Project_Type as trimmed text, maximum 200 characters (for example Software development). Retain compatibility with existing clients that omit it. Reuse Project_Name for project name and Project_Desc for short description.
2. Add a new numbered migration, 0002_project_type.sql, adding nullable Project_Type nvarchar(200) to dbo.tbl_Project_Master. Do not modify the existing migration or apply migrations to live databases.
3. Persist and return Project_Type on project creation and reads; support it in the existing project replacement update contract. Return an actionable 503 when a request needing the new column encounters an unapplied migration.
4. Keep nested stage creation transactional. The frontend sends only checked stages plus added custom stages using Stage_Name. Default omitted Sort_Order to the stage's one-based array position, preserving explicit Sort_Order. Do not automatically create unchecked or suggested stages. Keep the existing maximum of 100 stages and existing stage validation.
5. Update Swagger and README with the form fields, selected/custom stage behavior, response example and migration requirement. Include all nine screenshot stages in the documented create example: Requirement gathering, Requirement analysis, Planning, Design, Development, Testing, Deployment, Maintenance, Review and completion.

## Files

- modules/projects/controllers.mjs: field validation, nested ordering and schema errors.
- modules/projects/models.mjs: parameterized project type persistence and reads.
- modules/projects/openapi.mjs: request and response documentation.
- backend/db/migrations/0002_project_type.sql: new nullable column.
- tests/projects.test.mjs: validation, parameter binding, ordering and documentation checks.
- README.md: form integration and migration instructions.

## Verification

Run npm test and Node syntax checks for changed modules. Verify project type validation and SQL binding, selected/custom stage ordering, authenticated company ownership, transaction rollback and Swagger schemas. Database integration remains unverified until a designated test database is available; no live writes are part of this task.
