-- Apply to each intended COMPANY database, not the portal database.
-- No existing rows are modified. This script is not run automatically by the API.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.tbl_Project_Stage', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tbl_Project_Stage (
        Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Project_Id bigint NOT NULL,
        Company_Id int NOT NULL,
        Stage_Name nvarchar(200) NOT NULL,
        Sort_Order int NOT NULL DEFAULT (0),
        IsActive bit NOT NULL DEFAULT (1),
        CreatedAt datetime2 NOT NULL DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_Project_Stage_Project FOREIGN KEY (Project_Id)
            REFERENCES dbo.tbl_Project_Master(Project_Id)
    );
    CREATE INDEX IX_Project_Stage_Project ON dbo.tbl_Project_Stage(Company_Id, Project_Id, Sort_Order);
END;

IF COL_LENGTH(N'dbo.tbl_Task_Type', N'stage_Id') IS NULL
    ALTER TABLE dbo.tbl_Task_Type ADD stage_Id int NULL;

IF OBJECT_ID(N'dbo.tbl_Project_Stage_Files', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tbl_Project_Stage_Files (
        Id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Stage_Id int NOT NULL,
        Project_Id bigint NOT NULL,
        Company_Id int NOT NULL,
        User_Id int NOT NULL,
        File_Name nvarchar(500) NOT NULL,
        File_Path nvarchar(500) NOT NULL,
        File_Type nvarchar(50) NOT NULL,
        File_Size int NOT NULL,
        CreatedAt datetime2 NOT NULL DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_Project_Stage_Files_Stage FOREIGN KEY (Stage_Id)
            REFERENCES dbo.tbl_Project_Stage(Id)
    );
    CREATE INDEX IX_Project_Stage_Files_Stage ON dbo.tbl_Project_Stage_Files(Company_Id, Project_Id, Stage_Id);
END;

COMMIT TRANSACTION;
