const str = (maxLength) => ({ type: 'string', maxLength });
const id = { type: 'integer', minimum: 1, maximum: 2147483647 };
const stageId = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'JavaScript-safe BIGINT matching tbl_Project_Stage.Id.' };
const object = (properties, required = []) => ({ type: 'object', properties, required });
const projectExample = {
    Project_Id: 1, Project_Name: 'PURCHASE WORK', Project_Desc: null, Company_id: 1, Project_Head: 13,
    Est_Start_Dt: '2026-05-01T00:00:00.000Z', Est_End_Dt: '2027-03-31T00:00:00.000Z',
    Project_Status: 1, Entry_By: 1, Entry_Date: '2026-05-07T10:02:43.762Z',
    Update_By: null, Update_Date: null, IsActive: 1, Del_Flag: false,
};
const projectDate = { type: 'string', format: 'date-time', nullable: true,
    description: 'Send an ISO 8601 date-time (for example 2026-05-01T00:00:00Z). SQL datetime2 values are returned as JSON date-time strings with millisecond precision.' };
export const projectSchemas = {
    ProjectInput: object({
        Project_Name: { ...str(500), example: 'PURCHASE WORK' }, Project_Desc: { ...str(20000), nullable: true },
        Project_Head: { ...id, nullable: true, example: 13, description: 'Active company-local tbl_Users.UserId.' },
        Est_Start_Dt: { ...projectDate, example: projectExample.Est_Start_Dt }, Est_End_Dt: { ...projectDate, example: projectExample.Est_End_Dt },
        Project_Status: { type: 'integer', minimum: 0, default: 0, example: 1, description: 'Numeric project status; status meanings follow your application.' },
    }, ['Project_Name']),
    Project: {
        ...object({
            Project_Id: { ...id, readOnly: true }, Project_Name: str(500), Project_Desc: { ...str(20000), nullable: true },
            Company_id: { ...id, readOnly: true, description: 'Derived from the authenticated company token.' },
            Project_Head: { ...id, nullable: true }, Est_Start_Dt: projectDate, Est_End_Dt: projectDate,
            Project_Status: { type: 'integer', nullable: true },
            Entry_By: { ...id, nullable: true, readOnly: true, description: 'Authenticated local user at creation.' },
            Entry_Date: { ...projectDate, readOnly: true }, Update_By: { ...id, nullable: true, readOnly: true },
            Update_Date: { ...projectDate, readOnly: true },
            IsActive: { type: 'integer', nullable: true, readOnly: true, description: 'Set to 1 when created.' },
            Del_Flag: { type: 'boolean', readOnly: true, description: 'SQL bit. Set to false on creation; deleted records are excluded from reads.' },
        }),
        description: 'All 14 columns from dbo.tbl_Project_Master. Company, audit and lifecycle fields are server managed.',
        example: projectExample,
    },
    StageInput: object({ Stage_Name: { ...str(200), example: 'Requirements' }, Sort_Order: { type: 'integer', minimum: 0, default: 0 }, IsActive: { type: 'integer', enum: [0, 1], default: 1 } }, ['Stage_Name']),
    TaskTypeInput: object({ Task_Type: { ...str(200), example: 'SDLC - Design' }, stage_Id: { ...stageId, nullable: true, description: 'BIGINT reference to tbl_Project_Stage.Id in this project and company.' }, Status: { type: 'integer', minimum: 0, default: 0 } }, ['Task_Type']),
    TaskType: object({ Task_Type_Id: id, Task_Type: str(200), Project_Id: id,
        stage_Id: { ...stageId, nullable: true }, Status: { type: 'integer', nullable: true },
        Stage_Name: { ...str(200), nullable: true }, Stage_Sort_Order: { type: 'integer', nullable: true },
    }),
    TopicInput: object({ Topic: { ...str(100), example: 'Requirements review' }, Description: str(250), memberIds: { type: 'array', maxItems: 100, items: id, description: 'Company-local tbl_Users.UserId values. The author is added automatically.' } }, ['Topic']),
    TopicUpdateInput: object({ Topic: str(100), Description: str(250) }, ['Topic']),
    MemberInput: object({ User_Id: id }, ['User_Id']),
    MessageInput: object({ Message: { ...str(10000), example: 'Please review the attached requirements.' } }, ['Message']),
    ProjectStage: object({ Id: stageId, Project_Id: id, Company_Id: id, Stage_Name: str(200), Sort_Order: { type: 'integer' }, IsActive: { type: 'boolean' }, CreatedAt: { type: 'string', format: 'date-time' } }),
    ProjectStageFile: object({ Id: { ...id, nullable: true }, Download_Key: { type: 'string', format: 'uuid', nullable: true }, Stage_Id: stageId, Project_Id: id, Company_Id: id, User_Id: id, User_Name: { type: 'string' }, File_Name: str(500), File_Type: str(100), File_Size: { type: 'integer' }, CreatedAt: { type: 'string', format: 'date-time' } }),
    UploadedProjectStageFile: object({ Id: { ...id, nullable: true }, Stage_Id: stageId, Project_Id: id, Company_Id: id, User_Id: id, File_Name: str(500), File_Type: str(100), File_Size: { type: 'integer' }, CreatedAt: { type: 'string', format: 'date-time' } }),
    DiscussionTopic: object({ Id: id, Topic: str(100), Description: str(250), Company_id: id, Project_Id: id, CreatedAt: { type: 'string', format: 'date-time' }, IsActive: { type: 'integer' } }),
    DiscussionGroupMember: object({ Id: id, Topic_Id: id, User_Id: id, User_Name: { type: 'string' } }),
    DiscussionMessage: object({ Id: id, Topic_Id: id, User_Id: id, User_Name: { type: 'string' }, Message: str(10000), CreatedAt: { type: 'string', format: 'date-time' } }),
    DiscussionFile: object({ Id: id, Download_Key: { type: 'string', format: 'uuid', nullable: true }, Topic_Id: id, Project_Id: id, User_Id: id, User_Name: { type: 'string' }, File_Name: str(500), File_Type: str(50), File_Size: { type: 'integer' }, CreatedAt: { type: 'string' } }),
    ApiResponse: object({ success: { type: 'boolean' }, data: { nullable: true, description: 'Requested record, ID, or array of records' }, message: { type: 'string' } }, ['success', 'data', 'message']),
};
const jsonResponse = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } });
const typedDataResponse = (description, data) => ({
    description,
    content: { 'application/json': { schema: object({
        success: { type: 'boolean' }, data, message: { type: 'string' },
    }, ['success', 'data', 'message']) } },
});
const params = (route, paged, searchable = false) => [
    ...[...route.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: name === 'stageId' ? stageId : name === 'fileKey' ? { type: 'string', format: 'uuid' } : id })),
    ...(searchable ? [{ name: 'search', in: 'query', schema: { type: 'string', maxLength: 500, description: 'Case-insensitive substring in project name or description, or a substring of the project ID.' } }] : []),
    ...(paged ? [
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
    ] : []),
];
export const projectPaths = {};
function operation(route, method, tag, summary, schema, paged = false, description = '', searchable = false) {
    const full = '/api/projects' + route;
    const definition = {
        tags: [tag], summary, description,
        security: [{ CompanyToken: [] }], parameters: params(route, paged, searchable),
        responses: {
            [method === 'post' ? 201 : 200]: jsonResponse('Successful response'),
            400: jsonResponse('Invalid request'), 401: jsonResponse('Company login required'),
            403: jsonResponse('Forbidden'), 404: jsonResponse('Resource not found in this project/company'),
            500: jsonResponse('Internal server error'), 503: jsonResponse('Required stage or task-type columns are missing or incompatible in the selected company database'),
        },
    };
    if (schema) definition.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } };
    (projectPaths[full] ??= {})[method] = definition;
    return definition;
}
operation('', 'get', 'Projects', 'List projects in the authenticated company', null, true, 'Search is applied across the complete company project list before pagination.', true);
projectSchemas.ProjectCreateInput = {
    ...projectSchemas.ProjectInput,
    properties: { ...projectSchemas.ProjectInput.properties,
        stages: { type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/StageInput' },
            description: 'Optional stages created with the project in one transaction.' },
    },
};
operation('', 'post', 'Projects', 'Create a project with optional stages', 'ProjectCreateInput', false,
    'Creates the project and supplied stages atomically. A stage failure rolls back the project. Requires compatible stage and task-type tables when stages are supplied. The response includes stages when a nonempty stages array is supplied.');
