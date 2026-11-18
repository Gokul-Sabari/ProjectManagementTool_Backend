-- Run in the intended COMPANY database. Existing non-null IDs are preserved.
-- For a legacy table, run BEFORE bootstrap migration 0001 creates foreign keys.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID(N'dbo.tbl_Project_Stage', N'U') IS NOT NULL
    BEGIN
        DECLARE @maximum bigint;
        SELECT @maximum=MAX(Id) FROM dbo.tbl_Project_Stage WITH (TABLOCKX,HOLDLOCK);
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.tbl_Project_Stage')
            AND name=N'Id' AND system_type_id=127)
            THROW 51002, 'Stage Id must be bigint. Review the schema before repair.', 1;
        IF EXISTS (SELECT Id FROM dbo.tbl_Project_Stage WHERE Id IS NOT NULL GROUP BY Id HAVING COUNT_BIG(*)>1)
            THROW 51002, 'Duplicate stage IDs require manual review before repair.', 1;

        IF COLUMNPROPERTY(OBJECT_ID(N'dbo.tbl_Project_Stage'),N'Id','IsIdentity')=0
        BEGIN
            DECLARE @default nvarchar(max);
            SELECT @default=definition FROM sys.default_constraints
            WHERE parent_object_id=OBJECT_ID(N'dbo.tbl_Project_Stage')
                AND parent_column_id=COLUMNPROPERTY(OBJECT_ID(N'dbo.tbl_Project_Stage'),N'Id','ColumnId');
            IF @default IS NOT NULL AND @default NOT LIKE N'%[[]dbo[]].[[]ProjectStageIdSequence[]]%'
                THROW 51002, 'Unexpected stage ID default. Review before repair.', 1;
            IF @maximum>=9223372036854775807
                THROW 51002, 'Stage ID range is exhausted.', 1;
            IF OBJECT_ID(N'dbo.ProjectStageIdSequence',N'SO') IS NULL
            BEGIN
                DECLARE @start bigint=CASE WHEN ISNULL(@maximum,0)<1 THEN 1 ELSE @maximum+1 END;
                DECLARE @sql nvarchar(max)=N'CREATE SEQUENCE dbo.ProjectStageIdSequence AS bigint START WITH '
                    +CONVERT(nvarchar(30),@start)+N' INCREMENT BY 1 NO CYCLE;';
                EXEC sys.sp_executesql @sql;
            END
            ELSE IF EXISTS (SELECT 1 FROM sys.sequences WHERE object_id=OBJECT_ID(N'dbo.ProjectStageIdSequence')
                AND (CONVERT(bigint,current_value)<ISNULL(@maximum,0) OR increment<>1 OR is_cycling=1))
                THROW 51002, 'Existing sequence is incompatible or behind stored IDs. Review before repair.', 1;
            IF @default IS NULL
                EXEC(N'ALTER TABLE dbo.tbl_Project_Stage ADD CONSTRAINT DF_ProjectStage_Id DEFAULT (NEXT VALUE FOR dbo.ProjectStageIdSequence) FOR Id;');
            EXEC(N'UPDATE dbo.tbl_Project_Stage SET Id=NEXT VALUE FOR dbo.ProjectStageIdSequence WHERE Id IS NULL;');
            IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.tbl_Project_Stage') AND name=N'Id' AND is_nullable=1)
                ALTER TABLE dbo.tbl_Project_Stage ALTER COLUMN Id bigint NOT NULL;
        END;
        IF NOT EXISTS (SELECT 1 FROM sys.indexes i
            WHERE i.object_id=OBJECT_ID(N'dbo.tbl_Project_Stage') AND i.is_unique=1 AND i.has_filter=0 AND i.is_disabled=0
            AND (SELECT COUNT(*) FROM sys.index_columns c WHERE c.object_id=i.object_id AND c.index_id=i.index_id AND c.key_ordinal>0)=1
            AND EXISTS (SELECT 1 FROM sys.index_columns c JOIN sys.columns col ON col.object_id=c.object_id AND col.column_id=c.column_id
                WHERE c.object_id=i.object_id AND c.index_id=i.index_id AND c.key_ordinal=1 AND col.name=N'Id'))
            CREATE UNIQUE INDEX UX_ProjectStage_Id ON dbo.tbl_Project_Stage(Id);
        IF NOT EXISTS (SELECT 1 FROM sys.default_constraints
            WHERE parent_object_id=OBJECT_ID(N'dbo.tbl_Project_Stage')
            AND parent_column_id=COLUMNPROPERTY(OBJECT_ID(N'dbo.tbl_Project_Stage'),N'CreatedAt','ColumnId'))
            ALTER TABLE dbo.tbl_Project_Stage ADD CONSTRAINT DF_ProjectStage_CreatedAt DEFAULT (SYSUTCDATETIME()) FOR CreatedAt;
    END;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
