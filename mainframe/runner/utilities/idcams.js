/**
 * Utility: IDCAMS (Integrated Data Cluster Access Method Services)
 * Emulates IBM z/OS Access Method Services utility.
 * Supports:
 *   - DEFINE CLUSTER
 *   - DEFINE GDG
 *   - DEFINE NONVSAM
 *   - REPRO
 *   - ALTER (NEWNAME)
 *   - DELETE (PURGE, CLUSTER, GDG, NOSCRATCH)
 *   - LISTCAT
 *   - PRINT
 */
const fs = require('fs');

class IDCAMSUtility {
  static async execute(step, context) {
    const { spool, catalog } = context;
    const sysin = (step.dd && step.dd.SYSIN && step.dd.SYSIN.instreamData) || [];
    const commandText = sysin.join(' ');
    let maxRC = 0;
    const outputs = [];

    spool.sysmsg(`IDC0002I IDCAMS PROCESSING STARTED`);

    // Parse commands from SYSIN (IDCAMS statements can span multiple lines separated by hyphens '-')
    const commands = IDCAMSUtility.extractCommands(sysin);

    for (const cmd of commands) {
      const verb = cmd.verb.toUpperCase();
      spool.sysmsg(`IDC0001I FUNCTION COMPLETED, HIGHEST CONDITION CODE WAS 0`);

      try {
        if (verb === 'DEFINE' && cmd.subverb === 'CLUSTER') {
          const res = IDCAMSUtility.handleDefineCluster(cmd.args, catalog);
          outputs.push(res.message);
          spool.sysmsg(res.message);
        } else if (verb === 'DEFINE' && cmd.subverb === 'GDG') {
          const res = IDCAMSUtility.handleDefineGDG(cmd.args, catalog);
          outputs.push(res.message);
          spool.sysmsg(res.message);
        } else if (verb === 'DEFINE' && cmd.subverb === 'NONVSAM') {
          const res = IDCAMSUtility.handleDefineNonVsam(cmd.args, catalog);
          outputs.push(res.message);
          spool.sysmsg(res.message);
        } else if (verb === 'REPRO') {
          const res = IDCAMSUtility.handleRepro(cmd.args, step, context);
          outputs.push(res.message);
          spool.sysmsg(res.message);
        } else if (verb === 'ALTER') {
          const res = IDCAMSUtility.handleAlter(cmd.args, catalog);
          outputs.push(res.message);
          spool.sysmsg(res.message);
        } else if (verb === 'DELETE') {
          const res = IDCAMSUtility.handleDelete(cmd.args, catalog);
          outputs.push(res.message);
          spool.sysmsg(res.message);
        } else if (verb === 'LISTCAT') {
          const res = IDCAMSUtility.handleListcat(cmd.args, catalog);
          outputs.push(res.output);
          spool.sysout(res.output);
        } else if (verb === 'PRINT') {
          const res = IDCAMSUtility.handlePrint(cmd.args, step, context);
          outputs.push(res.output);
          spool.sysout(res.output);
        } else {
          outputs.push(`IDC3100I UNRECOGNIZED IDCAMS VERB: ${verb}`);
          spool.sysmsg(`IDC3100I UNRECOGNIZED IDCAMS VERB: ${verb}`);
          maxRC = Math.max(maxRC, 4);
        }
      } catch (err) {
        maxRC = Math.max(maxRC, 12);
        outputs.push(`IDC3009I ** ERROR: ${err.message}`);
        spool.sysmsg(`IDC3009I ** ERROR: ${err.message}`);
      }
    }

    spool.sysmsg(`IDC0002I IDCAMS PROCESSING COMPLETED. MAX CC = ${maxRC}`);
    return {
      returnCode: maxRC,
      output: outputs.join('\n')
    };
  }

