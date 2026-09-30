/**
 * Mainframe Runtime Automated Test Suite
 * Tests:
 * 1. Catalog DISP, DCB, and GDG semantics
 * 2. IDCAMS, IEFBR14, SORT, IEBGENER utility execution
 * 3. COBOL unit tests (ACCTINIT, TXNVALID, RECONCIL, RECLOAD, RECRPT)
 * 4. Full BANKRECN end-to-end reconciliation job execution
 */
const fs = require('fs');
const path = require('path');
const { CatalogManager } = require('./runner/catalog');
const { JCLParser } = require('./runner/jcl-parser');
const { JCLRunner } = require('./runner/jcl-runner');

async function runTests() {
  console.log('================================================================');
  console.log('MAINFRAME RECONCILIATION SYSTEM - AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  const runner = new JCLRunner();
  const catalog = runner.catalog;

  // -------------------------------------------------------------
  // TEST GROUP 1: Catalog & Dataset Operations
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Catalog & Dataset Operations ---');

  // Test 1.1: Allocate new dataset via IEFBR14
  const jclAlloc = `
//ALLOC01 JOB (ACCT01),'ALLOC TEST',CLASS=A
//STEP01  EXEC PGM=IEFBR14
//MYDSN   DD DSN=BANK.TEST.PS01,
//           DISP=(NEW,CATLG,DELETE),
//           SPACE=(TRK,(5,2)),
//           DCB=(RECFM=FB,LRECL=80,BLKSIZE=800)
  `;
  const resAlloc = await runner.submitJob(jclAlloc);
  assert(resAlloc.maxRC === 0, 'IEFBR14 allocated BANK.TEST.PS01 with RC=0');
  const catEntries = catalog.listCatalog('BANK.TEST.PS01');
  assert(catEntries.length > 0 && catEntries[0].name === 'BANK.TEST.PS01', 'Dataset cataloged correctly');

  // Test 1.2: NEW fails if dataset already exists
  const jclDup = `
//DUP01  JOB (ACCT01),'DUP TEST',CLASS=A
//STEP01 EXEC PGM=IEFBR14
//MYDSN  DD DSN=BANK.TEST.PS01,DISP=(NEW,CATLG,DELETE)
  `;
  const resDup = await runner.submitJob(jclDup);
  assert(resDup.status === 'ABENDED' && resDup.maxRC === 16, 'DISP=NEW on existing dataset correctly ABENDs with JCL ERROR');

  // Test 1.3: OLD fails if dataset not found
  const jclMissing = `
//MISS01 JOB (ACCT01),'MISS TEST',CLASS=A
//STEP01 EXEC PGM=IEFBR14
//MYDSN  DD DSN=BANK.NONEXISTENT.DSN,DISP=SHR
  `;
  const resMiss = await runner.submitJob(jclMissing);
  assert(resMiss.status === 'ABENDED' && resMiss.maxRC === 16, 'DISP=SHR on non-existent dataset correctly ABENDs');

  // Test 1.4: Bad DCB (BLKSIZE not multiple of LRECL for FB)
  const jclBadDCB = `
//BADC01 JOB (ACCT01),'BADC TEST',CLASS=A
//STEP01 EXEC PGM=IEFBR14
//MYDSN  DD DSN=BANK.TEST.BADDCB,
//          DISP=(NEW,CATLG,DELETE),
//          DCB=(RECFM=FB,LRECL=80,BLKSIZE=850)
  `;
  const resBadDCB = await runner.submitJob(jclBadDCB);
  assert(resBadDCB.status === 'ABENDED', 'Inconsistent DCB (BLKSIZE % LRECL != 0) correctly caught');

  // Test 1.5: IDCAMS DEFINE CLUSTER & DEFINE GDG
  const jclIdcams = `
//IDC01  JOB (ACCT01),'IDCAMS TEST',CLASS=A
//STEP01 EXEC PGM=IDCAMS
//SYSPRINT DD SYSOUT=*
//SYSIN  DD *
  DEFINE CLUSTER -
    (NAME(BANK.TEST.KSDS01) -
     KEYS(12 0) -
     RECORDSIZE(80 80) -
     VOLUMES(WORK01))
  DEFINE GDG -
    (NAME(BANK.TEST.GDGBASE) -
     LIMIT(3) -
     SCRATCH)
/*
  `;
  const resIdcams = await runner.submitJob(jclIdcams);
  assert(resIdcams.maxRC === 0, 'IDCAMS DEFINE CLUSTER and DEFINE GDG succeeded with RC=0');

  // Test 1.6: GDG (+1) Generation and Rollover
  const jclGdg1 = `
//GDG01  JOB (ACCT01),'GDG TEST',CLASS=A
//STEP01 EXEC PGM=IEFBR14
//GDGOUT DD DSN=BANK.TEST.GDGBASE(+1),
//          DISP=(NEW,CATLG,DELETE),
//          DCB=(RECFM=FB,LRECL=80,BLKSIZE=800)
  `;
  await runner.submitJob(jclGdg1);
  const gdgRead = catalog.readDataset('BANK.TEST.GDGBASE(0)');
  assert(gdgRead.name === 'BANK.TEST.GDGBASE.G0001V00', 'GDG (+1) created and resolved to G0001V00 as generation (0)');

  // -------------------------------------------------------------
  // TEST GROUP 2: Seed Data Loading & Initialization
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Account Master VSAM Initialization ---');

  // Allocate seed dataset and copy seed records
  catalog.allocateDataset({
    name: 'BANK.PROD.ACCTIN',
    dcb: { recfm: 'FB', lrecl: 80, blksize: 800 },
    disp: ['NEW', 'CATLG', 'DELETE']
  });
  const seedFile = path.join(__dirname, 'testdata', 'ACCTMSTR_SEED.dat');
  const seedRecords = fs.readFileSync(seedFile, 'utf8').split(/\r?\n/).filter(l => l.length > 0);
  catalog.writeDataset('BANK.PROD.ACCTIN', seedRecords, false);

  // Define VSAM KSDS BANK.PROD.ACCTMSTR
  catalog.defineCluster({
    name: 'BANK.PROD.ACCTMSTR',
    keys: { length: 12, offset: 0 },
    recordsize: { avg: 80, max: 80 },
    volumes: ['WORK01']
  });

  // Run ACCTINIT job
  const jclAcctInit = `
//INITVSAM JOB (ACCT01),'INIT VSAM',CLASS=A
//STEP01   EXEC PGM=ACCTINIT
//ACCTIN   DD DSN=BANK.PROD.ACCTIN,DISP=SHR
//ACCTMSTR DD DSN=BANK.PROD.ACCTMSTR,DISP=SHR
//SYSOUT   DD SYSOUT=*
  `;
  const resAcctInit = await runner.submitJob(jclAcctInit);
  assert(resAcctInit.maxRC === 0, 'ACCTINIT loaded VSAM KSDS with RC=0');
  const acctMstr = catalog.readDataset('BANK.PROD.ACCTMSTR', 10);
  assert(acctMstr.totalRecords === seedRecords.length, `VSAM KSDS contains ${seedRecords.length} account master records`);

  // -------------------------------------------------------------
  // TEST GROUP 3: Transaction Validation & Planted Error Handling
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Transaction Validation (TXNVALID) ---');

  // Allocate BANK.PROD.CORETXN and copy test inputs
  catalog.allocateDataset({ name: 'BANK.PROD.CORETXN', dcb: { recfm: 'FB', lrecl: 80, blksize: 800 } });
  const coreTestFile = path.join(__dirname, 'testdata', 'CORETXN_INPUT.dat');
  const coreInputLines = fs.readFileSync(coreTestFile, 'utf8').split(/\r?\n/).filter(l => l.length > 0);
  catalog.writeDataset('BANK.PROD.CORETXN', coreInputLines, false);

  // Allocate BANK.PROD.BANKTXN and copy test inputs
  catalog.allocateDataset({ name: 'BANK.PROD.BANKTXN', dcb: { recfm: 'FB', lrecl: 80, blksize: 800 } });
  const bankTestFile = path.join(__dirname, 'testdata', 'BANKTXN_INPUT.dat');
  const bankInputLines = fs.readFileSync(bankTestFile, 'utf8').split(/\r?\n/).filter(l => l.length > 0);
  catalog.writeDataset('BANK.PROD.BANKTXN', bankInputLines, false);

  // Run TXNVALID standalone test
  const jclVal = `
//TESTVAL  JOB (ACCT01),'VAL TEST',CLASS=A
//STEP01   EXEC PGM=TXNVALID
//TXNIN    DD DSN=BANK.PROD.CORETXN,DISP=SHR
//TXNGOO   DD DSN=BANK.TEST.GOOD,DISP=(NEW,CATLG,DELETE),DCB=(RECFM=FB,LRECL=80,BLKSIZE=800)
//TXNREJ   DD DSN=BANK.TEST.REJ,DISP=(NEW,CATLG,DELETE),DCB=(RECFM=FB,LRECL=120,BLKSIZE=1200)
//SYSOUT   DD SYSOUT=*
  `;
  const resVal = await runner.submitJob(jclVal);
  assert(resVal.maxRC === 4, 'TXNVALID detected planted errors and returned RC=04 (warnings)');
  const valRej = catalog.readDataset('BANK.TEST.REJ', 0);
  assert(valRej.records.length === 6, 'TXNVALID correctly isolated 6 planted reject records');

  // Test empty file scenario (RC=12)
  catalog.allocateDataset({ name: 'BANK.TEST.EMPTY', dcb: { recfm: 'FB', lrecl: 80, blksize: 800 } });
  catalog.writeDataset('BANK.TEST.EMPTY', [], false);
  const jclEmpty = `
//TESTEMP  JOB (ACCT01),'EMPTY TEST',CLASS=A
//STEP01   EXEC PGM=TXNVALID
//TXNIN    DD DSN=BANK.TEST.EMPTY,DISP=SHR
//TXNGOO   DD DSN=BANK.TEST.EMPGOO,DISP=(NEW,CATLG,DELETE)
//TXNREJ   DD DSN=BANK.TEST.EMPREJ,DISP=(NEW,CATLG,DELETE)
//SYSOUT   DD SYSOUT=*
  `;
  const resEmpty = await runner.submitJob(jclEmpty);
  assert(resEmpty.maxRC === 12, 'TXNVALID correctly returned RC=12 on empty input file');

  // -------------------------------------------------------------
  // TEST GROUP 4: Full Nightly BANKRECN Job Stream Execution
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Full BANKRECN End-to-End Execution ---');

  // Define GDG base for reports
  catalog.defineGDG('BANK.PROD.RECON.RPTSUM', 5, true);
  catalog.defineGDG('BANK.PROD.RECON.RPTMAT', 5, true);
  catalog.defineGDG('BANK.PROD.RECON.RPTEXC', 5, true);
  catalog.defineGDG('BANK.PROD.RECON.RPTREJ', 5, true);

  const bankrecnTemplate = fs.readFileSync(path.join(__dirname, 'jcl', 'BANKRECN.jcl.tmpl'), 'utf8');
  const resBankRecn = await runner.submitJob(bankrecnTemplate, { ENV: 'PROD', BUSDATE: '20260930' });

  console.log(`\nBANKRECN Job Completed: Status=${resBankRecn.status}, MAXCC=${resBankRecn.maxRC}`);
  resBankRecn.steps.forEach(s => {
    console.log(`  Step ${s.stepName.padEnd(10)} PGM=${(s.pgm || '').padEnd(10)} Status=${s.status.padEnd(10)} RC=${s.returnCode !== null ? s.returnCode : '-'}`);
  });

  assert(resBankRecn.status === 'COMPLETED', 'BANKRECN job completed without ABEND');
  assert(resBankRecn.maxRC === 4, 'BANKRECN returned MAXCC=04 (clean run with expected exceptions/rejects)');

  // Verify Reconciliation Result Records
  const reconResults = catalog.readDataset('BANK.PROD.RECON.RESULTS', 0);
  assert(reconResults.records.length > 0, `RECON.RESULTS contains ${reconResults.records.length} classified records`);

  // Verify Reports in GDG
  const rptSum = catalog.readDataset('BANK.PROD.RECON.RPTSUM(0)', 0);
  assert(rptSum.records.length > 5, 'Summary Report generated in GDG generation (0)');

  const rptMat = catalog.readDataset('BANK.PROD.RECON.RPTMAT(0)', 0);
  assert(rptMat.records.length > 5, 'Matched Transactions Report generated');

  const rptExc = catalog.readDataset('BANK.PROD.RECON.RPTEXC(0)', 0);
  assert(rptExc.records.length > 5, 'Exception Report generated with VSAM account lookups');

  // Verify DB2 / SQLite Ingestion
  const { ResultsDatabase } = require('../backend/db');
  const db = new ResultsDatabase();
  const summaryStats = db.getSummaryStats();
  assert(summaryStats.total > 0, `RECON_RESULT table successfully populated with ${summaryStats.total} rows`);

  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  return failed === 0;
}

runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
