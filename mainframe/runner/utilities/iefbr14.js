/**
 * Utility: IEFBR14
 * Standard IBM MVS/zOS dummy utility.
 * Always returns RC=0.
 * Its purpose is to trigger DD statement allocation and disposition processing
 * (creating, cataloging, deleting datasets).
 */

class IEFBR14Utility {
  static async execute(step, context) {
    const { spool, catalog } = context;
    spool.sysmsg(`IEF142I ${context.jobName} ${step.stepName} - STEP WAS EXECUTED - COND CODE 0000`);
    return {
      returnCode: 0,
      output: 'IEFBR14 EXECUTED SUCCESSFULLY - DATASET ALLOCATIONS AND DISPOSITIONS APPLIED'
    };
  }
}

module.exports = { IEFBR14Utility };
