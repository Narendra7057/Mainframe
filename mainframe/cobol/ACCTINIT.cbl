      *================================================================*
      * PROGRAM: ACCTINIT.CBL                                          *
      * PURPOSE: INITIALIZE/LOAD VSAM KSDS ACCOUNT MASTER (ACCTMSTR)   *
      *          FROM SEQUENTIAL SEED DATASET (ACCTIN).                *
      *================================================================*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ACCTINIT.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ACCT-IN-FILE ASSIGN TO ACCTIN
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-IN-STATUS.

           SELECT ACCT-KSDS-FILE ASSIGN TO ACCTMSTR
                  ORGANIZATION IS INDEXED
                  ACCESS MODE IS SEQUENTIAL
                  RECORD KEY IS ACCT-NO
                  FILE STATUS IS WS-KSDS-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  ACCT-IN-FILE.
       01  ACCT-IN-REC.
           05  IN-ACCT-NO              PIC X(12).
           05  IN-ACCT-NAME            PIC X(30).
           05  IN-ACCT-TYPE            PIC X(4).
           05  IN-ACCT-STATUS          PIC X(1).
           05  IN-ACCT-BALANCE         PIC 9(11)V99.
           05  IN-FILLER               PIC X(20).

       FD  ACCT-KSDS-FILE.
           COPY "ACCTREC.cpy".

       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUSES.
           05  WS-IN-STATUS            PIC X(2) VALUE "00".
           05  WS-KSDS-STATUS          PIC X(2) VALUE "00".

       01  WS-COUNTERS.
           05  WS-RECS-READ            PIC 9(6) VALUE ZERO.
           05  WS-RECS-WRITTEN         PIC 9(6) VALUE ZERO.

       01  WS-FLAGS.
           05  WS-EOF-IN               PIC X(1) VALUE 'N'.
               88  EOF-IN-YES          VALUE 'Y'.
               88  EOF-IN-NO           VALUE 'N'.

       PROCEDURE DIVISION.
       0000-MAIN.
           DISPLAY "==================================================".
           DISPLAY "ACCTINIT: STARTING ACCOUNT MASTER KSDS INITIALIZATION".
           DISPLAY "==================================================".

           OPEN INPUT ACCT-IN-FILE.
           IF WS-IN-STATUS NOT = "00"
               DISPLAY "ACCTINIT: ERROR OPENING ACCTIN. STATUS=" 
                       WS-IN-STATUS
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN OUTPUT ACCT-KSDS-FILE.
           IF WS-KSDS-STATUS NOT = "00"
               DISPLAY "ACCTINIT: ERROR OPENING ACCTMSTR KSDS. STATUS=" 
                       WS-KSDS-STATUS
               CLOSE ACCT-IN-FILE
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           PERFORM 1000-PROCESS-RECORDS UNTIL EOF-IN-YES.

           CLOSE ACCT-IN-FILE.
           CLOSE ACCT-KSDS-FILE.

           DISPLAY "ACCTINIT: LOAD COMPLETE.".
           DISPLAY "  RECORDS READ    : " WS-RECS-READ.
           DISPLAY "  RECORDS LOADED  : " WS-RECS-WRITTEN.
           DISPLAY "==================================================".

           IF WS-RECS-WRITTEN = 0
               MOVE 4 TO RETURN-CODE
           ELSE
               MOVE 0 TO RETURN-CODE
           END-IF.

           GOBACK.

       1000-PROCESS-RECORDS.
           READ ACCT-IN-FILE
               AT END
                   SET EOF-IN-YES TO TRUE
               NOT AT END
                   ADD 1 TO WS-RECS-READ
                   MOVE IN-ACCT-NO      TO ACCT-NO
                   MOVE IN-ACCT-NAME    TO ACCT-NAME
                   MOVE IN-ACCT-TYPE    TO ACCT-TYPE
                   MOVE IN-ACCT-STATUS  TO ACCT-STATUS
                   MOVE IN-ACCT-BALANCE TO ACCT-BALANCE
                   MOVE IN-FILLER       TO FILLER IN ACCT-RECORD

                   WRITE ACCT-RECORD
                       INVALID KEY
                           DISPLAY "ACCTINIT: DUPLICATE OR INVALID KEY=" 
                                   ACCT-NO " STATUS=" WS-KSDS-STATUS
                       NOT INVALID KEY
                           ADD 1 TO WS-RECS-WRITTEN
                   END-WRITE
           END-READ.
