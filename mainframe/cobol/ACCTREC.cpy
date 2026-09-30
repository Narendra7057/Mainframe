      *================================================================*
      * COPYBOOK: ACCTREC.CPY                                          *
      * ACCOUNT MASTER RECORD FOR VSAM KSDS (FB, LRECL=80)             *
      * KEY IS ACCT-NO (POSITION 1 TO 12)                              *
      *================================================================*
       01  ACCT-RECORD.
           05  ACCT-NO                 PIC X(12).
           05  ACCT-NAME               PIC X(30).
           05  ACCT-TYPE               PIC X(4).
           05  ACCT-STATUS             PIC X(1).
           05  ACCT-BALANCE            PIC 9(11)V99.
           05  FILLER                  PIC X(20).
