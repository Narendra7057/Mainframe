/**
 * JCL (Job Control Language) Parser
 * Supports:
 *  - JOB statements
 *  - EXEC statements (PGM, PROC, PARM, COND)
 *  - DD statements (DSN, DISP, SPACE, DCB, UNIT, VOL=SER, SYSOUT, DUMMY)
 *  - Continuation lines (trailing comma + // indent)
 *  - In-stream data (SYSIN DD * / SYSIN DD DATA / /*)
 *  - Symbolic parameter substitution (// SET VAR=VAL and &VAR)
 *  - IF-THEN-ELSE-ENDIF conditional blocks
 *  - Comments (//*)
 */

class JCLParser {
  constructor() {
    this.symbolics = new Map();
  }

  /**
   * Main entry point: Parses raw JCL text into structured Job definition
   */
  parse(jclText, externalParams = {}) {
    const lines = jclText.split(/\r?\n/);
    this.symbolics = new Map(Object.entries(externalParams));

    const combinedLines = this.preprocessAndCombineContinuations(lines);
    const job = {
      jobName: 'UNNAMED',
      accounting: '',
      class: 'A',
      msgClass: 'X',
      notify: '',
      steps: [],
      rawJcl: jclText,
      errors: []
    };

    let currentStep = null;
    let inIfBlock = null;

    for (let i = 0; i < combinedLines.length; i++) {
      const lineObj = combinedLines[i];
      const rawLine = lineObj.text;

      // Handle Comments
      if (rawLine.startsWith('//*') || rawLine.trim() === '//') {
        continue;
      }

      // Handle In-stream data for current DD
      if (lineObj.isInstream) {
        if (currentStep && currentStep.currentDD) {
          currentStep.currentDD.instreamData = currentStep.currentDD.instreamData || [];
          currentStep.currentDD.instreamData.push(rawLine);
        }
        continue;
      }

      // Check for // SET VAR=VALUE
      const setMatch = rawLine.match(/^\/\/\s+SET\s+([A-Z0-9_]+)=(.*)$/i);
      if (setMatch) {
        const varName = setMatch[1].toUpperCase();
        const varVal = this.stripQuotes(setMatch[2].trim());
        // Only set default if not already passed in externalParams
        if (!externalParams || !Object.prototype.hasOwnProperty.call(externalParams, varName)) {
          this.symbolics.set(varName, varVal);
        }
        continue;
      }

      // Substitute symbolic parameters: &VAR
      const line = this.substituteSymbolics(rawLine);

      // Check for IF-THEN-ELSE-ENDIF
      const ifMatch = line.match(/^\/\/\s*IF\s*\((.*)\)\s*THEN/i);
      if (ifMatch) {
        inIfBlock = { condition: ifMatch[1].trim(), thenSteps: [], elseSteps: [], isElse: false };
        continue;
      }
      if (line.match(/^\/\/\s*ELSE/i)) {
        if (inIfBlock) inIfBlock.isElse = true;
        continue;
      }
      if (line.match(/^\/\/\s*ENDIF/i)) {
        inIfBlock = null;
        continue;
      }

      // JOB Statement: //JOBNAME JOB ...
      const jobMatch = line.match(/^\/\/([A-Z0-9$#@]{1,8})\s+JOB\s*(.*)$/i);
      if (jobMatch) {
        job.jobName = jobMatch[1].toUpperCase();
        this.parseJobParams(jobMatch[2], job);
        continue;
      }

      // EXEC Statement: //STEPNAME EXEC PGM=... or PROC=...
      const execMatch = line.match(/^\/\/([A-Z0-9$#@]{1,8})\s+EXEC\s+(.*)$/i);
      if (execMatch) {
        const stepName = execMatch[1].toUpperCase();
        const params = this.parseParams(execMatch[2]);
        currentStep = {
          stepName,
          pgm: params.PGM || params.pgm || null,
          proc: params.PROC || params.proc || (!params.PGM && !params.pgm ? Object.keys(params)[0] : null),
          parm: params.PARM || params.parm || '',
          cond: params.COND || params.cond || null,
          dd: {},
          currentDD: null,
          ifCondition: inIfBlock ? inIfBlock.condition : null,
          isElseBranch: inIfBlock ? inIfBlock.isElse : false
        };
        job.steps.push(currentStep);
        continue;
      }

      // DD Statement: //DDNAME DD ...
      const ddMatch = line.match(/^\/\/([A-Z0-9$#@]{1,8})\s+DD\s*(.*)$/i);
      if (ddMatch && currentStep) {
        const ddName = ddMatch[1].toUpperCase();
        const rest = ddMatch[2].trim();
        const ddObj = this.parseDD(ddName, rest);
        currentStep.dd[ddName] = ddObj;
        currentStep.currentDD = ddObj;
        continue;
      }
    }

    return job;
  }

  /**
   * Preprocesses lines, combining continuation lines ending with a comma
   * and handling SYSIN DD * up to /*
   */
  preprocessAndCombineContinuations(lines) {
    const combined = [];
    let accumulatingLine = null;
    let insideInstream = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (insideInstream) {
        if (line.startsWith('/*') || (line.startsWith('//') && !line.startsWith('//*'))) {
          insideInstream = false;
          // fall through to process if it's a new statement
          if (line.startsWith('/*')) continue;
        } else {
          combined.push({ text: line, isInstream: true });
          continue;
        }
      }

      if (line.startsWith('//*')) {
        combined.push({ text: line, isInstream: false });
        continue;
      }

      // Check if this line starts a DD * or DD DATA
      if (line.match(/^\/\/[A-Z0-9$#@]{1,8}\s+DD\s+\*/i) || line.match(/^\/\/[A-Z0-9$#@]{1,8}\s+DD\s+DATA/i)) {
        insideInstream = true;
      }

      // Check for continuation
      if (accumulatingLine !== null) {
        const trimmed = line.replace(/^\/\/\s*/, '');
        accumulatingLine += trimmed;
        if (trimmed.endsWith(',')) {
          // continue accumulating
        } else {
          combined.push({ text: accumulatingLine, isInstream: false });
          accumulatingLine = null;
        }
      } else {
        if (line.startsWith('//') && line.trim().endsWith(',')) {
          accumulatingLine = line.trim();
        } else {
          combined.push({ text: line, isInstream: false });
        }
      }
    }

    if (accumulatingLine !== null) {
      combined.push({ text: accumulatingLine, isInstream: false });
    }

    return combined;
  }

  /**
   * Replace &SYMBOL with value
   */
  substituteSymbolics(text) {
    let result = text;
    for (const [key, val] of this.symbolics.entries()) {
      // In JCL, &VAR. consumes the trailing dot as a parameter delimiter
      const regexWithDot = new RegExp(`&${key}\\.`, 'gi');
      result = result.replace(regexWithDot, val);
      const regex = new RegExp(`&${key}\\b`, 'gi');
      result = result.replace(regex, val);
    }
    return result;
  }

  stripQuotes(str) {
    if (!str) return '';
    return str.replace(/^['"](.*)['"]$/, '$1');
  }

  parseJobParams(paramString, job) {
    const params = this.parseParams(paramString);
    if (params.CLASS) job.class = params.CLASS;
    if (params.MSGCLASS) job.msgClass = params.MSGCLASS;
    if (params.NOTIFY) job.notify = params.NOTIFY;
  }

  /**
   * Parse DD parameters: DSN, DISP, SPACE, DCB, UNIT, VOL=SER, SYSOUT, DUMMY
   */
  parseDD(ddName, paramString) {
    const dd = {
      name: ddName,
      dsn: null,
      disp: ['NEW', 'CATLG', 'DELETE'],
      space: null,
      dcb: {},
      unit: 'SYSDA',
      volser: 'WORK01',
      sysout: null,
      dummy: false,
      instreamData: null
    };

    if (!paramString || paramString === '*') {
      dd.instreamData = [];
      return dd;
    }
    if (paramString.toUpperCase() === 'DUMMY') {
      dd.dummy = true;
      return dd;
    }

    const params = this.parseParams(paramString);

    if (params.DSN || params.dsn) dd.dsn = (params.DSN || params.dsn).toUpperCase();
    if (params.DSNAME || params.dsname) dd.dsn = (params.DSNAME || params.dsname).toUpperCase();

    // DISP=(status, normal_disp, abend_disp)
    if (params.DISP || params.disp) {
      const dispRaw = params.DISP || params.disp;
      if (typeof dispRaw === 'string') {
        const cleanDisp = dispRaw.replace(/^\(/, '').replace(/\)$/, '');
        dd.disp = cleanDisp.split(',').map(s => s.trim().toUpperCase());
      }
    }

    // DCB=(RECFM=...,LRECL=...,BLKSIZE=...)
    if (params.DCB || params.dcb) {
      const dcbRaw = params.DCB || params.dcb;
      if (typeof dcbRaw === 'string') {
        const clean = dcbRaw.replace(/^\(/, '').replace(/\)$/, '');
        const dcbSub = this.parseParams(clean);
        dd.dcb = {
          recfm: (dcbSub.RECFM || 'FB').toUpperCase(),
          lrecl: parseInt(dcbSub.LRECL || 80, 10),
          blksize: parseInt(dcbSub.BLKSIZE || (dcbSub.LRECL ? parseInt(dcbSub.LRECL, 10) * 10 : 800), 10)
        };
      }
    }

    // Direct DCB overrides if specified outside DCB
    if (params.RECFM) dd.dcb.recfm = params.RECFM.toUpperCase();
    if (params.LRECL) dd.dcb.lrecl = parseInt(params.LRECL, 10);
    if (params.BLKSIZE) dd.dcb.blksize = parseInt(params.BLKSIZE, 10);

    // SPACE=(TRK,(p,s),RLSE)
    if (params.SPACE || params.space) {
      const spRaw = params.SPACE || params.space;
      dd.space = spRaw;
    }

    if (params.UNIT || params.unit) dd.unit = (params.UNIT || params.unit).toUpperCase();

    // VOL=SER=WORK01
    if (params.VOL || params.vol) {
      const volRaw = params.VOL || params.vol;
      const vMatch = volRaw.match(/SER=([A-Z0-9]+)/i);
      if (vMatch) dd.volser = vMatch[1].toUpperCase();
    }

    if (params.SYSOUT || params.sysout) dd.sysout = params.SYSOUT || params.sysout;

    return dd;
  }

  /**
   * Helper: parses parameter strings like KEY=VAL, KEY=(A,B,C), etc.
   */
  parseParams(str) {
    const params = {};
    if (!str) return params;

    let idx = 0;
    const len = str.length;

    while (idx < len) {
      while (idx < len && (str[idx] === ' ' || str[idx] === ',')) idx++;
      if (idx >= len) break;

      let key = '';
      while (idx < len && str[idx] !== '=' && str[idx] !== ',' && str[idx] !== ' ') {
        key += str[idx++];
      }
      key = key.trim().toUpperCase();

      if (idx < len && str[idx] === '=') {
        idx++; // skip '='
        let val = '';
        if (str[idx] === '(') {
          // Parenthesized parameter
          let depth = 1;
          val += str[idx++];
          while (idx < len && depth > 0) {
            if (str[idx] === '(') depth++;
            if (str[idx] === ')') depth--;
            val += str[idx++];
          }
        } else if (str[idx] === "'" || str[idx] === '"') {
          // Quoted parameter
          const quote = str[idx++];
          while (idx < len && str[idx] !== quote) {
            val += str[idx++];
          }
          if (idx < len) idx++; // skip closing quote
        } else {
          // Unquoted scalar
          while (idx < len && str[idx] !== ',' && str[idx] !== ' ') {
            val += str[idx++];
          }
        }
        params[key] = val.trim();
      } else {
        // Positional or boolean parameter
        if (key) params[key] = true;
      }
    }

    return params;
  }
}

module.exports = { JCLParser };
