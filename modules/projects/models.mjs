import sql from 'mssql';

const types = {
    companyId: sql.Int, userId: sql.Int, projectId: sql.BigInt, stageId: sql.Int,
    topicId: sql.Int, fileId: sql.Int, memberId: sql.Int, taskTypeId: sql.Int,
    name: sql.NVarChar(500), description: sql.NVarChar(sql.MAX), head: sql.Int,
    start: sql.DateTime2, end: sql.DateTime2, status: sql.Int,
    stageName: sql.NVarChar(200), sortOrder: sql.Int, active: sql.Int,
    taskType: sql.NVarChar(200), topic: sql.NVarChar(100), topicDescription: sql.NVarChar(250),
    message: sql.NVarChar(sql.MAX), offset: sql.Int, limit: sql.Int,
    fileName: sql.NVarChar(500), filePath: sql.NVarChar(500), fileType: sql.NVarChar(50), fileSize: sql.Int,
};

export class ProjectModel {
    constructor(pool, driver = sql) { this.pool = pool; this.driver = driver; }
    async query(text, params = {}, connection = this.pool) {
        const request = new this.driver.Request(connection);
        for (const [name, value] of Object.entries(params)) request.input(name, types[name], value);
        return (await request.query(text)).recordset || [];
    }
    async transaction(work) {
        const transaction = new this.driver.Transaction(this.pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
            const result = await work(transaction);
            await transaction.commit();
            return result;
        } catch (error) {
            try { await transaction.rollback(); } catch { /* Preserve original failure. */ }
            throw error;
        }
    }
    project(p, connection) {
        return this.query(`SELECT Project_Id, Project_Name, Project_Desc, Company_id, Project_Head,
            Est_Start_Dt, Est_End_Dt, Project_Status, Entry_By, Entry_Date, Update_By, Update_Date, IsActive, Del_Flag
            FROM dbo.tbl_Project_Master WHERE Project_Id=@projectId AND Company_id=@companyId AND Del_Flag=0`, p, connection);
    }
    projects(p) {
        return this.query(`SELECT Project_Id, Project_Name, Project_Desc, Company_id, Project_Head,
            Est_Start_Dt, Est_End_Dt, Project_Status, Entry_By, Entry_Date, Update_By, Update_Date, IsActive, Del_Flag FROM dbo.tbl_Project_Master
            WHERE Company_id=@companyId AND Del_Flag=0 ORDER BY Project_Id DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createProject(p) {
        return this.query(`INSERT dbo.tbl_Project_Master
            (Project_Name, Project_Desc, Company_id, Project_Head, Est_Start_Dt, Est_End_Dt,
             Project_Status, Entry_By, Entry_Date, IsActive, Del_Flag)
            OUTPUT INSERTED.*
            VALUES (@name,@description,@companyId,@head,@start,@end,@status,@userId,SYSUTCDATETIME(),1,0)`, p);
    }
    updateProject(p) {
        return this.query(`UPDATE dbo.tbl_Project_Master SET Project_Name=@name, Project_Desc=@description,
            Project_Head=@head, Est_Start_Dt=@start, Est_End_Dt=@end, Project_Status=@status,
            Update_By=@userId, Update_Date=SYSUTCDATETIME()
            OUTPUT INSERTED.* WHERE Project_Id=@projectId AND Company_id=@companyId AND Del_Flag=0`, p);
    }
    localUser(p, connection) {
        return this.query(`SELECT UserId FROM dbo.tbl_Users WHERE UserId=@memberId
            AND Company_Id=@companyId AND ISNULL(UDel_Flag,0)=0`, p, connection);
    }
    stages(p) {
        return this.query(`SELECT Id, Project_Id, Company_Id, Stage_Name, Sort_Order, IsActive, CreatedAt
            FROM dbo.tbl_Project_Stage WHERE Project_Id=@projectId AND Company_Id=@companyId
            ORDER BY Sort_Order,Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    stage(p) {
        return this.query(`SELECT Id, Stage_Name, Sort_Order, IsActive FROM dbo.tbl_Project_Stage
            WHERE Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId`, p);
    }
    createStage(p) {
        return this.query(`INSERT dbo.tbl_Project_Stage(Project_Id,Company_Id,Stage_Name,Sort_Order)
            OUTPUT INSERTED.Id VALUES(@projectId,@companyId,@stageName,@sortOrder)`, p);
    }
    updateStage(p) {
        return this.query(`UPDATE dbo.tbl_Project_Stage SET Stage_Name=@stageName, Sort_Order=@sortOrder, IsActive=@active
            OUTPUT INSERTED.Id WHERE Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId`, p);
    }
    taskTypes(p) {
        return this.query(`SELECT Task_Type_Id, Task_Type, Project_Id, stage_Id, Status FROM dbo.tbl_Task_Type
            WHERE Project_Id=@projectId AND ISNULL(TT_Del_Flag,0)=0 ORDER BY Task_Type_Id DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createTaskType(p) {
        return this.query(`INSERT dbo.tbl_Task_Type(Task_Type,Project_Id,stage_Id,Status,TT_Del_Flag)
            OUTPUT INSERTED.Task_Type_Id VALUES(@taskType,@projectId,@stageId,@status,0)`, p);
    }
    updateTaskType(p) {
        return this.query(`UPDATE dbo.tbl_Task_Type SET Task_Type=@taskType,stage_Id=@stageId,Status=@status
            OUTPUT INSERTED.Task_Type_Id WHERE Task_Type_Id=@taskTypeId AND Project_Id=@projectId
            AND ISNULL(TT_Del_Flag,0)=0`, p);
    }
    topic(p, connection) {
        return this.query(`SELECT Id,Topic,Description,Company_id,Project_Id,CreatedAt,IsActive
            FROM dbo.tbl_Discussion_Topics WHERE Id=@topicId AND Project_Id=@projectId
            AND Company_id=@companyId AND IsActive=1`, p, connection);
    }
    membership(p, connection) {
        return this.query(`SELECT Id FROM dbo.tbl_Discussion_Group_Members WHERE Topic_Id=@topicId AND User_Id=@userId`, p, connection);
    }
    topics(p) {
        return this.query(`SELECT t.Id,t.Topic,t.Description,t.CreatedAt,t.IsActive,t.Project_Id
            FROM dbo.tbl_Discussion_Topics t WHERE t.Project_Id=@projectId AND t.Company_id=@companyId
            AND t.IsActive=1 AND EXISTS (SELECT 1 FROM dbo.tbl_Discussion_Group_Members m
            WHERE m.Topic_Id=t.Id AND m.User_Id=@userId) ORDER BY t.Id DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createTopic(p, connection) {
        return this.query(`INSERT dbo.tbl_Discussion_Topics(Topic,Description,Company_id,Project_Id,CreatedAt,IsActive)
            OUTPUT INSERTED.Id VALUES(@topic,@topicDescription,@companyId,@projectId,SYSUTCDATETIME(),1)`, p, connection);
    }
    updateTopic(p) {
        return this.query(`UPDATE dbo.tbl_Discussion_Topics SET Topic=@topic,Description=@topicDescription
            OUTPUT INSERTED.Id WHERE Id=@topicId AND Project_Id=@projectId AND Company_id=@companyId AND IsActive=1`, p);
    }
    addMember(p, connection) {
        return this.query(`IF NOT EXISTS (SELECT 1 FROM dbo.tbl_Discussion_Group_Members WITH (UPDLOCK,HOLDLOCK)
            WHERE Topic_Id=@topicId AND User_Id=@memberId)
            INSERT dbo.tbl_Discussion_Group_Members(Topic_Id,User_Id) OUTPUT INSERTED.Id VALUES(@topicId,@memberId)`, p, connection);
    }
    members(p) {
        return this.query(`SELECT Id,Topic_Id,User_Id FROM dbo.tbl_Discussion_Group_Members
            WHERE Topic_Id=@topicId ORDER BY Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    messages(p) {
        return this.query(`SELECT Id,Topic_Id,User_Id,Message,CreatedAt FROM dbo.tbl_Discussion_Messages
            WHERE Topic_Id=@topicId ORDER BY Id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createMessage(p) {
        return this.query(`INSERT dbo.tbl_Discussion_Messages(Topic_Id,User_Id,Message,CreatedAt)
            OUTPUT INSERTED.Id,INSERTED.CreatedAt VALUES(@topicId,@userId,@message,SYSUTCDATETIME())`, p);
    }
    files(p, stage) {
        return stage
            ? this.query(`SELECT Id,File_Name,File_Type,File_Size,CreatedAt,User_Id FROM dbo.tbl_Project_Stage_Files
                WHERE Stage_Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId ORDER BY Id DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p)
            : this.query(`SELECT Id,File_Name,File_Type,File_Size,CreatedAt,User_Id FROM dbo.tbl_Discussion_Files
                WHERE Topic_Id=@topicId AND Project_Id=@projectId ORDER BY Id DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createFile(p, stage) {
        return stage
            ? this.query(`INSERT dbo.tbl_Project_Stage_Files(Stage_Id,Project_Id,Company_Id,User_Id,File_Name,File_Path,File_Type,File_Size)
                OUTPUT INSERTED.Id VALUES(@stageId,@projectId,@companyId,@userId,@fileName,@filePath,@fileType,@fileSize)`, p)
            : this.query(`INSERT dbo.tbl_Discussion_Files(Topic_Id,Project_Id,User_Id,File_Name,FIle_Path,File_Type,File_Size,CreatedAt)
                OUTPUT INSERTED.Id VALUES(@topicId,@projectId,@userId,@fileName,@filePath,@fileType,@fileSize,CONVERT(varchar(50),SYSUTCDATETIME(),127))`, p);
    }
    file(p, stage) {
        return stage
            ? this.query(`SELECT Id,File_Name,File_Path FROM dbo.tbl_Project_Stage_Files
                WHERE Id=@fileId AND Stage_Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId`, p)
            : this.query(`SELECT Id,File_Name,FIle_Path AS File_Path FROM dbo.tbl_Discussion_Files
                WHERE Id=@fileId AND Topic_Id=@topicId AND Project_Id=@projectId`, p);
    }
}
