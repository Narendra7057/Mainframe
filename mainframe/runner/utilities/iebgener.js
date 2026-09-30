/**
 * Utility: IEBGENER
 * Standard IBM sequential dataset copy utility.
 * Copies SYSUT1 to SYSUT2.
 * Supports copying to SYSOUT (printers / spool).
 */

class IEBGENERUtility {
  static async execute(step, context) {
    const { spool, catalog } = context;
    const sysut1 = step.dd.SYSUT1;
    const sysut2 = step.dd.SYSUT2;

    spool.sysmsg(`IEB001I IEBGENER COPY UTILITY STARTED`);

    if (!sysut1) {
      throw new Error(`IEB002A MISSING SYSUT1 DD STATEMENT`);
    }
    if (!sysut2) {
      throw new Error(`IEB003A MISSING SYSUT2 DD STATEMENT`);
    }

    let records = [];
    if (sysut1.instreamData) {
      records = sysut1.instreamData;
    } else if (sysut1.dsn) {
      const inData = catalog.readDataset(sysut1.dsn, 0);
      records = inData.records;
    }

    spool.sysmsg(`IEB010I RECORDS READ FROM SYSUT1: ${records.length}`);

    if (sysut2.sysout) {
      // Write directly to SYSOUT
      spool.sysout(`*** SYSOUT DATASET: ${sysut1.dsn || 'IN-STREAM'} ***`);
      records.forEach(r => spool.sysout(r));
      spool.sysmsg(`IEB011I RECORDS WRITTEN TO SYSOUT: ${records.length}`);
    } else if (sysut2.dsn) {
      catalog.writeDataset(sysut2.dsn, records, false);
      spool.sysmsg(`IEB011I RECORDS WRITTEN TO SYSUT2 (${sysut2.dsn}): ${records.length}`);
    }

    spool.sysmsg(`IEB012I HIGHEST RETURN CODE WAS 0`);
    return {
      returnCode: 0,
      output: `IEBGENER COMPLETED. ${records.length} RECORDS TRANSFERRED.`
    };
  }
}

module.exports = { IEBGENERUtility };
