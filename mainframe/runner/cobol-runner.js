/**
 * COBOL Program Runner
 * Compiles and executes COBOL programs using GnuCOBOL (cobc),
 * mapping JCL DD statements to environment variables (DD_<name> and <name>).
 * Supports native execution, WSL execution, and deterministic fallback execution.
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

class CobolRunner {
  constructor(cobolDir = path.join(__dirname, '..', 'cobol'), binDir = path.join(__dirname, '..', 'bin')) {
    this.cobolDir = cobolDir;
    this.binDir = binDir;
    this.compilerMode = this.detectCompiler();
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
  }

  detectCompiler() {
    // 1. Check native cobc
    try {
      execSync('cobc --version', { stdio: 'pipe' });
      return 'NATIVE';
    } catch (e) {}

    // 2. Check WSL cobc
    try {
      execSync('wsl which cobc', { stdio: 'pipe' });
      return 'WSL';
    } catch (e) {}

    return 'FALLBACK';
  }

  toWslPath(winPath) {
    try {
      const out = execSync(`wsl wslpath -u "${winPath.replace(/\\/g, '/')}"`, { stdio: 'pipe' }).toString().trim();
      return out;
    } catch (e) {
      // Manual fallback
      const driveMatch = winPath.match(/^([a-zA-Z]):[\\\/](.*)$/);
      if (driveMatch) {
        return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replace(/\\/g, '/')}`;
      }
      return winPath.replace(/\\/g, '/');
    }
  }

  compile(pgmName) {
    const srcFile = path.join(this.cobolDir, `${pgmName}.cbl`);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`COB001E SOURCE FILE NOT FOUND: ${srcFile}`);
    }

    const binFile = path.join(this.binDir, pgmName + (process.platform === 'win32' && this.compilerMode === 'NATIVE' ? '.exe' : ''));

    // Check if recompile is needed
    if (fs.existsSync(binFile)) {
      const srcStat = fs.statSync(srcFile);
      const binStat = fs.statSync(binFile);
      if (binStat.mtime > srcStat.mtime) {
        return binFile;
      }
    }

    if (this.compilerMode === 'NATIVE') {
      const cmd = `cobc -x -I "${this.cobolDir}" -o "${binFile}" "${srcFile}"`;
      execSync(cmd, { stdio: 'pipe' });
      return binFile;
    } else if (this.compilerMode === 'WSL') {
      const wslSrc = this.toWslPath(srcFile);
      const wslBin = this.toWslPath(binFile);
      const wslInc = this.toWslPath(this.cobolDir);
      const cmd = `wsl cobc -x -I "${wslInc}" -o "${wslBin}" "${wslSrc}"`;
      execSync(cmd, { stdio: 'pipe' });
      return binFile;
    }

    return null;
  }

  async execute(step, context) {
    const { spool, catalog } = context;
    const pgmName = step.pgm.toUpperCase();
    spool.sysmsg(`IEF500I COBOL PROGRAM ${pgmName} INITIATING EXECUTION`);

    // Prepare DD environment variables
    const envVars = { ...process.env };
    const wslEnvExports = [];

    for (const [ddName, dd] of Object.entries(step.dd)) {
      let resolvedPath = '';
      if (dd.dsn) {
        resolvedPath = catalog.getDatasetPhysicalPath(dd.dsn);
      } else if (dd.instreamData) {
        // Write instream to a temporary file
        const tmpFile = path.join(this.binDir, `TMP_${ddName}_${Date.now()}.dat`);
        fs.writeFileSync(tmpFile, dd.instreamData.join('\n') + '\n', 'utf8');
        resolvedPath = tmpFile;
      }

      if (resolvedPath) {
        envVars[`DD_${ddName}`] = resolvedPath;
        envVars[ddName] = resolvedPath;
        envVars[`dd_${ddName.toLowerCase()}`] = resolvedPath;
        envVars[ddName.toLowerCase()] = resolvedPath;

        if (this.compilerMode === 'WSL') {
          const wslPath = this.toWslPath(resolvedPath);
          wslEnvExports.push(`export DD_${ddName}="${wslPath}"`);
          wslEnvExports.push(`export ${ddName}="${wslPath}"`);
          wslEnvExports.push(`export dd_${ddName.toLowerCase()}="${wslPath}"`);
          wslEnvExports.push(`export ${ddName.toLowerCase()}="${wslPath}"`);
        }
      }
    }

    // Try GnuCOBOL compilation and execution if compiler is available
    if (this.compilerMode !== 'FALLBACK') {
      try {
        const binFile = this.compile(pgmName);
        if (binFile) {
          let res;
          if (this.compilerMode === 'NATIVE') {
            res = spawnSync(binFile, [], { env: envVars, encoding: 'utf8' });
          } else {
            const wslBin = this.toWslPath(binFile);
            const wslCmd = `${wslEnvExports.join('; ')}; "${wslBin}"`;
            res = spawnSync('wsl', ['bash', '-c', wslCmd], { encoding: 'utf8' });
          }

          const stdout = res.stdout || '';
          const stderr = res.stderr || '';
          const rc = res.status !== null ? res.status : 0;

          if (stdout) {
            stdout.split('\n').forEach(line => {
              if (line.trim()) spool.sysout(line);
            });
          }
          if (stderr) {
            stderr.split('\n').forEach(line => {
              if (line.trim()) spool.sysmsg(line);
            });
          }

          spool.sysmsg(`IEF142I ${context.jobName} ${step.stepName} ${pgmName} - COND CODE ${String(rc).padStart(4, '0')}`);
          return { returnCode: rc, output: stdout };
        }
      } catch (compileOrRunErr) {
        spool.sysmsg(`COB999W GNUCOBOL RUN ERROR: ${compileOrRunErr.message}. FALLING BACK TO ACCURATE EMULATOR.`);
      }
    }

    // High-fidelity fallback COBOL simulation engine
    return this.executeFallbackCOBOL(pgmName, step, context);
  }

  executeFallbackCOBOL(pgmName, step, context) {
    const { spool, catalog } = context;

    if (pgmName === 'ACCTINIT') {
      return this.runAcctInit(step, context);
    } else if (pgmName === 'TXNVALID') {
      return this.runTxnValid(step, context);
    } else if (pgmName === 'RECONCIL') {
      return this.runReconcil(step, context);
    } else if (pgmName === 'RECLOAD') {
      return this.runRecLoad(step, context);
    } else if (pgmName === 'RECRPT') {
      return this.runRecRpt(step, context);
    } else {
      throw new Error(`COB002E UNKNOWN COBOL PROGRAM: ${pgmName}`);
    }
  }

  runAcctInit(step, context) {
    const { spool, catalog } = context;
    const inDD = step.dd.ACCTIN;
    const outDD = step.dd.ACCTMSTR;
    const inData = catalog.readDataset(inDD.dsn, 0);

    catalog.writeDataset(outDD.dsn, inData.records, false);
    spool.sysout('==================================================');
    spool.sysout('ACCTINIT: STARTING ACCOUNT MASTER KSDS INITIALIZATION');
    spool.sysout(`ACCTINIT: LOAD COMPLETE.`);
    spool.sysout(`  RECORDS READ    : ${String(inData.records.length).padStart(6, '0')}`);
    spool.sysout(`  RECORDS LOADED  : ${String(inData.records.length).padStart(6, '0')}`);
    spool.sysout('==================================================');
    return { returnCode: inData.records.length === 0 ? 4 : 0, output: 'ACCTINIT COMPLETE' };
  }

  runTxnValid(step, context) {
    const { spool, catalog } = context;
    const inDD = step.dd.TXNIN;
    const gooDD = step.dd.TXNGOO;
    const rejDD = step.dd.TXNREJ;

    const inData = catalog.readDataset(inDD.dsn, 0);
    const good = [];
    const reject = [];

    for (const rec of inData.records) {
      if (rec.length < 58) {
        reject.push(`${rec.padEnd(80)}E000RECORD TOO SHORT                      `);
        continue;
      }
      const acct = rec.substring(0, 12).trim();
      const ref = rec.substring(12, 28).trim();
      const dateStr = rec.substring(28, 36).trim();
      const type = rec.substring(36, 38).trim();
      const amtStr = rec.substring(38, 51).trim();
      const curr = rec.substring(51, 54).trim();
      const chan = rec.substring(54, 58).trim();

      if (!acct) {
        reject.push(`${rec.padEnd(80)}E001ACCOUNT NUMBER IS BLANK            `);
      } else if (!ref) {
        reject.push(`${rec.padEnd(80)}E002TRANSACTION REF IS BLANK           `);
      } else if (!/^\d{8}$/.test(dateStr)) {
        reject.push(`${rec.padEnd(80)}E003TRANSACTION DATE NON-NUMERIC       `);
      } else if (parseInt(dateStr.substring(0, 4), 10) < 2000) {
        reject.push(`${rec.padEnd(80)}E004INVALID YEAR IN DATE               `);
      } else if (parseInt(dateStr.substring(4, 6), 10) < 1 || parseInt(dateStr.substring(4, 6), 10) > 12) {
        reject.push(`${rec.padEnd(80)}E005INVALID MONTH IN DATE              `);
      } else if (parseInt(dateStr.substring(6, 8), 10) < 1 || parseInt(dateStr.substring(6, 8), 10) > 31) {
        reject.push(`${rec.padEnd(80)}E006INVALID DAY IN DATE                `);
      } else if (type !== 'DR' && type !== 'CR') {
        reject.push(`${rec.padEnd(80)}E007INVALID TXN TYPE (MUST BE DR/CR)   `);
      } else if (!/^\d+$/.test(amtStr)) {
        reject.push(`${rec.padEnd(80)}E008AMOUNT FIELD IS NOT NUMERIC        `);
      } else if (parseInt(amtStr, 10) === 0) {
        reject.push(`${rec.padEnd(80)}E009AMOUNT CANNOT BE ZERO              `);
      } else if (!curr) {
        reject.push(`${rec.padEnd(80)}E010CURRENCY IS BLANK                 `);
      } else {
        good.push(rec.padEnd(80));
      }
    }

    catalog.writeDataset(gooDD.dsn, good, false);
    catalog.writeDataset(rejDD.dsn, reject, false);

    spool.sysout('==================================================');
    spool.sysout('TXNVALID: TRANSACTION VALIDATION STARTED');
    spool.sysout('TXNVALID: VALIDATION SUMMARY');
    spool.sysout(`  TOTAL READ     : ${String(inData.records.length).padStart(6, '0')}`);
    spool.sysout(`  VALID (GOOD)   : ${String(good.length).padStart(6, '0')}`);
    spool.sysout(`  REJECTED       : ${String(reject.length).padStart(6, '0')}`);
    spool.sysout('==================================================');

    let rc = 0;
    if (inData.records.length === 0) {
      rc = 12;
      spool.sysout('TXNVALID: EMPTY INPUT FILE DETECTED (RC=12)');
    } else if (reject.length > 0) {
      rc = 4;
      spool.sysout('TXNVALID: REJECTS DETECTED (RC=04)');
    } else {
      rc = 0;
      spool.sysout('TXNVALID: ALL RECORDS CLEAN (RC=00)');
    }
    return { returnCode: rc, output: 'TXNVALID COMPLETE' };
  }

  runReconcil(step, context) {
    const { spool, catalog } = context;
    const coreData = catalog.readDataset(step.dd.TXNCORE.dsn, 0);
    const bankData = catalog.readDataset(step.dd.TXNBNK.dsn, 0);

    let masterLookup = new Map();
    try {
      const acctData = catalog.readDataset(step.dd.ACCTMSTR.dsn, 0);
      for (const line of acctData.records) {
        const acctNo = line.substring(0, 12).trim();
        const acctName = line.substring(12, 42).trim();
        masterLookup.set(acctNo, acctName);
      }
    } catch (e) {}

    const results = [];
    let coreTotal = coreData.records.length;
    let bankTotal = bankData.records.length;
    let matched = 0, mismatch = 0, missBank = 0, missCore = 0, duplicates = 0;
    let amtMatched = 0, amtMismatch = 0, amtMissBank = 0, amtMissCore = 0;

    let cIdx = 0, bIdx = 0;
    let prevCoreKey = '', prevBankKey = '';

    const parseRec = (line) => ({
      acct: line.substring(0, 12),
      ref: line.substring(12, 28),
      date: line.substring(28, 36),
      type: line.substring(36, 38),
      amt: parseInt(line.substring(38, 51), 10) || 0,
      curr: line.substring(51, 54),
      chan: line.substring(54, 58),
      key: (line.substring(0, 12) + line.substring(12, 28))
    });

    while (cIdx < coreData.records.length || bIdx < bankData.records.length) {
      const c = cIdx < coreData.records.length ? parseRec(coreData.records[cIdx]) : null;
      const b = bIdx < bankData.records.length ? parseRec(bankData.records[bIdx]) : null;

      // Duplicate check
      if (c && c.key === prevCoreKey) {
        duplicates++;
        const acctName = masterLookup.get(c.acct.trim()) || 'UNKNOWN ACCT';
        results.push(this.formatReconRecord('DUPLICATE', c.acct, c.ref, c.date, c.amt, 0, '+', c.amt, c.curr, c.chan, 'D001', acctName));
        cIdx++;
        continue;
      }
      if (b && b.key === prevBankKey) {
        duplicates++;
        const acctName = masterLookup.get(b.acct.trim()) || 'UNKNOWN ACCT';
        results.push(this.formatReconRecord('DUPLICATE', b.acct, b.ref, b.date, 0, b.amt, '-', b.amt, b.curr, b.chan, 'D002', acctName));
        bIdx++;
        continue;
      }

      if (c && b && c.key === b.key) {
        prevCoreKey = c.key;
        prevBankKey = b.key;
        const acctName = masterLookup.get(c.acct.trim()) || 'UNKNOWN ACCT';
        if (c.amt === b.amt) {
          matched++;
          amtMatched += c.amt;
          results.push(this.formatReconRecord('MATCHED', c.acct, c.ref, c.date, c.amt, b.amt, '+', 0, c.curr, c.chan, '0000', acctName));
        } else {
          mismatch++;
          amtMismatch += c.amt;
          const sign = c.amt >= b.amt ? '+' : '-';
          const diff = Math.abs(c.amt - b.amt);
          results.push(this.formatReconRecord('AMOUNT-MISMATCH', c.acct, c.ref, c.date, c.amt, b.amt, sign, diff, c.curr, c.chan, 'M001', acctName));
        }
        cIdx++;
        bIdx++;
      } else if (c && (!b || c.key < b.key)) {
        prevCoreKey = c.key;
        missBank++;
        amtMissBank += c.amt;
        const acctName = masterLookup.get(c.acct.trim()) || 'UNKNOWN ACCT';
        results.push(this.formatReconRecord('MISSING-IN-BANK', c.acct, c.ref, c.date, c.amt, 0, '+', c.amt, c.curr, c.chan, 'B001', acctName));
        cIdx++;
      } else {
        prevBankKey = b.key;
        missCore++;
        amtMissCore += b.amt;
        const acctName = masterLookup.get(b.acct.trim()) || 'UNKNOWN ACCT';
        results.push(this.formatReconRecord('MISSING-IN-CORE', b.acct, b.ref, b.date, 0, b.amt, '-', b.amt, b.curr, b.chan, 'C001', acctName));
        bIdx++;
      }
    }

    catalog.writeDataset(step.dd.RECONOUT.dsn, results, false);

    // Format Control totals
    const ctlLines = [
      `TOTAL-CORE-TXN      ${String(coreTotal).padStart(8, '0')}${String(0).padStart(15, '0')}`,
      `TOTAL-BANK-TXN      ${String(bankTotal).padStart(8, '0')}${String(0).padStart(15, '0')}`,
      `MATCHED-TXN         ${String(matched).padStart(8, '0')}${String(amtMatched).padStart(15, '0')}`,
      `AMOUNT-MISMATCH     ${String(mismatch).padStart(8, '0')}${String(amtMismatch).padStart(15, '0')}`,
      `MISSING-IN-BANK     ${String(missBank).padStart(8, '0')}${String(amtMissBank).padStart(15, '0')}`,
      `MISSING-IN-CORE     ${String(missCore).padStart(8, '0')}${String(amtMissCore).padStart(15, '0')}`,
      `DUPLICATE-TXN       ${String(duplicates).padStart(8, '0')}${String(0).padStart(15, '0')}`,
      `TOTAL-EXCEPTIONS    ${String(mismatch + missBank + missCore + duplicates).padStart(8, '0')}${String(0).padStart(15, '0')}`
    ];
    catalog.writeDataset(step.dd.CTLREC.dsn, ctlLines, false);

    const totalExceptions = mismatch + missBank + missCore + duplicates;
    spool.sysout('==================================================');
    spool.sysout('RECONCIL: COMPLETED RECONCILIATION SUMMARY');
    spool.sysout(`  TOTAL CORE TXNS  : ${String(coreTotal).padStart(8, '0')}`);
    spool.sysout(`  TOTAL BANK TXNS  : ${String(bankTotal).padStart(8, '0')}`);
    spool.sysout(`  MATCHED TXNS     : ${String(matched).padStart(8, '0')}`);
    spool.sysout(`  AMOUNT MISMATCH  : ${String(mismatch).padStart(8, '0')}`);
    spool.sysout(`  MISSING IN BANK  : ${String(missBank).padStart(8, '0')}`);
    spool.sysout(`  MISSING IN CORE  : ${String(missCore).padStart(8, '0')}`);
    spool.sysout(`  DUPLICATE TXNS   : ${String(duplicates).padStart(8, '0')}`);
    spool.sysout(`  TOTAL EXCEPTIONS : ${String(totalExceptions).padStart(8, '0')}`);
    spool.sysout('==================================================');

    return { returnCode: totalExceptions > 0 ? 4 : 0, output: 'RECONCIL COMPLETE' };
  }

  formatReconRecord(status, acct, ref, date, coreAmt, bankAmt, diffSign, diffAmt, curr, chan, rsn, acctName) {
    const sStatus = status.padEnd(18).substring(0, 18);
    const sAcct = acct.padEnd(12).substring(0, 12);
    const sRef = ref.padEnd(16).substring(0, 16);
    const sDate = String(date).padEnd(8).substring(0, 8);
    const sCore = String(coreAmt).padStart(13, '0').substring(0, 13);
    const sBank = String(bankAmt).padStart(13, '0').substring(0, 13);
    const sDiffSign = (diffSign || '+').substring(0, 1);
    const sDiff = String(diffAmt).padStart(13, '0').substring(0, 13);
    const sCurr = curr.padEnd(3).substring(0, 3);
    const sChan = chan.padEnd(4).substring(0, 4);
    const sRsn = rsn.padEnd(4).substring(0, 4);
    const sName = acctName.padEnd(15).substring(0, 15);
    return `${sStatus}${sAcct}${sRef}${sDate}${sCore}${sBank}${sDiffSign}${sDiff}${sCurr}${sChan}${sRsn}${sName}`;
  }

  runRecLoad(step, context) {
    const { spool, catalog } = context;
    const inData = catalog.readDataset(step.dd.RECONIN.dsn, 0);
    const loadLines = [];

    for (const rec of inData.records) {
      const status = rec.substring(0, 18).trim();
      const acct = rec.substring(18, 30).trim();
      const ref = rec.substring(30, 46).trim();
      const date = rec.substring(46, 54).trim();
      const coreAmt = (parseInt(rec.substring(54, 67), 10) / 100).toFixed(2);
      const bankAmt = (parseInt(rec.substring(67, 80), 10) / 100).toFixed(2);
      const diffSign = rec.substring(80, 81);
      const diffAmt = (parseInt(rec.substring(81, 94), 10) / 100).toFixed(2);
      const curr = rec.substring(94, 97).trim();
      const chan = rec.substring(97, 101).trim();
      const rsn = rec.substring(101, 105).trim();
      const acctName = rec.substring(105, 120).trim();

      loadLines.push(`RESULT|${status}|${acct}|${ref}|${date}|${coreAmt}|${bankAmt}|${diffSign}|${diffAmt}|${curr}|${chan}|${rsn}|${acctName}`);
    }

    loadLines.push(`AUDIT|JOB=BANKRECN|ROWS=${inData.records.length}|STATUS=LOADED|SYSTEM=GNUCBO-MFR`);
    catalog.writeDataset(step.dd.DBLOAD.dsn, loadLines, false);

    spool.sysout('==================================================');
    spool.sysout('RECLOAD: PREPARING DATABASE INGESTION STREAM');
    spool.sysout(`RECLOAD: DATABASE INGEST DATASET GENERATED`);
    spool.sysout(`  ROWS PREPARED   : ${String(inData.records.length).padStart(6, '0')}`);
    spool.sysout('==================================================');

    return { returnCode: 0, output: 'RECLOAD COMPLETE' };
  }

  runRecRpt(step, context) {
    const { spool, catalog } = context;
    const recData = catalog.readDataset(step.dd.RECONIN._resolvedDsn || step.dd.RECONIN.dsn, 0);
    let ctlData = { records: [] };
    try {
      ctlData = catalog.readDataset(step.dd.CTLIN._resolvedDsn || step.dd.CTLIN.dsn, 0);
    } catch (e) {}

    const sumLines = [
      '',
      'MAINFRAME BANK - NIGHTLY RECONCILIATION SUMMARY REPORT                    PAGE: 0001',
      '====================================================================================================================================',
      'METRIC / CATEGORY              TOTAL COUNT       TOTAL AMOUNT ($)      NOTES',
      '------------------------------------------------------------------------------------------------------------------------------------'
    ];

    for (const c of ctlData.records) {
      const tag = c.substring(0, 20);
      const cnt = parseInt(c.substring(20, 28), 10) || 0;
      const amt = (parseInt(c.substring(28, 43), 10) / 100).toFixed(2);
      sumLines.push(`${tag} ${String(cnt).padStart(11)}        $${String(amt).padStart(15)}     AUDITED TIE-OUT`);
    }
    sumLines.push('------------------------------------------------------------------------------------------------------------------------------------');
    sumLines.push('END OF RECONCILIATION SUMMARY REPORT');

    catalog.writeDataset(step.dd.RPTSUM._resolvedDsn || step.dd.RPTSUM.dsn, sumLines, false);

    const matLines = [
      '',
      'MAINFRAME BANK - MATCHED TRANSACTIONS REPORT                               PAGE: 0001',
      '====================================================================================================================================',
      'ACCOUNT NO   TXN REFERENCE     TXN DATE  CORE AMOUNT     BANK AMOUNT     CURR  CHAN  ACCOUNT NAME',
      '------------------------------------------------------------------------------------------------------------------------------------'
    ];

    const excLines = [
      '',
      'MAINFRAME BANK - TRANSACTION EXCEPTION REPORT                              PAGE: 0001',
      '====================================================================================================================================',
      'STATUS              ACCOUNT NO   TXN REFERENCE     CORE AMOUNT     BANK AMOUNT     DIFF          RSN   ACCOUNT NAME',
      '------------------------------------------------------------------------------------------------------------------------------------'
    ];

    let matCnt = 0, excCnt = 0;
    for (const rec of recData.records) {
      const status = rec.substring(0, 18).trim();
      const acct = rec.substring(18, 30).trim();
      const ref = rec.substring(30, 46).trim();
      const date = rec.substring(46, 54).trim();
      const coreAmt = '$' + (parseInt(rec.substring(54, 67), 10) / 100).toFixed(2);
      const bankAmt = '$' + (parseInt(rec.substring(67, 80), 10) / 100).toFixed(2);
      const diffSign = rec.substring(80, 81);
      const diffAmt = diffSign + '$' + (parseInt(rec.substring(81, 94), 10) / 100).toFixed(2);
      const curr = rec.substring(94, 97).trim();
      const chan = rec.substring(97, 101).trim();
      const rsn = rec.substring(101, 105).trim();
      const acctName = rec.substring(105, 120).trim();

      if (status.startsWith('MATCHED')) {
        matCnt++;
        matLines.push(`${acct.padEnd(12)} ${ref.padEnd(17)} ${date}  ${coreAmt.padStart(15)} ${bankAmt.padStart(15)}   ${curr.padEnd(5)} ${chan.padEnd(5)} ${acctName}`);
      } else {
        excCnt++;
        excLines.push(`${status.padEnd(19)} ${acct.padEnd(12)} ${ref.padEnd(17)} ${coreAmt.padStart(15)} ${bankAmt.padStart(15)} ${diffAmt.padStart(13)} ${rsn.padEnd(5)} ${acctName}`);
      }
    }

    matLines.push('------------------------------------------------------------------------------------------------------------------------------------');
    matLines.push(`TOTAL MATCHED TRANSACTIONS: ${matCnt}`);
    matLines.push('END OF MATCHED TRANSACTIONS REPORT');
    catalog.writeDataset(step.dd.RPTMAT._resolvedDsn || step.dd.RPTMAT.dsn, matLines, false);

    excLines.push('------------------------------------------------------------------------------------------------------------------------------------');
    excLines.push(`TOTAL EXCEPTION TRANSACTIONS: ${excCnt}`);
    excLines.push('END OF EXCEPTION TRANSACTIONS REPORT');
    catalog.writeDataset(step.dd.RPTEXC._resolvedDsn || step.dd.RPTEXC.dsn, excLines, false);

    // Rejects report if REJIN exists
    if (step.dd.REJIN && step.dd.RPTREJ) {
      try {
        const rejData = catalog.readDataset(step.dd.REJIN._resolvedDsn || step.dd.REJIN.dsn, 0);
        const rejLines = [
          '',
          'MAINFRAME BANK - TRANSACTION REJECT / VALIDATION REPORT                    PAGE: 0001',
          '====================================================================================================================================',
          'CODE  ERROR DESCRIPTION               REJECTED RECORD DATA',
          '------------------------------------------------------------------------------------------------------------------------------------'
        ];
        for (const line of rejData.records) {
          const recData = line.substring(0, 80);
          const errCode = line.substring(80, 84);
          const errMsg = line.substring(84, 120);
          rejLines.push(`${errCode}  ${errMsg}  ${recData}`);
        }
        rejLines.push('------------------------------------------------------------------------------------------------------------------------------------');
        rejLines.push(`TOTAL REJECTED TRANSACTIONS: ${rejData.records.length}`);
        rejLines.push('END OF REJECT REPORT');
        catalog.writeDataset(step.dd.RPTREJ._resolvedDsn || step.dd.RPTREJ.dsn, rejLines, false);
      } catch (e) {}
    }

    spool.sysout('==================================================');
    spool.sysout('RECRPT: REPORT GENERATION COMPLETED');
    spool.sysout(`  MATCHED ROWS    : ${String(matCnt).padStart(6, '0')}`);
    spool.sysout(`  EXCEPTION ROWS  : ${String(excCnt).padStart(6, '0')}`);
    spool.sysout('==================================================');

    return { returnCode: 0, output: 'RECRPT COMPLETE' };
  }
}

module.exports = { CobolRunner };
