//IDCDEMO  JOB (ACCT01),'IDCAMS VSAM DEFINITION',CLASS=A,MSGCLASS=X
//*===================================================================*
//* SAMPLE JCL: IDCAMS DEFINE VSAM KSDS CLUSTER & GDG BASE            *
//*===================================================================*
//STEP010  EXEC PGM=IDCAMS
//SYSPRINT DD SYSOUT=*
//SYSIN    DD *
  DEFINE CLUSTER -
    (NAME(BANK.USER.DEMO.KSDS) -
     KEYS(12 0) -
     RECORDSIZE(80 80) -
     VOLUMES(WORK01))
  DEFINE GDG -
    (NAME(BANK.USER.DEMO.GDG) -
     LIMIT(5) -
     SCRATCH)
  LISTCAT ALL
/*
//
