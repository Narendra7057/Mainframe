      *================================================================*
      * COPYBOOK: TXNREC.CPY                                           *
      * CORE BANKING TRANSACTION RECORD (FB, LRECL=80)                 *
      *================================================================*
       01  TXN-RECORD.
           05  TXN-ACCT-NO             PIC X(12).
           05  TXN-REF                 PIC X(16).
           05  TXN-DATE                PIC 9(8).
           05  TXN-TYPE                PIC X(2).
           05  TXN-AMT                 PIC 9(11)V99.
           05  TXN-CURR                PIC X(3).
           05  TXN-CHAN                PIC X(4).
           05  FILLER                  PIC X(22).
