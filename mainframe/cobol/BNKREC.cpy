      *================================================================*
      * COPYBOOK: BNKREC.CPY                                           *
      * BANK STATEMENT / SWITCH TRANSACTION RECORD (FB, LRECL=80)      *
      *================================================================*
       01  BNK-RECORD.
           05  BNK-ACCT-NO             PIC X(12).
           05  BNK-REF                 PIC X(16).
           05  BNK-DATE                PIC 9(8).
           05  BNK-TYPE                PIC X(2).
           05  BNK-AMT                 PIC 9(11)V99.
           05  BNK-CURR                PIC X(3).
           05  BNK-CHAN                PIC X(4).
           05  FILLER                  PIC X(22).
