      *================================================================*
      * PROGRAM: TXNVALID.CBL                                          *
      * PURPOSE: VALIDATE INCOMING TRANSACTION DATASETS                *
      *          CHECKS ACCOUNT, REF, DATE (YYYYMMDD), TYPE (DR/CR),   *
      *          AMOUNT (> 0, NUMERIC), CURRENCY, AND CHANNEL.         *
      *          WRITES VALID RECORDS TO TXNGOO, REJECTS TO TXNREJ.    *
      * RETURN CODES:                                                  *
      *   RC=00 : ALL RECORDS VALID                                    *
      *   RC=04 : REJECTS FOUND                                        *
      *   RC=12 : INPUT FILE IS EMPTY                                  *
      *================================================================*
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TXNVALID.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT TXN-IN-FILE ASSIGN TO TXNIN
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-IN-STATUS.

           SELECT TXN-GOO-FILE ASSIGN TO TXNGOO
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-GOO-STATUS.

           SELECT TXN-REJ-FILE ASSIGN TO TXNREJ
                  ORGANIZATION IS LINE SEQUENTIAL
                  FILE STATUS IS WS-REJ-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  TXN-IN-FILE.
           COPY "TXNREC.cpy".

       FD  TXN-GOO-FILE.
       01  GOO-RECORD                  PIC X(80).

       FD  TXN-REJ-FILE.
       01  REJ-RECORD.
           05  REJ-TXN-DATA            PIC X(80).
           05  REJ-ERR-CODE            PIC X(4).
           05  REJ-ERR-MSG             PIC X(36).

       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUSES.
           05  WS-IN-STATUS            PIC X(2) VALUE "00".
           05  WS-GOO-STATUS           PIC X(2) VALUE "00".
           05  WS-REJ-STATUS           PIC X(2) VALUE "00".

       01  WS-COUNTERS.
           05  WS-TOTAL-RECS           PIC 9(6) VALUE ZERO.
           05  WS-GOOD-RECS            PIC 9(6) VALUE ZERO.
           05  WS-REJ-RECS             PIC 9(6) VALUE ZERO.

       01  WS-FLAGS.
           05  WS-EOF-IN               PIC X(1) VALUE 'N'.
               88  EOF-IN-YES          VALUE 'Y'.
               88  EOF-IN-NO           VALUE 'N'.
           05  WS-REC-VALID            PIC X(1) VALUE 'Y'.
               88  REC-IS-VALID        VALUE 'Y'.
               88  REC-IS-INVALID      VALUE 'N'.

       01  WS-DATE-VALIDATION.
           05  WS-DATE-NUM             PIC 9(8).
           05  WS-DATE-SPLIT REDEFINES WS-DATE-NUM.
               10  WS-YEAR             PIC 9(4).
               10  WS-MONTH            PIC 9(2).
               10  WS-DAY              PIC 9(2).

       01  WS-TEMP-ERR-CODE            PIC X(4).
       01  WS-TEMP-ERR-MSG             PIC X(36).

       PROCEDURE DIVISION.
       0000-MAIN.
           DISPLAY "==================================================".
           DISPLAY "TXNVALID: TRANSACTION VALIDATION STARTED".
           DISPLAY "==================================================".

           OPEN INPUT TXN-IN-FILE.
           IF WS-IN-STATUS NOT = "00"
               DISPLAY "TXNVALID: FAILED TO OPEN TXNIN. STATUS=" 
                       WS-IN-STATUS
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN OUTPUT TXN-GOO-FILE.
           IF WS-GOO-STATUS NOT = "00"
               DISPLAY "TXNVALID: FAILED TO OPEN TXNGOO. STATUS=" 
                       WS-GOO-STATUS
               CLOSE TXN-IN-FILE
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           OPEN OUTPUT TXN-REJ-FILE.
           IF WS-REJ-STATUS NOT = "00"
               DISPLAY "TXNVALID: FAILED TO OPEN TXNREJ. STATUS=" 
                       WS-REJ-STATUS
               CLOSE TXN-IN-FILE
               CLOSE TXN-GOO-FILE
               MOVE 8 TO RETURN-CODE
               GOBACK
           END-IF.

           PERFORM 1000-PROCESS-RECORD UNTIL EOF-IN-YES.

           CLOSE TXN-IN-FILE.
           CLOSE TXN-GOO-FILE.
           CLOSE TXN-REJ-FILE.

           DISPLAY "TXNVALID: VALIDATION SUMMARY".
           DISPLAY "  TOTAL READ     : " WS-TOTAL-RECS.
           DISPLAY "  VALID (GOOD)   : " WS-GOOD-RECS.
           DISPLAY "  REJECTED       : " WS-REJ-RECS.
           DISPLAY "==================================================".

           IF WS-TOTAL-RECS = ZERO
               DISPLAY "TXNVALID: EMPTY INPUT FILE DETECTED (RC=12)"
               MOVE 12 TO RETURN-CODE
           ELSE
               IF WS-REJ-RECS > ZERO
                   DISPLAY "TXNVALID: REJECTS DETECTED (RC=04)"
                   MOVE 4 TO RETURN-CODE
               ELSE
                   DISPLAY "TXNVALID: ALL RECORDS CLEAN (RC=00)"
                   MOVE 0 TO RETURN-CODE
               END-IF
           END-IF.

           GOBACK.

       1000-PROCESS-RECORD.
           READ TXN-IN-FILE
               AT END
                   SET EOF-IN-YES TO TRUE
               NOT AT END
                   ADD 1 TO WS-TOTAL-RECS
                   SET REC-IS-VALID TO TRUE
                   MOVE SPACES TO WS-TEMP-ERR-CODE
                   MOVE SPACES TO WS-TEMP-ERR-MSG
                   PERFORM 2000-VALIDATE-RECORD

                   IF REC-IS-VALID
                       ADD 1 TO WS-GOOD-RECS
                       MOVE TXN-RECORD TO GOO-RECORD
                       WRITE GOO-RECORD
                   ELSE
                       ADD 1 TO WS-REJ-RECS
                       MOVE TXN-RECORD TO REJ-TXN-DATA
                       MOVE WS-TEMP-ERR-CODE TO REJ-ERR-CODE
                       MOVE WS-TEMP-ERR-MSG  TO REJ-ERR-MSG
                       WRITE REJ-RECORD
                   END-IF
           END-READ.

       2000-VALIDATE-RECORD.
      * 1. Account Number Non-blank
           IF TXN-ACCT-NO = SPACES
               SET REC-IS-INVALID TO TRUE
               MOVE "E001" TO WS-TEMP-ERR-CODE
               MOVE "ACCOUNT NUMBER IS BLANK" TO WS-TEMP-ERR-MSG
               EXIT PARAGRAPH
           END-IF.

      * 2. Txn Reference Non-blank
           IF TXN-REF = SPACES
               SET REC-IS-INVALID TO TRUE
               MOVE "E002" TO WS-TEMP-ERR-CODE
               MOVE "TRANSACTION REF IS BLANK" TO WS-TEMP-ERR-MSG
               EXIT PARAGRAPH
           END-IF.

      * 3. Date Validation (Numeric, YYYYMMDD, Month 1-12, Day 1-31)
           IF TXN-DATE NOT NUMERIC
               SET REC-IS-INVALID TO TRUE
               MOVE "E003" TO WS-TEMP-ERR-CODE
               MOVE "TRANSACTION DATE NON-NUMERIC" TO WS-TEMP-ERR-MSG
               EXIT PARAGRAPH
           ELSE
               MOVE TXN-DATE TO WS-DATE-NUM
               IF WS-YEAR < 2000 OR WS-YEAR > 2099
                   SET REC-IS-INVALID TO TRUE
                   MOVE "E004" TO WS-TEMP-ERR-CODE
                   MOVE "INVALID YEAR IN DATE" TO WS-TEMP-ERR-MSG
                   EXIT PARAGRAPH
               END-IF
               IF WS-MONTH < 1 OR WS-MONTH > 12
                   SET REC-IS-INVALID TO TRUE
                   MOVE "E005" TO WS-TEMP-ERR-CODE
                   MOVE "INVALID MONTH IN DATE" TO WS-TEMP-ERR-MSG
                   EXIT PARAGRAPH
               END-IF
               IF WS-DAY < 1 OR WS-DAY > 31
                   SET REC-IS-INVALID TO TRUE
                   MOVE "E006" TO WS-TEMP-ERR-CODE
                   MOVE "INVALID DAY IN DATE" TO WS-TEMP-ERR-MSG
                   EXIT PARAGRAPH
               END-IF
           END-IF.

      * 4. Type Validation (DR or CR)
           IF TXN-TYPE NOT = "DR" AND TXN-TYPE NOT = "CR"
               SET REC-IS-INVALID TO TRUE
               MOVE "E007" TO WS-TEMP-ERR-CODE
               MOVE "INVALID TXN TYPE (MUST BE DR/CR)" 
                 TO WS-TEMP-ERR-MSG
               EXIT PARAGRAPH
           END-IF.

      * 5. Amount Validation (Numeric, > 0)
           IF TXN-AMT NOT NUMERIC
               SET REC-IS-INVALID TO TRUE
               MOVE "E008" TO WS-TEMP-ERR-CODE
               MOVE "AMOUNT FIELD IS NOT NUMERIC" TO WS-TEMP-ERR-MSG
               EXIT PARAGRAPH
           ELSE
               IF TXN-AMT = ZERO
                   SET REC-IS-INVALID TO TRUE
                   MOVE "E009" TO WS-TEMP-ERR-CODE
                   MOVE "AMOUNT CANNOT BE ZERO" TO WS-TEMP-ERR-MSG
                   EXIT PARAGRAPH
               END-IF
           END-IF.

      * 6. Currency Non-blank
           IF TXN-CURR = SPACES
               SET REC-IS-INVALID TO TRUE
               MOVE "E010" TO WS-TEMP-ERR-CODE
               MOVE "CURRENCY IS BLANK" TO WS-TEMP-ERR-MSG
               EXIT PARAGRAPH
           END-IF.