  static extractCommands(lines) {
    const commands = [];
    let currentCmd = '';

    for (let raw of lines) {
      let line = raw.trim();
      if (!line || line.startsWith('/*')) continue;
      // Strip trailing hyphen for continuation
      if (line.endsWith('-')) {
        currentCmd += ' ' + line.slice(0, -1).trim();
      } else {
        currentCmd += ' ' + line;
        if (currentCmd.trim()) {
          const parsed = IDCAMSUtility.parseSingleCommand(currentCmd.trim());
          if (parsed) commands.push(parsed);
          currentCmd = '';
        }
      }
    }

    if (currentCmd.trim()) {
      const parsed = IDCAMSUtility.parseSingleCommand(currentCmd.trim());
      if (parsed) commands.push(parsed);
    }
    return commands;
  }

  static parseSingleCommand(text) {
    // E.g.: DEFINE CLUSTER (NAME(BANK.PROD.ACCTMSTR) KEYS(12 0) RECORDSIZE(80 80))
    const tokens = text.trim().split(/\s+/);
    if (tokens.length === 0) return null;

    const verb = tokens[0].toUpperCase();
    let subverb = '';
    let rest = text.substring(tokens[0].length).trim();

    if (['CLUSTER', 'GDG', 'NONVSAM', 'PAGESPACE', 'ALIAS'].includes(tokens[1]?.toUpperCase())) {
      subverb = tokens[1].toUpperCase();
      rest = rest.substring(tokens[1].length).trim();
    }

    return { verb, subverb, args: rest, raw: text };
  }

  static extractParam(args, paramName) {
    const regex = new RegExp(`${paramName}\\s*\\(([^)]+)\\)`, 'i');
    const match = args.match(regex);
    return match ? match[1].trim() : null;
  }

  static handleDefineCluster(args, catalog) {
    const name = IDCAMSUtility.extractParam(args, 'NAME');
    if (!name) throw new Error('MISSING REQUIRED PARAMETER: NAME');

    const keysStr = IDCAMSUtility.extractParam(args, 'KEYS');
    let keys = [12, 0];
    if (keysStr) {
      keys = keysStr.split(/\s+/).map(Number);
    }

    const recStr = IDCAMSUtility.extractParam(args, 'RECORDSIZE');
    let recordsize = [80, 80];
    if (recStr) {
      recordsize = recStr.split(/\s+/).map(Number);
    }

    const volStr = IDCAMSUtility.extractParam(args, 'VOLUMES') || 'WORK01';
    const cylStr = IDCAMSUtility.extractParam(args, 'CYLINDERS') || '5';

    return catalog.defineCluster({
      name,
      keys: { length: keys[0], offset: keys[1] },
      recordsize: { avg: recordsize[0], max: recordsize[1] },
      volumes: [volStr],
      cylinders: parseInt(cylStr, 10)
    });
  }

  static handleDefineGDG(args, catalog) {
    const name = IDCAMSUtility.extractParam(args, 'NAME');
    if (!name) throw new Error('MISSING REQUIRED PARAMETER: NAME');

    const limitStr = IDCAMSUtility.extractParam(args, 'LIMIT') || '5';
    const scratch = args.toUpperCase().includes('SCRATCH') && !args.toUpperCase().includes('NOSCRATCH');

    return catalog.defineGDG(name, parseInt(limitStr, 10), scratch);
  }

  static handleDefineNonVsam(args, catalog) {
    const name = IDCAMSUtility.extractParam(args, 'NAME');
    if (!name) throw new Error('MISSING REQUIRED PARAMETER: NAME');

    return catalog.allocateDataset({
      name,
      type: 'PS',
      disp: ['NEW', 'CATLG', 'DELETE']
    });
  }

  static handleAlter(args, catalog) {
    // E.g.: ALTER BANK.PROD.OLDNAME NEWNAME(BANK.PROD.NEWNAME)
    const match = args.match(/^([A-Z0-9.]+)\s+.*NEWNAME\s*\(([^)]+)\)/i);
    if (!match) throw new Error('INVALID ALTER SYNTAX. EXPECTED: ALTER <oldname> NEWNAME(<newname>)');

