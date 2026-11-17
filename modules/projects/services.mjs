import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const uploadRoot = fileURLToPath(new URL('../../uploads/projects/', import.meta.url));
export function apiError(status, message) { return Object.assign(new Error(message), { status }); }
const missing = (name) => apiError(404, `${name} not found`);

export class ProjectService {
    constructor(model, storage = { mkdir, writeFile, unlink, access }) {
        this.model = model;
        this.storage = storage;
    }
    async project(context) {
        const [project] = await this.model.project(context);
        if (!project) throw missing('Project');
        return project;
    }
    async user(context, memberId) {
        if (!(await this.model.localUser({ companyId: context.companyId, memberId })).length)
            throw apiError(400, 'User is not an active user in this company');
    }
    async stage(context) {
        await this.project(context);
        const [stage] = await this.model.stage(context);
        if (!stage) throw missing('Stage');
        return stage;
    }
    async topic(context) {
        await this.project(context);
        const [topic] = await this.model.topic(context);
        if (!topic) throw missing('Discussion');
        if (!(await this.model.membership(context)).length) throw apiError(403, 'Discussion membership required');
        return topic;
    }
    async run(action, context, fields) {
        const p = { ...context, ...fields };
        switch (action) {
            case 'projects': return this.model.projects(p);
            case 'project': return this.project(context);
            case 'stage': return this.stage(context);
            case 'createProject':
                if (p.head) await this.user(context, p.head);
                return (await this.model.createProject(p))[0];
            case 'updateProject':
                await this.project(context);
                if (p.head) await this.user(context, p.head);
                return (await this.model.updateProject(p))[0] || Promise.reject(missing('Project'));
            case 'stages': case 'taskTypes': case 'topics':
                await this.project(context);
                return this.model[action](p);
            case 'createStage':
                await this.project(context);
                return (await this.model.createStage(p))[0];
            case 'updateStage':
                await this.stage(context);
                return (await this.model.updateStage(p))[0] || Promise.reject(missing('Stage'));
            case 'createTaskType': case 'updateTaskType':
                await this.project(context);
                if (p.stageId) await this.stage({ ...context, stageId: p.stageId });
                return (await this.model[action](p))[0] || Promise.reject(missing('Task type'));
            case 'createTopic':
                await this.project(context);
                for (const memberId of p.memberIds) await this.user(context, memberId);
                return this.model.transaction(async (transaction) => {
                    const [topic] = await this.model.createTopic({
                        companyId: p.companyId, projectId: p.projectId, topic: p.topic, topicDescription: p.topicDescription,
                    }, transaction);
                    for (const memberId of new Set([p.userId, ...p.memberIds])) {
                        await this.model.addMember({ topicId: topic.Id, memberId }, transaction);
                    }
                    return topic;
                });
            case 'topic': return this.topic(context);
            case 'updateTopic': case 'members': case 'messages': case 'createMessage':
                await this.topic(context);
                return this.model[action](p);
            case 'addMember':
                await this.topic(context);
                await this.user(context, p.memberId);
                return this.model.transaction(transaction => this.model.addMember({ topicId: p.topicId, memberId: p.memberId }, transaction));
            default: throw new Error('Unknown project operation');
        }
    }
    async files(context, pagination) {
        const stage = Boolean(context.stageId);
        if (stage) await this.stage(context); else await this.topic(context);
        return this.model.files({ ...context, ...pagination }, stage);
    }
    async upload(context, fileName, bytes) {
        const stage = Boolean(context.stageId);
        if (stage) await this.stage(context); else await this.topic(context);
        // The path is generated here; no client-supplied path is ever used.
        const directory = path.join(uploadRoot, String(context.companyId));
        await this.storage.mkdir(directory, { recursive: true });
        const filePath = `${context.companyId}/${randomUUID()}`;
        const absolute = path.join(uploadRoot, filePath);
        await this.storage.writeFile(absolute, bytes, { flag: 'wx' });
        try {
            const [record] = await this.model.createFile({
                ...context, fileName, filePath, fileSize: bytes.length, fileType: 'application/octet-stream',
            }, stage);
            return { ...record, File_Name: fileName, File_Size: bytes.length };
        } catch (error) {
            try { await this.storage.unlink(absolute); } catch (cleanupError) {
                console.error('Upload cleanup failed', { code: cleanupError.code });
            }
            throw error;
        }
    }
    async download(context) {
        const stage = Boolean(context.stageId);
        if (stage) await this.stage(context); else await this.topic(context);
        const [record] = await this.model.file(context, stage);
        if (!record) throw missing('File');
        const relative = record.File_Path;
        if (typeof relative !== 'string' || !new RegExp(`^${context.companyId}/[a-f0-9-]{36}$`).test(relative))
            throw apiError(404, 'File is not in managed upload storage');
        const absolute = path.resolve(uploadRoot, relative);
        if (!absolute.startsWith(path.resolve(uploadRoot) + path.sep)) throw missing('File');
        try { await this.storage.access(absolute); } catch { throw missing('File content'); }
        return { path: absolute, name: record.File_Name };
    }
}
