      *================================================================*
      * PROGRAM: RECONCIL.CBL                                          *
      * PURPOSE: BALANCED-LINE MATCH-MERGE RECONCILIATION ENGINE       *
      *          COMPUTATIONAL MATCHING OF CORE VS BANK TRANSACTIONS.  *
      *          PERFORMS RANDOM READ LOOKUP IN VSAM KSDS ACCTMSTR.    *
      *          CLASSIFIES EACH RECORD AS:                            *
      *            - MATCHED                                           *
      *            - AMOUNT-MISMATCH                                   *
      *            - MISSING-IN-BANK                                   *
      *            - MISSING-IN-CORE                                   *
      *            - DUPLICATE                                         *
      *          WRITES DETAILED RESULTS TO RECONOUT AND CONTROL       *
      *          TOTALS TO CTLREC.                                     *
      *================================================================*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RECONCIL.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CORE-IN-FILE ASSIGN TO TXNCORE
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-CORE-STATUS.

           SELECT BANK-IN-FILE ASSIGN TO TXNBNK
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-BANK-STATUS.

           SELECT ACCT-KSDS-FILE ASSIGN TO ACCTMSTR
                  ORGANIZATION IS INDEXED
                  ACCESS MODE IS RANDOM
                  RECORD KEY IS ACCT-NO
                  FILE STATUS IS WS-KSDS-STATUS.

           SELECT RECON-OUT-FILE ASSIGN TO RECONOUT
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.

           SELECT CTL-OUT-FILE ASSIGN TO CTLREC
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-CTL-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  CORE-IN-FILE.
           COPY "TXNREC.cpy".

       FD  BANK-IN-FILE.
           COPY "BNKREC.cpy".

       FD  ACCT-KSDS-FILE.
           COPY "ACCTREC.cpy".

       FD  RECON-OUT-FILE.
           COPY "RECREC.cpy".

       FD  CTL-OUT-FILE.
       01  CTL-RECORD.
           05  CTL-TAG                 PIC X(20).
           05  CTL-COUNT               PIC 9(8).
           05  CTL-AMOUNT              PIC 9(13)V99.
           05  FILLER                  PIC X(37).

       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUSES.
           05  WS-CORE-STATUS          PIC X(2) VALUE "00".
           05  WS-BANK-STATUS          PIC X(2) VALUE "00".
           05  WS-KSDS-STATUS          PIC X(2) VALUE "00".
           05  WS-OUT-STATUS           PIC X(2) VALUE "00".
           05  WS-CTL-STATUS           PIC X(2) VALUE "00".

       01  WS-KEYS.
           05  WS-CORE-KEY             PIC X(28) VALUE HIGH-VALUES.
           05  WS-BANK-KEY             PIC X(28) VALUE HIGH-VALUES.
           05  WS-PREV-CORE-KEY        PIC X(28) VALUE LOW-VALUES.
           05  WS-PREV-BANK-KEY        PIC X(28) VALUE LOW-VALUES.

       01  WS-FLAGS.
           05  WS-CORE-EOF             PIC X(1) VALUE 'N'.
               88  CORE-EOF-YES        VALUE 'Y'.
               88  CORE-EOF-NO         VALUE 'N'.
           05  WS-BANK-EOF             PIC X(1) VALUE 'N'.
               88  BANK-EOF-YES        VALUE 'Y'.
               88  BANK-EOF-NO         VALUE 'N'.

       01  WS-AMOUNTS.
           05  WS-CORE-AMT-NUM         PIC 9(11)V99 VALUE ZERO.
           05  WS-BANK-AMT-NUM         PIC 9(11)V99 VALUE ZERO.
           05  WS-DIFF-AMT-NUM         PIC S9(11)V99 VALUE ZERO.

       01  WS-TOTALS.
           05  WS-CNT-CORE-TOTAL       PIC 9(8) VALUE ZERO.
           05  WS-CNT-BANK-TOTAL       PIC 9(8) VALUE ZERO.
           05  WS-CNT-MATCHED          PIC 9(8) VALUE ZERO.
           05  WS-CNT-MISMATCH         PIC 9(8) VALUE ZERO.
           05  WS-CNT-MISS-BANK        PIC 9(8) VALUE ZERO.
           05  WS-CNT-MISS-CORE        PIC 9(8) VALUE ZERO.
           05  WS-CNT-DUPLICATE        PIC 9(8) VALUE ZERO.
           05  WS-CNT-EXCEPTIONS       PIC 9(8) VALUE ZERO.
           05  WS-AMT-MATCHED          PIC 9(13)V99 VALUE ZERO.
           05  WS-AMT-MISMATCH         PIC 9(13)V99 VALUE ZERO.
           05  WS-AMT-MISS-BANK        PIC 9(13)V99 VALUE ZERO.
           05  WS-AMT-MISS-CORE        PIC 9(13)V99 VALUE ZERO.

       01  WS-SAVED-ACCT-NAME          PIC X(15) VALUE "UNKNOWN ACCT   ".

       PROCEDURE DIVISION.
       0000-MAIN.
           DISPLAY "==================================================".
           DISPLAY "RECONCIL: STARTING TRANSACTION RECONCILIATION".
           DISPLAY "==================================================".

           OPEN INPUT CORE-IN-FILE.
           IF WS-CORE-STATUS NOT = "00"
               DISPLAY "RECONCIL: ERROR OPENING TXNCORE. STATUS=" 
                       WS-CORE-STATUS
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN INPUT BANK-IN-FILE.
           IF WS-BANK-STATUS NOT = "00"
               DISPLAY "RECONCIL: ERROR OPENING TXNBNK. STATUS=" 
                       WS-BANK-STATUS
               CLOSE CORE-IN-FILE
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN INPUT ACCT-KSDS-FILE.
           IF WS-KSDS-STATUS NOT = "00"
               DISPLAY "RECONCIL: WARNING OPENING ACCTMSTR. STATUS=" 
                       WS-KSDS-STATUS
      * Allow execution even if master missing, default name UNKNOWN
           END-IF.

           OPEN OUTPUT RECON-OUT-FILE.
           IF WS-OUT-STATUS NOT = "00"
               DISPLAY "RECONCIL: ERROR OPENING RECONOUT. STATUS=" 
                       WS-OUT-STATUS
               CLOSE CORE-IN-FILE
               CLOSE BANK-IN-FILE
               IF WS-KSDS-STATUS = "00" CLOSE ACCT-KSDS-FILE END-IF
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN OUTPUT CTL-OUT-FILE.
           IF WS-CTL-STATUS NOT = "00"
               DISPLAY "RECONCIL: ERROR OPENING CTLREC. STATUS=" 
                       WS-CTL-STATUS
               CLOSE CORE-IN-FILE
               CLOSE BANK-IN-FILE
               CLOSE RECON-OUT-FILE
               IF WS-KSDS-STATUS = "00" CLOSE ACCT-KSDS-FILE END-IF
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           PERFORM 1000-READ-CORE.
           PERFORM 2000-READ-BANK.

           PERFORM 3000-MATCH-CYCLE UNTIL CORE-EOF-YES AND BANK-EOF-YES.

           PERFORM 4000-WRITE-CONTROL-TOTALS.

           CLOSE CORE-IN-FILE.
           CLOSE BANK-IN-FILE.
           IF WS-KSDS-STATUS = "00" CLOSE ACCT-KSDS-FILE END-IF.
           CLOSE RECON-OUT-FILE.
           CLOSE CTL-OUT-FILE.

           DISPLAY "==================================================".
           DISPLAY "RECONCIL: COMPLETED RECONCILIATION SUMMARY".
           DISPLAY "  TOTAL CORE TXNS  : " WS-CNT-CORE-TOTAL.
           DISPLAY "  TOTAL BANK TXNS  : " WS-CNT-BANK-TOTAL.
           DISPLAY "  MATCHED TXNS     : " WS-CNT-MATCHED.
           DISPLAY "  AMOUNT MISMATCH  : " WS-CNT-MISMATCH.
           DISPLAY "  MISSING IN BANK  : " WS-CNT-MISS-BANK.
           DISPLAY "  MISSING IN CORE  : " WS-CNT-MISS-CORE.
           DISPLAY "  DUPLICATE TXNS   : " WS-CNT-DUPLICATE.
           DISPLAY "  TOTAL EXCEPTIONS : " WS-CNT-EXCEPTIONS.
           DISPLAY "==================================================".

           IF WS-CNT-EXCEPTIONS > ZERO
               DISPLAY "RECONCIL: FINISHED WITH EXCEPTIONS (RC=04)"
               MOVE 4 TO RETURN-CODE
           ELSE
               DISPLAY "RECONCIL: FINISHED CLEAN NO EXCEPTIONS (RC=00)"
               MOVE 0 TO RETURN-CODE
           END-IF.

           GOBACK.

       1000-READ-CORE.
           READ CORE-IN-FILE
               AT END
                   SET CORE-EOF-YES TO TRUE
                   MOVE HIGH-VALUES TO WS-CORE-KEY
               NOT AT END
                   ADD 1 TO WS-CNT-CORE-TOTAL
                   STRING TXN-ACCT-NO TXN-REF DELIMITED BY SIZE
                     INTO WS-CORE-KEY
           END-READ.

       2000-READ-BANK.
           READ BANK-IN-FILE
               AT END
                   SET BANK-EOF-YES TO TRUE
                   MOVE HIGH-VALUES TO WS-BANK-KEY
               NOT AT END
                   ADD 1 TO WS-CNT-BANK-TOTAL
                   STRING BNK-ACCT-NO BNK-REF DELIMITED BY SIZE
                     INTO WS-BANK-KEY
           END-READ.

       3000-MATCH-CYCLE.
      * Check Duplicate in Core
           IF NOT CORE-EOF-YES AND WS-CORE-KEY = WS-PREV-CORE-KEY
               PERFORM 3100-HANDLE-CORE-DUPLICATE
               EXIT PARAGRAPH
           END-IF.

      * Check Duplicate in Bank
           IF NOT BANK-EOF-YES AND WS-BANK-KEY = WS-PREV-BANK-KEY
               PERFORM 3200-HANDLE-BANK-DUPLICATE
               EXIT PARAGRAPH
           END-IF.

           IF WS-CORE-KEY = WS-BANK-KEY
               PERFORM 3300-HANDLE-MATCHED-KEYS
           ELSE
               IF WS-CORE-KEY < WS-BANK-KEY
                   PERFORM 3400-HANDLE-MISSING-IN-BANK
               ELSE
                   PERFORM 3500-HANDLE-MISSING-IN-CORE
               END-IF
           END-IF.

       3100-HANDLE-CORE-DUPLICATE.
           ADD 1 TO WS-CNT-DUPLICATE
           ADD 1 TO WS-CNT-EXCEPTIONS
           MOVE "DUPLICATE         " TO REC-STATUS
           MOVE TXN-ACCT-NO          TO REC-ACCT-NO
           MOVE TXN-REF              TO REC-REF
           MOVE TXN-DATE             TO REC-DATE
           MOVE TXN-AMT              TO REC-CORE-AMT
           MOVE ZERO                 TO REC-BANK-AMT
           MOVE "+"                  TO REC-DIFF-SIGN
           MOVE TXN-AMT              TO REC-DIFF-AMT
           MOVE TXN-CURR             TO REC-CURR
           MOVE TXN-CHAN             TO REC-CHAN
           MOVE "D001"               TO REC-REASON
           PERFORM 5000-LOOKUP-ACCOUNT
           MOVE WS-SAVED-ACCT-NAME   TO REC-ACCT-NAME
           WRITE REC-RECORD
           PERFORM 1000-READ-CORE.

       3200-HANDLE-BANK-DUPLICATE.
           ADD 1 TO WS-CNT-DUPLICATE
           ADD 1 TO WS-CNT-EXCEPTIONS
           MOVE "DUPLICATE         " TO REC-STATUS
           MOVE BNK-ACCT-NO          TO REC-ACCT-NO
           MOVE BNK-REF              TO REC-REF
           MOVE BNK-DATE             TO REC-DATE
           MOVE ZERO                 TO REC-CORE-AMT
           MOVE BNK-AMT              TO REC-BANK-AMT
           MOVE "-"                  TO REC-DIFF-SIGN
           MOVE BNK-AMT              TO REC-DIFF-AMT
           MOVE BNK-CURR             TO REC-CURR
           MOVE BNK-CHAN             TO REC-CHAN
           MOVE "D002"               TO REC-REASON
           MOVE BNK-ACCT-NO          TO ACCT-NO
           PERFORM 5000-LOOKUP-ACCOUNT
           MOVE WS-SAVED-ACCT-NAME   TO REC-ACCT-NAME
           WRITE REC-RECORD
           PERFORM 2000-READ-BANK.

       3300-HANDLE-MATCHED-KEYS.
           MOVE WS-CORE-KEY TO WS-PREV-CORE-KEY
           MOVE WS-BANK-KEY TO WS-PREV-BANK-KEY
           MOVE TXN-ACCT-NO TO ACCT-NO
           PERFORM 5000-LOOKUP-ACCOUNT

           IF TXN-AMT = BNK-AMT
               ADD 1 TO WS-CNT-MATCHED
               ADD TXN-AMT TO WS-AMT-MATCHED
               MOVE "MATCHED           " TO REC-STATUS
               MOVE "0000"               TO REC-REASON
               MOVE "+"                  TO REC-DIFF-SIGN
               MOVE ZERO                 TO REC-DIFF-AMT
           ELSE
               ADD 1 TO WS-CNT-MISMATCH
               ADD 1 TO WS-CNT-EXCEPTIONS
               ADD TXN-AMT TO WS-AMT-MISMATCH
               MOVE "AMOUNT-MISMATCH   " TO REC-STATUS
               MOVE "M001"               TO REC-REASON
               IF TXN-AMT > BNK-AMT
                   MOVE "+" TO REC-DIFF-SIGN
                   COMPUTE WS-DIFF-AMT-NUM = TXN-AMT - BNK-AMT
               ELSE
                   MOVE "-" TO REC-DIFF-SIGN
                   COMPUTE WS-DIFF-AMT-NUM = BNK-AMT - TXN-AMT
               END-IF
               MOVE WS-DIFF-AMT-NUM TO REC-DIFF-AMT
           END-IF

           MOVE TXN-ACCT-NO        TO REC-ACCT-NO
           MOVE TXN-REF            TO REC-REF
           MOVE TXN-DATE           TO REC-DATE
           MOVE TXN-AMT            TO REC-CORE-AMT
           MOVE BNK-AMT            TO REC-BANK-AMT
           MOVE TXN-CURR           TO REC-CURR
           MOVE TXN-CHAN           TO REC-CHAN
           MOVE WS-SAVED-ACCT-NAME TO REC-ACCT-NAME
           WRITE REC-RECORD

           PERFORM 1000-READ-CORE
           PERFORM 2000-READ-BANK.

       3400-HANDLE-MISSING-IN-BANK.
           MOVE WS-CORE-KEY TO WS-PREV-CORE-KEY
           ADD 1 TO WS-CNT-MISS-BANK
           ADD 1 TO WS-CNT-EXCEPTIONS
           ADD TXN-AMT TO WS-AMT-MISS-BANK
           MOVE "MISSING-IN-BANK   " TO REC-STATUS
           MOVE TXN-ACCT-NO          TO REC-ACCT-NO
           MOVE TXN-REF              TO REC-REF
           MOVE TXN-DATE             TO REC-DATE
           MOVE TXN-AMT              TO REC-CORE-AMT
           MOVE ZERO                 TO REC-BANK-AMT
           MOVE "+"                  TO REC-DIFF-SIGN
           MOVE TXN-AMT              TO REC-DIFF-AMT
           MOVE TXN-CURR             TO REC-CURR
           MOVE TXN-CHAN             TO REC-CHAN
           MOVE "B001"               TO REC-REASON
           MOVE TXN-ACCT-NO          TO ACCT-NO
           PERFORM 5000-LOOKUP-ACCOUNT
           MOVE WS-SAVED-ACCT-NAME   TO REC-ACCT-NAME
           WRITE REC-RECORD
           PERFORM 1000-READ-CORE.

       3500-HANDLE-MISSING-IN-CORE.
           MOVE WS-BANK-KEY TO WS-PREV-BANK-KEY
           ADD 1 TO WS-CNT-MISS-CORE
           ADD 1 TO WS-CNT-EXCEPTIONS
           ADD BNK-AMT TO WS-AMT-MISS-CORE
           MOVE "MISSING-IN-CORE   " TO REC-STATUS
           MOVE BNK-ACCT-NO          TO REC-ACCT-NO
           MOVE BNK-REF              TO REC-REF
           MOVE BNK-DATE             TO REC-DATE
           MOVE ZERO                 TO REC-CORE-AMT
           MOVE BNK-AMT              TO REC-BANK-AMT
           MOVE "-"                  TO REC-DIFF-SIGN
           MOVE BNK-AMT              TO REC-DIFF-AMT
           MOVE BNK-CURR             TO REC-CURR
           MOVE BNK-CHAN             TO REC-CHAN
           MOVE "C001"               TO REC-REASON
           MOVE BNK-ACCT-NO          TO ACCT-NO
           PERFORM 5000-LOOKUP-ACCOUNT
           MOVE WS-SAVED-ACCT-NAME   TO REC-ACCT-NAME
           WRITE REC-RECORD
           PERFORM 2000-READ-BANK.

       5000-LOOKUP-ACCOUNT.
           IF WS-KSDS-STATUS = "00"
               READ ACCT-KSDS-FILE
                   INVALID KEY
                       MOVE "UNKNOWN ACCT   " TO WS-SAVED-ACCT-NAME
                   NOT INVALID KEY
                       MOVE ACCT-NAME(1:15) TO WS-SAVED-ACCT-NAME
               END-READ
           ELSE
               MOVE "UNKNOWN ACCT   " TO WS-SAVED-ACCT-NAME
           END-IF.

       4000-WRITE-CONTROL-TOTALS.
           MOVE "TOTAL-CORE-TXN      " TO CTL-TAG
           MOVE WS-CNT-CORE-TOTAL      TO CTL-COUNT
           MOVE ZERO                   TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "TOTAL-BANK-TXN      " TO CTL-TAG
           MOVE WS-CNT-BANK-TOTAL      TO CTL-COUNT
           MOVE ZERO                   TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "MATCHED-TXN         " TO CTL-TAG
           MOVE WS-CNT-MATCHED         TO CTL-COUNT
           MOVE WS-AMT-MATCHED         TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "AMOUNT-MISMATCH     " TO CTL-TAG
           MOVE WS-CNT-MISMATCH        TO CTL-COUNT
           MOVE WS-AMT-MISMATCH        TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "MISSING-IN-BANK     " TO CTL-TAG
           MOVE WS-CNT-MISS-BANK       TO CTL-COUNT
           MOVE WS-AMT-MISS-BANK       TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "MISSING-IN-CORE     " TO CTL-TAG
           MOVE WS-CNT-MISS-CORE       TO CTL-COUNT
           MOVE WS-AMT-MISS-CORE       TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "DUPLICATE-TXN       " TO CTL-TAG
           MOVE WS-CNT-DUPLICATE       TO CTL-COUNT
           MOVE ZERO                   TO CTL-AMOUNT
           WRITE CTL-RECORD

           MOVE "TOTAL-EXCEPTIONS    " TO CTL-TAG
           MOVE WS-CNT-EXCEPTIONS      TO CTL-COUNT
           MOVE ZERO                   TO CTL-AMOUNT
           WRITE CTL-RECORD.