operation('/{projectId}', 'get', 'Projects', 'Get a project');
operation('/{projectId}', 'put', 'Projects', 'Update project details', 'ProjectInput', false, 'Replace editable details. Supply all values to retain; omitted optional fields are reset. Company and author identities come from the login token.');
// Project endpoints return the complete master record, not only its ID.
for (const [route, method, status, list] of [
    ['/api/projects', 'get', 200, true], ['/api/projects', 'post', 201, false],
    ['/api/projects/{projectId}', 'get', 200, false], ['/api/projects/{projectId}', 'put', 200, false],
]) {
    projectPaths[route][method].responses[status] = {
        description: list ? 'Project master records, newest first' : 'Complete project master record',
        content: { 'application/json': {
            schema: object({ success: { type: 'boolean' }, data: list ? { type: 'array', items: { $ref: '#/components/schemas/Project' } } : { $ref: '#/components/schemas/Project' }, message: { type: 'string' } }, ['success', 'data', 'message']),
            example: { success: true, data: list ? [projectExample] : projectExample, message: method === 'post' ? 'Created successfully' : 'Request successful' },
        } },
    };
}
for (const [route, method] of [['/api/projects', 'post'], ['/api/projects/{projectId}', 'put']]) {
    projectPaths[route][method].requestBody.content['application/json'].example = {
        Project_Name: 'PURCHASE WORK', Project_Desc: null, Project_Head: 13,
        Est_Start_Dt: projectExample.Est_Start_Dt, Est_End_Dt: projectExample.Est_End_Dt, Project_Status: 1,
    };
}
projectPaths['/api/projects'].post.requestBody.content['application/json'].example.stages = [
    { Stage_Name: 'Requirements', Sort_Order: 1, IsActive: 1 },
    { Stage_Name: 'Development', Sort_Order: 2, IsActive: 1 },
];
projectPaths['/api/projects'].post.responses[201].content['application/json'].schema.properties.data = {
    allOf: [{ $ref: '#/components/schemas/Project' }, object({
        stages: { type: 'array', items: { $ref: '#/components/schemas/ProjectStage' } },
    })],
};
const taskTypeList = operation('/{projectId}/task-types', 'get', 'Task types', 'List project task types with mapped stages', null, true,
    'Maps tbl_Task_Type.stage_Id to tbl_Project_Stage.Id within the authenticated company and project. Unassigned or unmatched stages return null Stage_Name and Stage_Sort_Order; task types remain in the list.');
