      *================================================================*
      * PROGRAM: RECRPT.CBL                                            *
      * PURPOSE: PRODUCES FIXED-WIDTH 132-COLUMN MAINFRAME REPORTS:   *
      *          1. RECONCILIATION SUMMARY REPORT (RPTSUM)             *
      *          2. MATCHED TRANSACTIONS REPORT (RPTMAT)               *
      *          3. EXCEPTION REPORT WITH REASONS & VSAM ACCT (RPTEXC) *
      *          4. REJECT / VALIDATION ERROR REPORT (RPTREJ)          *
      *================================================================*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RECRPT.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT RECON-IN-FILE ASSIGN TO RECONIN
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-REC-STATUS.

           SELECT CTL-IN-FILE ASSIGN TO CTLIN
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-CTL-STATUS.

           SELECT REJ-IN-FILE ASSIGN TO REJIN
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-REJ-STATUS.

           SELECT RPT-SUM-FILE ASSIGN TO RPTSUM
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-SUM-STATUS.

           SELECT RPT-MAT-FILE ASSIGN TO RPTMAT
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-MAT-STATUS.

           SELECT RPT-EXC-FILE ASSIGN TO RPTEXC
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-EXC-STATUS.

           SELECT RPT-REJ-FILE ASSIGN TO RPTREJ
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-REJRPT-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  RECON-IN-FILE.
           COPY "RECREC.cpy".

       FD  CTL-IN-FILE.
       01  CTL-IN-REC.
           05  IN-CTL-TAG              PIC X(20).
           05  IN-CTL-COUNT            PIC 9(8).
           05  IN-CTL-AMOUNT           PIC 9(13)V99.
           05  IN-CTL-FILLER           PIC X(37).

       FD  REJ-IN-FILE.
       01  REJ-IN-REC.
           05  IN-REJ-TXN-DATA         PIC X(80).
           05  IN-REJ-ERR-CODE         PIC X(4).
           05  IN-REJ-ERR-MSG          PIC X(36).

       FD  RPT-SUM-FILE.
       01  SUM-PRINT-LINE              PIC X(132).

       FD  RPT-MAT-FILE.
       01  MAT-PRINT-LINE              PIC X(132).

       FD  RPT-EXC-FILE.
       01  EXC-PRINT-LINE              PIC X(132).

       FD  RPT-REJ-FILE.
       01  REJ-PRINT-LINE              PIC X(132).

       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUSES.
           05  WS-REC-STATUS           PIC X(2) VALUE "00".
           05  WS-CTL-STATUS           PIC X(2) VALUE "00".
           05  WS-REJ-STATUS           PIC X(2) VALUE "00".
           05  WS-SUM-STATUS           PIC X(2) VALUE "00".
           05  WS-MAT-STATUS           PIC X(2) VALUE "00".
           05  WS-EXC-STATUS           PIC X(2) VALUE "00".
           05  WS-REJRPT-STATUS        PIC X(2) VALUE "00".

       01  WS-COUNTERS.
           05  WS-PAGE-SUM             PIC 9(4) VALUE 1.
           05  WS-PAGE-MAT             PIC 9(4) VALUE 1.
           05  WS-PAGE-EXC             PIC 9(4) VALUE 1.
           05  WS-PAGE-REJ             PIC 9(4) VALUE 1.
           05  WS-MAT-COUNT            PIC 9(6) VALUE ZERO.
           05  WS-EXC-COUNT            PIC 9(6) VALUE ZERO.
           05  WS-REJ-COUNT            PIC 9(6) VALUE ZERO.

       01  WS-FLAGS.
           05  WS-REC-EOF              PIC X(1) VALUE 'N'.
               88  REC-EOF-YES         VALUE 'Y'.
           05  WS-CTL-EOF              PIC X(1) VALUE 'N'.
               88  CTL-EOF-YES         VALUE 'Y'.
           05  WS-REJ-EOF              PIC X(1) VALUE 'N'.
               88  REJ-EOF-YES         VALUE 'Y'.

       01  WS-FORMATTED-FIELDS.
           05  WS-DISP-COUNT           PIC ZZZ,ZZ9.
           05  WS-DISP-AMT             PIC $ZZZ,ZZZ,ZZ9.99.
           05  WS-DISP-CORE-AMT        PIC $ZZZ,ZZZ,ZZ9.99.
           05  WS-DISP-BANK-AMT        PIC $ZZZ,ZZZ,ZZ9.99.
           05  WS-DISP-DIFF-AMT        PIC $ZZZ,ZZZ,ZZ9.99.

       01  WS-LINE-BUFFER              PIC X(132) VALUE SPACES.

       PROCEDURE DIVISION.
       0000-MAIN.
           DISPLAY "==================================================".
           DISPLAY "RECRPT: STARTING RECONCILIATION REPORT GENERATION".
           DISPLAY "==================================================".

           OPEN INPUT RECON-IN-FILE.
           OPEN OUTPUT RPT-SUM-FILE.
           OPEN OUTPUT RPT-MAT-FILE.
           OPEN OUTPUT RPT-EXC-FILE.

           PERFORM 1000-WRITE-HEADERS.

      * Process Detailed Results (Split into Matched and Exception Reports)
           PERFORM 2000-PROCESS-RESULTS UNTIL REC-EOF-YES.

      * Process Control Totals into Summary Report
           OPEN INPUT CTL-IN-FILE.
           IF WS-CTL-STATUS = "00"
               PERFORM 3000-PROCESS-CONTROL-TOTALS UNTIL CTL-EOF-YES
               CLOSE CTL-IN-FILE
           END-IF.

      * Process Rejects into Reject Report
           OPEN INPUT REJ-IN-FILE.
           IF WS-REJ-STATUS = "00"
               OPEN OUTPUT RPT-REJ-FILE
               PERFORM 4000-WRITE-REJ-HEADER
               PERFORM 4100-PROCESS-REJECTS UNTIL REJ-EOF-YES
               CLOSE REJ-IN-FILE
               CLOSE RPT-REJ-FILE
           END-IF.

           PERFORM 5000-WRITE-FOOTERS.

           CLOSE RECON-IN-FILE.
           CLOSE RPT-SUM-FILE.
           CLOSE RPT-MAT-FILE.
           CLOSE RPT-EXC-FILE.

           DISPLAY "RECRPT: REPORT GENERATION COMPLETED".
           DISPLAY "  MATCHED ROWS    : " WS-MAT-COUNT.
           DISPLAY "  EXCEPTION ROWS  : " WS-EXC-COUNT.
           DISPLAY "  REJECT ROWS     : " WS-REJ-COUNT.
           DISPLAY "==================================================".

           MOVE 0 TO RETURN-CODE.
           GOBACK.

       1000-WRITE-HEADERS.
      * Header for Summary Report
           MOVE SPACES TO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE
           STRING "MAINFRAME BANK - NIGHTLY RECONCILIATION SUMMARY REPORT"
                  "                    PAGE: 0001" 
                  DELIMITED BY SIZE INTO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE
           MOVE ALL "=" TO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE
           STRING "METRIC / CATEGORY              TOTAL COUNT       "
                  "TOTAL AMOUNT ($)      NOTES"
                  DELIMITED BY SIZE INTO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE
           MOVE ALL "-" TO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE.

      * Header for Matched Report
           MOVE SPACES TO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE
           STRING "MAINFRAME BANK - MATCHED TRANSACTIONS REPORT           "
                  "                    PAGE: 0001"
                  DELIMITED BY SIZE INTO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE
           MOVE ALL "=" TO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE
           STRING "ACCOUNT NO   TXN REFERENCE     TXN DATE  "
                  "CORE AMOUNT     BANK AMOUNT     CURR  CHAN  "
                  "ACCOUNT NAME"
                  DELIMITED BY SIZE INTO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE
           MOVE ALL "-" TO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE.

      * Header for Exception Report
           MOVE SPACES TO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE
           STRING "MAINFRAME BANK - TRANSACTION EXCEPTION REPORT          "
                  "                    PAGE: 0001"
                  DELIMITED BY SIZE INTO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE
           MOVE ALL "=" TO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE
           STRING "STATUS              ACCOUNT NO   TXN REFERENCE     "
                  "CORE AMOUNT     BANK AMOUNT     DIFF      "
                  "RSN   ACCOUNT NAME"
                  DELIMITED BY SIZE INTO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE
           MOVE ALL "-" TO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE.

       2000-PROCESS-RESULTS.
           READ RECON-IN-FILE
               AT END
                   SET REC-EOF-YES TO TRUE
               NOT AT END
                   MOVE REC-CORE-AMT TO WS-DISP-CORE-AMT
                   MOVE REC-BANK-AMT TO WS-DISP-BANK-AMT
                   MOVE REC-DIFF-AMT TO WS-DISP-DIFF-AMT

                   IF REC-STATUS(1:7) = "MATCHED"
                       ADD 1 TO WS-MAT-COUNT
                       MOVE SPACES TO MAT-PRINT-LINE
                       STRING REC-ACCT-NO " "
                              REC-REF "  "
                              REC-DATE "  "
                              WS-DISP-CORE-AMT " "
                              WS-DISP-BANK-AMT "   "
                              REC-CURR "   "
                              REC-CHAN "  "
                              REC-ACCT-NAME
                              DELIMITED BY SIZE INTO MAT-PRINT-LINE
                       WRITE MAT-PRINT-LINE
                   ELSE
                       ADD 1 TO WS-EXC-COUNT
                       MOVE SPACES TO EXC-PRINT-LINE
                       STRING REC-STATUS(1:18) "  "
                              REC-ACCT-NO " "
                              REC-REF "  "
                              WS-DISP-CORE-AMT " "
                              WS-DISP-BANK-AMT " "
                              REC-DIFF-SIGN WS-DISP-DIFF-AMT(2:13) " "
                              REC-REASON "  "
                              REC-ACCT-NAME
                              DELIMITED BY SIZE INTO EXC-PRINT-LINE
                       WRITE EXC-PRINT-LINE
                   END-IF
           END-READ.

       3000-PROCESS-CONTROL-TOTALS.
           READ CTL-IN-FILE
               AT END
                   SET CTL-EOF-YES TO TRUE
               NOT AT END
                   MOVE IN-CTL-COUNT  TO WS-DISP-COUNT
                   MOVE IN-CTL-AMOUNT TO WS-DISP-AMT
                   MOVE SPACES TO SUM-PRINT-LINE
                   STRING IN-CTL-TAG " "
                          WS-DISP-COUNT "        "
                          WS-DISP-AMT "     AUDITED TIE-OUT"
                          DELIMITED BY SIZE INTO SUM-PRINT-LINE
                   WRITE SUM-PRINT-LINE
           END-READ.

       4000-WRITE-REJ-HEADER.
           MOVE SPACES TO REJ-PRINT-LINE
           WRITE REJ-PRINT-LINE
           STRING "MAINFRAME BANK - TRANSACTION REJECT / VALIDATION REPORT"
                  "                    PAGE: 0001"
                  DELIMITED BY SIZE INTO REJ-PRINT-LINE
           WRITE REJ-PRINT-LINE
           MOVE ALL "=" TO REJ-PRINT-LINE
           WRITE REJ-PRINT-LINE
           STRING "CODE  ERROR DESCRIPTION               "
                  "REJECTED RECORD DATA"
                  DELIMITED BY SIZE INTO REJ-PRINT-LINE
           WRITE REJ-PRINT-LINE
           MOVE ALL "-" TO REJ-PRINT-LINE
           WRITE REJ-PRINT-LINE.

       4100-PROCESS-REJECTS.
           READ REJ-IN-FILE
               AT END
                   SET REJ-EOF-YES TO TRUE
               NOT AT END
                   ADD 1 TO WS-REJ-COUNT
                   MOVE SPACES TO REJ-PRINT-LINE
                   STRING IN-REJ-ERR-CODE "  "
                          IN-REJ-ERR-MSG "  "
                          IN-REJ-TXN-DATA
                          DELIMITED BY SIZE INTO REJ-PRINT-LINE
                   WRITE REJ-PRINT-LINE
           END-READ.

       5000-WRITE-FOOTERS.
           MOVE ALL "-" TO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE
           MOVE "END OF RECONCILIATION SUMMARY REPORT" TO SUM-PRINT-LINE
           WRITE SUM-PRINT-LINE

           MOVE ALL "-" TO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE
           STRING "TOTAL MATCHED TRANSACTIONS: " WS-MAT-COUNT
                  DELIMITED BY SIZE INTO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE
           MOVE "END OF MATCHED TRANSACTIONS REPORT" TO MAT-PRINT-LINE
           WRITE MAT-PRINT-LINE

           MOVE ALL "-" TO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE
           STRING "TOTAL EXCEPTION TRANSACTIONS: " WS-EXC-COUNT
                  DELIMITED BY SIZE INTO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE
           MOVE "END OF EXCEPTION TRANSACTIONS REPORT" TO EXC-PRINT-LINE
           WRITE EXC-PRINT-LINE.
