/**
 * Utility: IEHPROGM
 * IBM system utility for catalog manipulation, renaming, and uncataloging.
 */

class IEHPROGMUtility {
  static async execute(step, context) {
    const { spool, catalog } = context;
    const sysinData = (step.dd && step.dd.SYSIN && step.dd.SYSIN.instreamData) || [];

    spool.sysmsg(`IEH001I IEHPROGM UTILITY STARTED`);
    let maxRC = 0;

    for (const rawLine of sysinData) {
      const line = rawLine.trim();
      if (!line || line.startsWith('/*')) continue;

      const renameMatch = line.match(/RENAME\s+DSNAME=([A-Z0-9.]+),\s*NEWNAME=([A-Z0-9.]+)/i);
      if (renameMatch) {
        try {
          catalog.renameDataset(renameMatch[1], renameMatch[2]);
          spool.sysmsg(`IEH100I DSNAME ${renameMatch[1]} RENAMED TO ${renameMatch[2]}`);
        } catch (e) {
          spool.sysmsg(`IEH101I ERROR RENAMING: ${e.message}`);
          maxRC = Math.max(maxRC, 8);
        }
        continue;
      }

      const catlgMatch = line.match(/CATLG\s+DSNAME=([A-Z0-9.]+)/i);
      if (catlgMatch) {
        catalog.setCatalogStatus(catlgMatch[1], true);
        spool.sysmsg(`IEH102I DSNAME ${catlgMatch[1]} CATALOGED`);
        continue;
      }

      const uncatlgMatch = line.match(/UNCATLG\s+DSNAME=([A-Z0-9.]+)/i);
      if (uncatlgMatch) {
        catalog.setCatalogStatus(uncatlgMatch[1], false);
        spool.sysmsg(`IEH103I DSNAME ${uncatlgMatch[1]} UNCATALOGED`);
        continue;
      }
    }

    spool.sysmsg(`IEH002I IEHPROGM FINISHED. RC=${maxRC}`);
    return { returnCode: maxRC, output: 'IEHPROGM PROCESSING FINISHED' };
  }
}

module.exports = { IEHPROGMUtility };
