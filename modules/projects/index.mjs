import express from 'express';
import { handle, requireProjectAuth, projectErrorHandler } from './controllers.mjs';

const router = express.Router();
router.use(requireProjectAuth);
router.get('/', handle('projects'));
router.post('/', handle('createProject'));
router.get('/:projectId', handle('project'));
router.put('/:projectId', handle('updateProject'));
router.get('/:projectId/task-types', handle('taskTypes'));
router.post('/:projectId/task-types', handle('createTaskType'));
router.put('/:projectId/task-types/:taskTypeId', handle('updateTaskType'));
router.get('/:projectId/stages', handle('stages'));
router.post('/:projectId/stages', handle('createStage'));
router.get('/:projectId/stages/:stageId', handle('stage'));
router.put('/:projectId/stages/:stageId', handle('updateStage'));
router.get('/:projectId/discussions', handle('topics'));
router.post('/:projectId/discussions', handle('createTopic'));
router.get('/:projectId/discussions/:topicId', handle('topic'));
router.put('/:projectId/discussions/:topicId', handle('updateTopic'));
router.get('/:projectId/discussions/:topicId/members', handle('members'));
router.post('/:projectId/discussions/:topicId/members', handle('addMember'));
router.get('/:projectId/discussions/:topicId/messages', handle('messages'));
router.post('/:projectId/discussions/:topicId/messages', handle('createMessage'));
for (const prefix of ['/:projectId/stages/:stageId/files', '/:projectId/discussions/:topicId/files']) {
    router.get(prefix, handle('files'));
    router.post(prefix, express.raw({ type: '*/*', limit: '10mb' }), handle('upload'));
    router.get(`${prefix}/key/:fileKey/download`, handle('downloadByKey'));
    router.get(`${prefix}/:fileId/download`, handle('download'));
}
router.use(projectErrorHandler);
export default router;
export { projectPaths, projectSchemas } from './openapi.mjs';
