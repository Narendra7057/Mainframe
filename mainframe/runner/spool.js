/**
 * Mainframe JES Spool Manager
 * Manages JESMSGLG, JESJCL, JESYSMSG, and SYSOUT streams for every job.
 */
const fs = require('fs');
const path = require('path');

class SpoolManager {
  constructor(jobId, jobName, spoolRoot = path.join(__dirname, '..', 'data', 'spool')) {
    this.jobId = jobId;
    this.jobName = jobName;
    this.spoolRoot = spoolRoot;
    this.jobDir = path.join(this.spoolRoot, this.jobId);

    this.jesmsglg = [];
    this.jesjcl = [];
    this.jesysmsg = [];
    this.sysoutData = [];
    this.startTime = new Date();
    this.endTime = null;
    this.maxRC = 0;
    this.status = 'ACTIVE';

    this.init();
  }

  init() {
    if (!fs.existsSync(this.jobDir)) {
      fs.mkdirSync(this.jobDir, { recursive: true });
    }
    const startStr = this.startTime.toISOString();
    this.msglg(`$HASP373 ${this.jobName} STARTED - INIT  1 - CLASS A - SYS GNUCBO`);
    this.msglg(`IEF677I WARN MSG: DATA SET RESTRICTIONS IN EFFECT`);
  }

  msglg(msg) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    this.jesmsglg.push(`${timestamp} ${msg}`);
  }

  jcl(line) {
    this.jesjcl.push(line);
  }

  sysmsg(msg) {
    this.jesysmsg.push(msg);
  }

  sysout(data) {
    this.sysoutData.push(data);
  }

  finalize(maxRC, status = 'COMPLETED') {
    this.endTime = new Date();
    this.maxRC = maxRC;
    this.status = status;
    const durSec = ((this.endTime - this.startTime) / 1000).toFixed(2);

    this.msglg(`$HASP395 ${this.jobName} ENDED - MAX CC=${String(maxRC).padStart(4, '0')} - ELAPSED ${durSec} SEC`);
    this.sysmsg(`IEF142I ${this.jobName} ALL STEPS COMPLETED - HIGHEST COND CODE: ${maxRC}`);

    this.persist();
  }

  persist() {
    fs.writeFileSync(path.join(this.jobDir, 'JESMSGLG.txt'), this.jesmsglg.join('\n'), 'utf8');
    fs.writeFileSync(path.join(this.jobDir, 'JESJCL.txt'), this.jesjcl.join('\n'), 'utf8');
    fs.writeFileSync(path.join(this.jobDir, 'JESYSMSG.txt'), this.jesysmsg.join('\n'), 'utf8');
    fs.writeFileSync(path.join(this.jobDir, 'SYSOUT.txt'), this.sysoutData.join('\n'), 'utf8');

    const meta = {
      jobId: this.jobId,
      jobName: this.jobName,
      status: this.status,
      maxRC: this.maxRC,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime ? this.endTime.toISOString() : null
    };
    fs.writeFileSync(path.join(this.jobDir, 'job-meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  }

  getSpoolOutputs() {
    return {
      jobId: this.jobId,
      jobName: this.jobName,
      status: this.status,
      maxRC: this.maxRC,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime ? this.endTime.toISOString() : null,
      JESMSGLG: this.jesmsglg.join('\n'),
      JESJCL: this.jesjcl.join('\n'),
      JESYSMSG: this.jesysmsg.join('\n'),
      SYSOUT: this.sysoutData.join('\n')
    };
  }

  static readSpool(jobId, spoolRoot = path.join(__dirname, '..', 'data', 'spool')) {
    const jobDir = path.join(spoolRoot, jobId);
    if (!fs.existsSync(jobDir)) return null;

    const readSafe = (name) => {
      const p = path.join(jobDir, name);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    };

    let meta = {};
    const metaPath = path.join(jobDir, 'job-meta.json');
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }

    return {
      ...meta,
      JESMSGLG: readSafe('JESMSGLG.txt'),
      JESJCL: readSafe('JESJCL.txt'),
      JESYSMSG: readSafe('JESYSMSG.txt'),
      SYSOUT: readSafe('SYSOUT.txt')
    };
  }
}

module.exports = { SpoolManager };
