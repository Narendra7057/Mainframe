/**
 * Utility: SORT / ICEMAN (DFSORT / SyncSort Emulator)
 * Sorts sequential dataset (SORTIN) to (SORTOUT) based on SYSIN control statements:
 * Example: SORT FIELDS=(1,12,CH,A,13,16,CH,A)
 */

class SortUtility {
  static async execute(step, context) {
    const { spool, catalog } = context;
    const sortinDD = step.dd.SORTIN;
    const sortoutDD = step.dd.SORTOUT;
    const sysinData = (step.dd.SYSIN && step.dd.SYSIN.instreamData) || [];

    spool.sysmsg(`ICE000I DFSORT/ICEMAN SORT ENGINE INITIATED`);

    if (!sortinDD) {
      throw new Error(`ICE001A MISSING SORTIN DD STATEMENT`);
    }
    if (!sortoutDD) {
      throw new Error(`ICE002A MISSING SORTOUT DD STATEMENT`);
    }

    const sortinDsn = sortinDD.dsn;
    const sortoutDsn = sortoutDD.dsn;

    const inData = catalog.readDataset(sortinDsn, 0); // read all records
    const records = [...inData.records];

    spool.sysmsg(`ICE083I RECORDS IN FROM SORTIN: ${records.length}`);

    // Parse SORT FIELDS=(...)
    const fields = SortUtility.parseSortFields(sysinData);

    records.sort((a, b) => {
      for (const f of fields) {
        // f.start is 1-indexed
        const valA = a.substring(f.start - 1, f.start - 1 + f.length);
        const valB = b.substring(f.start - 1, f.start - 1 + f.length);

        let cmp = 0;
        if (f.format === 'CH' || f.format === 'ZD' || f.format === 'BI') {
          cmp = valA.localeCompare(valB);
        } else {
          cmp = valA.localeCompare(valB);
        }

        if (cmp !== 0) {
          return f.order === 'D' ? -cmp : cmp;
        }
      }
      return 0;
    });

    catalog.writeDataset(sortoutDsn, records, false);
    spool.sysmsg(`ICE084I RECORDS OUT TO SORTOUT: ${records.length}`);
    spool.sysmsg(`ICE054I HIGHEST RETURN CODE WAS 0`);

    return {
      returnCode: 0,
      output: `SORT COMPLETED SUCCESSFULLY. ${records.length} RECORDS SORTED.`
    };
  }

  static parseSortFields(sysinLines) {
    const fullText = sysinLines.join(' ');
    // Look for SORT FIELDS=(...)
    const match = fullText.match(/SORT\s+FIELDS\s*=\s*\(([^)]+)\)/i);
    if (!match) {
      // Default fallback: sort by first 12 characters ascending
      return [{ start: 1, length: 12, format: 'CH', order: 'A' }];
    }

    const params = match[1].split(',').map(s => s.trim().toUpperCase());
    const fields = [];

    for (let i = 0; i < params.length; i += 4) {
      if (i + 3 < params.length) {
        fields.push({
          start: parseInt(params[i], 10),
          length: parseInt(params[i + 1], 10),
          format: params[i + 2],
          order: params[i + 3]
        });
      }
    }

    return fields.length > 0 ? fields : [{ start: 1, length: 12, format: 'CH', order: 'A' }];
  }
}

module.exports = { SortUtility };
