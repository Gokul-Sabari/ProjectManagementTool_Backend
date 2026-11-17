import { projectPaths, projectSchemas } from '../modules/projects/index.mjs';

// Canonical login URL; the authorization and configuration prefixes are aliases.
export const loginSpec = {
    openapi: '3.0.3',
    info: {
        title: 'Project Management API', version: '1.0.0',
        description: 'Log in first using the login endpoint. Copy data.currentCompany[].token for the intended company, then use Authorize to enter that token. Project and stage records are scoped to the authenticated company. Discussion access requires topic membership; the creator is automatically a member. Project operations are available to authenticated company users. User IDs are company-local tbl_Users.UserId values. Projects contain multiple stages; each task type optionally references one stage through stage_Id. Stage images/common files and discussion attachments use separate tables. Uploads accept a binary file body with a fileName query parameter (10 MiB maximum). Stage and task-type APIs require backend/db/migrations/0001_project_stages.sql in each intended company database; the migration is supplied but has not been applied to live databases.',
    },
    servers: [{ url: '/' }],
    components: {
        securitySchemes: { CompanyToken: { type: 'http', scheme: 'bearer', description: 'Company-specific token from login. Enter the token without the Bearer prefix.' } },
        schemas: projectSchemas,
    },
    paths: {
        ...projectPaths,
        '/api/login/login': {
            post: {
                tags: ['Login'],
                summary: 'Log in with username and password',
                description: 'Use a configured companyId, or omit it for multi-company login. Also available at /api/authorization/login and /api/configuration/login/login. Requires the configured SQL Server databases.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['username', 'password'],
                                properties: {
                                    username: { type: 'string' },
                                    password: { type: 'string', format: 'password' },
                                    companyId: { type: 'integer', description: 'Company ID from your server configuration' },
                                },
                            },
                            example: { username: 'your-username', password: 'your-password', companyId: 1 },
                        },
                    },
                },
                responses: {
                    200: { description: 'Login successful. data.currentCompany contains company tokens and identities.' },
                    400: { description: 'Username or password missing' },
                    401: { description: 'Invalid credentials or company configuration' },
                    500: { description: 'Database or internal server error' },
                },
            },
        },
    },
};

export const swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Project Management API - Swagger</title>
  <link rel="stylesheet" href="/api-docs/assets/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <noscript>Enable JavaScript to use Swagger. The specification is at /api-docs/openapi.json.</noscript>
  <script src="/api-docs/assets/swagger-ui-bundle.js"></script>
  <script>
    if (window.SwaggerUIBundle) {
      SwaggerUIBundle({ url: '/api-docs/openapi.json', dom_id: '#swagger-ui', validatorUrl: null });
    } else {
      document.getElementById('swagger-ui').textContent = 'Swagger UI could not load. Check the local package installation. OpenAPI JSON: /api-docs/openapi.json';
    }
  </script>
</body>
</html>`;