    return catalog.renameDataset(match[1], match[2]);
  }

  static handleDelete(args, catalog) {
    // E.g.: DELETE BANK.PROD.ACCTMSTR CLUSTER PURGE
    const tokens = args.split(/\s+/);
    const dsname = tokens[0].replace(/[()]/g, '');
    const purge = args.toUpperCase().includes('PURGE');

    return catalog.deleteDataset(dsname, purge);
  }

  static handleRepro(args, step, context) {
    const { catalog } = context;
    // REPRO INFILE(DDNAME) OUTFILE(DDNAME) or INDATASET(...) OUTDATASET(...)
    let inPath, outPath;

    const infile = IDCAMSUtility.extractParam(args, 'INFILE');
    const outfile = IDCAMSUtility.extractParam(args, 'OUTFILE');
    const indataset = IDCAMSUtility.extractParam(args, 'INDATASET');
    const outdataset = IDCAMSUtility.extractParam(args, 'OUTDATASET');

    if (infile && step.dd[infile]) {
      const dsn = step.dd[infile].dsn;
      inPath = catalog.resolveDatasetName(dsn).resolvedName;
    } else if (indataset) {
      inPath = indataset;
    } else {
      throw new Error('REPRO MISSING INPUT SPECIFICATION (INFILE or INDATASET)');
    }

    if (outfile && step.dd[outfile]) {
      const dsn = step.dd[outfile].dsn;
      outPath = catalog.resolveDatasetName(dsn).resolvedName;
    } else if (outdataset) {
      outPath = outdataset;
    } else {
      throw new Error('REPRO MISSING OUTPUT SPECIFICATION (OUTFILE or OUTDATASET)');
    }

    const inData = catalog.readDataset(inPath, 0); // read all
    catalog.writeDataset(outPath, inData.records, false);

    return {
      status: 'OK',
      message: `IDC0005I NUMBER OF RECORDS PROCESSED WAS ${inData.records.length}`
    };
  }

  static handleListcat(args, catalog) {
    const entries = catalog.listCatalog();
    const lines = [
      'IDCAMS  SYSTEM SERVICES                                           TIME: 00:00:00',
      'THE FOLLOWING ENTRIES WERE FOUND IN THE CATALOG:',
      '--------------------------------------------------------------------------------',
      'TYPE      NAME                                        VOLSER   RECFM  LRECL  RECS',
      '--------------------------------------------------------------------------------'
    ];

    for (const e of entries) {
      const typeStr = (e.type || 'PS').padEnd(9);
      const nameStr = (e.name || '').padEnd(43);
      const volStr = (e.volser || 'WORK01').padEnd(8);
      const recfmStr = (e.recfm || 'FB').padEnd(6);
      const lreclStr = String(e.lrecl || 80).padStart(5);
      const recsStr = String(e.recordCount !== undefined ? e.recordCount : '-').padStart(6);
      lines.push(`${typeStr} ${nameStr} ${volStr} ${recfmStr} ${lreclStr} ${recsStr}`);
    }
    lines.push('--------------------------------------------------------------------------------');
    lines.push(`IDC0001I FUNCTION COMPLETED, HIGHEST CONDITION CODE WAS 0`);
    return { output: lines.join('\n') };
  }

  static handlePrint(args, step, context) {
    const { catalog } = context;
    const infile = IDCAMSUtility.extractParam(args, 'INFILE');
    const indataset = IDCAMSUtility.extractParam(args, 'INDATASET');
    const dsname = infile && step.dd[infile] ? step.dd[infile].dsn : indataset;

    if (!dsname) throw new Error('PRINT MISSING INDATASET OR INFILE');
    const data = catalog.readDataset(dsname, 100);

    const lines = [
      `IDCAMS  PRINT DATASET: ${data.name}`,
      '--------------------------------------------------------------------------------'
    ];
    data.records.forEach((rec, idx) => {
      lines.push(`RECORD ${String(idx + 1).padStart(5, '0')}: ${rec}`);
    });
    lines.push('--------------------------------------------------------------------------------');
    lines.push(`IDC0005I NUMBER OF RECORDS PRINTED WAS ${data.records.length}`);
    return { output: lines.join('\n') };
  }
}

module.exports = { IDCAMSUtility };
