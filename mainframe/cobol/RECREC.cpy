      *================================================================*
      * COPYBOOK: RECREC.CPY                                           *
      * RECONCILIATION RESULT RECORD (FB, LRECL=120)                   *
      *================================================================*
       01  REC-RECORD.
           05  REC-STATUS              PIC X(18).
           05  REC-ACCT-NO             PIC X(12).
           05  REC-REF                 PIC X(16).
           05  REC-DATE                PIC 9(8).
           05  REC-CORE-AMT            PIC 9(11)V99.
           05  REC-BANK-AMT            PIC 9(11)V99.
           05  REC-DIFF-SIGN           PIC X(1).
           05  REC-DIFF-AMT            PIC 9(11)V99.
           05  REC-CURR                PIC X(3).
           05  REC-CHAN                PIC X(4).
           05  REC-REASON              PIC X(4).
           05  REC-ACCT-NAME           PIC X(15).
