/**
 * Utility: IEBCOPY
 * Standard IBM Partitioned Dataset (PDS) copy utility.
 */

class IEBCOPYUtility {
  static async execute(step, context) {
    const { spool, catalog } = context;
    const sysut1 = step.dd.SYSUT1;
    const sysut2 = step.dd.SYSUT2;

    spool.sysmsg(`IEB100I IEBCOPY PDS COPY UTILITY STARTED`);
    if (!sysut1 || !sysut2) {
      throw new Error(`IEB101A MISSING SYSUT1 OR SYSUT2 FOR IEBCOPY`);
    }

    const inData = catalog.readDataset(sysut1.dsn, 0);
    catalog.writeDataset(sysut2.dsn, inData.records, false);

    spool.sysmsg(`IEB102I PDS COPY COMPLETED`);
    return { returnCode: 0, output: 'IEBCOPY SUCCESSFUL' };
  }
}

module.exports = { IEBCOPYUtility };
