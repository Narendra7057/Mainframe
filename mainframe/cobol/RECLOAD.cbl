      *================================================================*
      * PROGRAM: RECLOAD.CBL                                           *
      * PURPOSE: DB2 INGESTION PREPARATION (EMULATED VIA UNLOAD FILE)  *
      *          READS RECONCILIATION RESULTS (RECONOUT) AND           *
      *          PRODUCES STRUCTURED UNLOAD DATASET (DBLOAD) TO BE     *
      *          INGESTED INTO RECON_RESULT AND RECON_AUDIT TABLES.    *
      *================================================================*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RECLOAD.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT RECON-IN-FILE ASSIGN TO RECONIN
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-IN-STATUS.

           SELECT DB-LOAD-FILE ASSIGN TO DBLOAD
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  RECON-IN-FILE.
           COPY "RECREC.cpy".

       FD  DB-LOAD-FILE.
       01  LOAD-RECORD.
           05  LOAD-TYPE               PIC X(10).
           05  LOAD-DELIM1             PIC X(1) VALUE "|".
           05  LOAD-DATA               PIC X(180).

       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUSES.
           05  WS-IN-STATUS            PIC X(2) VALUE "00".
           05  WS-OUT-STATUS           PIC X(2) VALUE "00".

       01  WS-COUNTERS.
           05  WS-ROWS-LOADED          PIC 9(6) VALUE ZERO.

       01  WS-FLAGS.
           05  WS-EOF-IN               PIC X(1) VALUE 'N'.
               88  EOF-IN-YES          VALUE 'Y'.
               88  EOF-IN-NO           VALUE 'N'.

       01  WS-DATE-TIME.
           05  WS-CURRENT-DATE         PIC 9(8).
           05  WS-CURRENT-TIME         PIC 9(8).

       PROCEDURE DIVISION.
       0000-MAIN.
           DISPLAY "==================================================".
           DISPLAY "RECLOAD: PREPARING DATABASE INGESTION STREAM".
           DISPLAY "==================================================".

           OPEN INPUT RECON-IN-FILE.
           IF WS-IN-STATUS NOT = "00"
               DISPLAY "RECLOAD: ERROR OPENING RECONIN. STATUS=" 
                       WS-IN-STATUS
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN OUTPUT DB-LOAD-FILE.
           IF WS-OUT-STATUS NOT = "00"
               DISPLAY "RECLOAD: ERROR OPENING DBLOAD. STATUS=" 
                       WS-OUT-STATUS
               CLOSE RECON-IN-FILE
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           PERFORM 1000-PROCESS-RESULTS UNTIL EOF-IN-YES.

      * Write Audit Record
           MOVE "AUDIT" TO LOAD-TYPE
           STRING "JOB=BANKRECN|ROWS=" WS-ROWS-LOADED 
                  "|STATUS=LOADED|SYSTEM=GNUCBO-MFR" 
                  DELIMITED BY SIZE INTO LOAD-DATA
           WRITE LOAD-RECORD.

           CLOSE RECON-IN-FILE.
           CLOSE DB-LOAD-FILE.

           DISPLAY "RECLOAD: DATABASE INGEST DATASET GENERATED".
           DISPLAY "  ROWS PREPARED   : " WS-ROWS-LOADED.
           DISPLAY "==================================================".

           MOVE 0 TO RETURN-CODE.
           GOBACK.

       1000-PROCESS-RESULTS.
           READ RECON-IN-FILE
               AT END
                   SET EOF-IN-YES TO TRUE
               NOT AT END
                   ADD 1 TO WS-ROWS-LOADED
                   MOVE "RESULT" TO LOAD-TYPE
                   STRING REC-STATUS "|"
                          REC-ACCT-NO "|"
                          REC-REF "|"
                          REC-DATE "|"
                          REC-CORE-AMT "|"
                          REC-BANK-AMT "|"
                          REC-DIFF-SIGN "|"
                          REC-DIFF-AMT "|"
                          REC-CURR "|"
                          REC-CHAN "|"
                          REC-REASON "|"
                          REC-ACCT-NAME
                          DELIMITED BY SIZE INTO LOAD-DATA
                   WRITE LOAD-RECORD
           END-READ.
