import sql from 'mssql';

const types = {
    companyId: sql.Int, userId: sql.Int, projectId: sql.BigInt, stageId: sql.BigInt,
    topicId: sql.Int, fileId: sql.BigInt, memberId: sql.Int, taskTypeId: sql.Int,
    name: sql.NVarChar(500), description: sql.NVarChar(sql.MAX), head: sql.Int,
    start: sql.DateTime2, end: sql.DateTime2, status: sql.Int,
    stageName: sql.NVarChar(200), sortOrder: sql.Int, active: sql.Int,
    taskType: sql.NVarChar(200), topic: sql.NVarChar(100), topicDescription: sql.NVarChar(250),
    message: sql.NVarChar(sql.MAX), offset: sql.Int, limit: sql.Int,
    fileName: sql.NVarChar(500), filePath: sql.NVarChar(500), fileKey: sql.NVarChar(36), fileType: sql.NVarChar(100), fileSize: sql.BigInt,
    search: sql.NVarChar(500),
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
            Est_Start_Dt, Est_End_Dt, Project_Status, Entry_By, Entry_Date, Update_By, Update_Date, IsActive, Del_Flag             FROM dbo.tbl_Project_Master
            WHERE Company_id=@companyId AND Del_Flag=0
                AND (@search=N'' OR CHARINDEX(LOWER(@search),LOWER(Project_Name))>0
                    OR CHARINDEX(LOWER(@search),LOWER(COALESCE(Project_Desc,N'')))>0
                    OR CHARINDEX(@search,CONVERT(nvarchar(20),Project_Id))>0)
            ORDER BY Project_Id DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createProject(p, connection) {
        return this.query(`INSERT dbo.tbl_Project_Master
            (Project_Name, Project_Desc, Company_id, Project_Head, Est_Start_Dt, Est_End_Dt,
             Project_Status, Entry_By, Entry_Date, IsActive, Del_Flag)
            OUTPUT INSERTED.*
            VALUES (@name,@description,@companyId,@head,@start,@end,@status,@userId,SYSUTCDATETIME(),1,0)`, p, connection);
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
    createStage(p, connection) {
        return this.query(`IF COLUMNPROPERTY(OBJECT_ID(N'dbo.tbl_Project_Stage'),N'Id','IsIdentity')=0
                AND NOT EXISTS (SELECT 1 FROM sys.default_constraints
                    WHERE parent_object_id=OBJECT_ID(N'dbo.tbl_Project_Stage')
                    AND parent_column_id=COLUMNPROPERTY(OBJECT_ID(N'dbo.tbl_Project_Stage'),N'Id','ColumnId'))
                THROW 51001, 'Stage ID generation is missing. Apply 0002_repair_stage_ids.sql to this company database.', 1;
            INSERT dbo.tbl_Project_Stage(Project_Id,Company_Id,Stage_Name,Sort_Order,IsActive,CreatedAt)
            OUTPUT INSERTED.* VALUES(@projectId,@companyId,@stageName,@sortOrder,@active,SYSUTCDATETIME())`, p, connection);
    }
    updateStage(p) {
        return this.query(`UPDATE dbo.tbl_Project_Stage SET Stage_Name=@stageName, Sort_Order=@sortOrder, IsActive=@active
            OUTPUT INSERTED.Id WHERE Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId`, p);
    }
    taskTypes(p) {
        return this.query(`SELECT t.Task_Type_Id, t.Task_Type, t.Project_Id, t.stage_Id, t.Status,
            s.Stage_Name, s.Sort_Order AS Stage_Sort_Order
            FROM dbo.tbl_Task_Type t
            LEFT JOIN dbo.tbl_Project_Stage s ON s.Id=t.stage_Id
                AND s.Project_Id=t.Project_Id AND s.Company_Id=@companyId
            WHERE t.Project_Id=@projectId AND ISNULL(t.TT_Del_Flag,0)=0 ORDER BY t.Task_Type_Id DESC
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
    topics(p) {
        return this.query(`SELECT t.Id,t.Topic,t.Description,t.CreatedAt,t.IsActive,t.Project_Id
            FROM dbo.tbl_Discussion_Topics t WHERE t.Project_Id=@projectId AND t.Company_id=@companyId
            AND t.IsActive=1 ORDER BY t.Id DESC
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
        return this.query(`SELECT m.Id,m.Topic_Id,m.User_Id,
            COALESCE(NULLIF(LTRIM(RTRIM(u.Name)),N''),NULLIF(LTRIM(RTRIM(u.UserName)),N''),CONCAT(N'User #',m.User_Id)) AS User_Name
            FROM dbo.tbl_Discussion_Group_Members m
            LEFT JOIN dbo.tbl_Users u ON u.UserId=m.User_Id
            WHERE m.Topic_Id=@topicId ORDER BY m.Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    messages(p) {
        return this.query(`SELECT m.Id,m.Topic_Id,m.User_Id,
            COALESCE(NULLIF(LTRIM(RTRIM(u.Name)),N''),NULLIF(LTRIM(RTRIM(u.UserName)),N''),CONCAT(N'User #',m.User_Id)) AS User_Name,
            m.Message,m.CreatedAt
            FROM dbo.tbl_Discussion_Messages m
            LEFT JOIN dbo.tbl_Users u ON u.UserId=m.User_Id
            WHERE m.Topic_Id=@topicId ORDER BY m.Id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createMessage(p) {
        return this.query(`INSERT dbo.tbl_Discussion_Messages(Topic_Id,User_Id,Message,CreatedAt)
            OUTPUT INSERTED.Id,INSERTED.CreatedAt VALUES(@topicId,@userId,@message,SYSUTCDATETIME())`, p);
    }
    files(p, stage) {
        return stage
            ? this.query(`SELECT f.Id,RIGHT(f.File_Path,36) AS Download_Key,f.Stage_Id,f.Project_Id,f.Company_Id,f.File_Name,f.File_Type,f.File_Size,f.CreatedAt,f.User_Id,
                    COALESCE(NULLIF(LTRIM(RTRIM(u.Name)),N''),NULLIF(LTRIM(RTRIM(u.UserName)),N''),CONCAT(N'User #',f.User_Id)) AS User_Name
                FROM dbo.tbl_Project_Stage_Files f LEFT JOIN dbo.tbl_Users u ON u.UserId=f.User_Id
                WHERE f.Stage_Id=@stageId AND f.Project_Id=@projectId AND f.Company_Id=@companyId
                ORDER BY f.CreatedAt ASC,f.Id ASC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p)
            : this.query(`SELECT f.Id,RIGHT(f.FIle_Path,36) AS Download_Key,f.File_Name,f.File_Type,f.File_Size,f.CreatedAt,f.User_Id,
                    COALESCE(NULLIF(LTRIM(RTRIM(u.Name)),N''),NULLIF(LTRIM(RTRIM(u.UserName)),N''),CONCAT(N'User #',f.User_Id)) AS User_Name
                FROM dbo.tbl_Discussion_Files f LEFT JOIN dbo.tbl_Users u ON u.UserId=f.User_Id
                WHERE f.Topic_Id=@topicId AND f.Project_Id=@projectId ORDER BY f.Id DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, p);
    }
    createFile(p, stage) {
        return stage
            ? this.query(`INSERT dbo.tbl_Project_Stage_Files(Stage_Id,Project_Id,Company_Id,User_Id,File_Name,File_Path,File_Type,File_Size,CreatedAt)
                OUTPUT INSERTED.Id,INSERTED.Stage_Id,INSERTED.Project_Id,INSERTED.Company_Id,INSERTED.User_Id,
                    INSERTED.File_Name,INSERTED.File_Type,INSERTED.File_Size,INSERTED.CreatedAt
                VALUES(@stageId,@projectId,@companyId,@userId,@fileName,@filePath,@fileType,@fileSize,SYSUTCDATETIME())`, p)
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
    fileByKey(p, stage) {
        return stage
            ? this.query(`SELECT Id,File_Name,File_Path FROM dbo.tbl_Project_Stage_Files
                WHERE RIGHT(File_Path,36)=@fileKey AND Stage_Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId`, p)
            : this.query(`SELECT Id,File_Name,FIle_Path AS File_Path FROM dbo.tbl_Discussion_Files
                WHERE RIGHT(FIle_Path,36)=@fileKey AND Topic_Id=@topicId AND Project_Id=@projectId`, p);
    }
}