taskTypeList.responses[200] = { description: 'Task types with linked stage details', content: { 'application/json': {
    schema: object({ success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/TaskType' } }, message: { type: 'string' } }, ['success', 'data', 'message']),
    example: { success: true, data: [{ Task_Type_Id: 12, Task_Type: 'UI design', Project_Id: 1,
        stage_Id: 4, Status: 0, Stage_Name: 'Design', Stage_Sort_Order: 4 }], message: 'Request successful' },
} } };
operation('/{projectId}/task-types', 'post', 'Task types', 'Create a task type with an optional stage', 'TaskTypeInput');
operation('/{projectId}/task-types/{taskTypeId}', 'put', 'Task types', 'Update a task type and its stage', 'TaskTypeInput');
operation('/{projectId}/stages', 'get', 'Stages', 'List SDLC stages', null, true);
operation('/{projectId}/stages', 'post', 'Stages', 'Create a project stage', 'StageInput');
operation('/{projectId}/stages/{stageId}', 'get', 'Stages', 'Get a project stage');
operation('/{projectId}/stages/{stageId}', 'put', 'Stages', 'Update a stage', 'StageInput');
operation('/{projectId}/discussions', 'get', 'Discussions', 'List project discussions for the company', null, true, 'Every authenticated user in the owning company can view these project discussions; topic membership is not required.');
operation('/{projectId}/discussions', 'post', 'Discussions', 'Create a project discussion', 'TopicInput', false, 'Creates a project discussion. Every authenticated user in the owning company can view and join it; the creator is retained in the legacy membership table.');
operation('/{projectId}/discussions/{topicId}', 'get', 'Discussions', 'Get a project discussion');
operation('/{projectId}/discussions/{topicId}', 'put', 'Discussions', 'Update a project discussion', 'TopicUpdateInput', false, 'Any authenticated user in the owning company may update the title and description.');
operation('/{projectId}/discussions/{topicId}/members', 'get', 'Discussions', 'List legacy discussion participants', null, true, 'This legacy participant list does not control discussion visibility or access.');
operation('/{projectId}/discussions/{topicId}/members', 'post', 'Discussions', 'Add a legacy participant record', 'MemberInput', false, 'Optional legacy participant metadata; all authenticated company users can already access the discussion. Adding an existing member is idempotent. Returns HTTP 200.').responses[200] = jsonResponse('Membership exists or was added');
delete projectPaths['/api/projects/{projectId}/discussions/{topicId}/members'].post.responses[201];
operation('/{projectId}/discussions/{topicId}/messages', 'get', 'Discussions', 'List discussion messages, newest first', null, true, 'Any authenticated user in the owning company can read the message history.');
operation('/{projectId}/discussions/{topicId}/messages', 'post', 'Discussions', 'Send a discussion message', 'MessageInput', false, 'Any authenticated user in the owning company can send a message.');
for (const [route, tag] of [
    ['/{projectId}/stages/{stageId}/files', 'Stage files'],
    ['/{projectId}/discussions/{topicId}/files', 'Discussion files'],
]) {
    operation(route, 'get', tag, 'List uploaded files', null, true);
    const upload = operation(route, 'post', tag, 'Upload one image or common file', null, false,
        'Select a file as the binary request body, and provide fileName including its extension. Maximum 10 MiB. Send the file MIME type in Content-Type (application/octet-stream is used when unknown). No multipart envelope. Files are stored privately with generated paths and downloaded as attachments. Existing external/legacy file paths are not served by this API.');
    upload.parameters.push({ name: 'fileName', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 500 }, example: 'requirements.png' });
    upload.requestBody = { required: true, content: {
        'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
        'image/*': { schema: { type: 'string', format: 'binary' } },
        'application/*': { schema: { type: 'string', format: 'binary' } },
        '*/*': { schema: { type: 'string', format: 'binary' } },
    } };
    upload.responses[413] = jsonResponse('File exceeds 10 MiB');
    upload.responses[415] = jsonResponse('Use application/octet-stream');
    const download = operation(route + '/{fileId}/download', 'get', tag, 'Download a file attachment');
    download.responses[200] = { description: 'Attachment', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
    const downloadByKey = operation(route + '/key/{fileKey}/download', 'get', tag, 'Download a file attachment by its storage key');
    downloadByKey.responses[200] = { description: 'Attachment', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
}
const stageFilesRoute = projectPaths['/api/projects/{projectId}/stages/{stageId}/files'];
stageFilesRoute.get.responses[200] = typedDataResponse('Stage file metadata, oldest first', {
    type: 'array', items: { $ref: '#/components/schemas/ProjectStageFile' },
});
stageFilesRoute.post.responses[201] = typedDataResponse('Uploaded stage file metadata', {
    $ref: '#/components/schemas/UploadedProjectStageFile',
});
