/**
 * Mainframe Catalog and Dataset Manager
 * Emulates z/OS System Catalog (ICF / Master & User Catalogs)
 * Manages PS, PDS, VSAM KSDS, and GDG generations.
 */
const fs = require('fs');
const path = require('path');

class CatalogManager {
  constructor(dataRoot = path.join(__dirname, '..', 'data')) {
    this.dataRoot = dataRoot;
    this.catalogFile = path.join(this.dataRoot, 'catalog.json');
    this.lockTable = new Map(); // Emulates GRS/Enqueue for dataset sharing
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dataRoot)) {
      fs.mkdirSync(this.dataRoot, { recursive: true });
    }
    if (!fs.existsSync(this.catalogFile)) {
      this.saveCatalog({
        datasets: {},
        gdgBases: {},
        version: '1.0',
        system: 'MVS/ESA 3.8J - GNUCBO EMULATOR'
      });
    }
  }

  loadCatalog() {
    try {
      const data = fs.readFileSync(this.catalogFile, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return { datasets: {}, gdgBases: {} };
    }
  }

  saveCatalog(cat) {
    fs.writeFileSync(this.catalogFile, JSON.stringify(cat, null, 2), 'utf8');
  }

  getDatasetPhysicalPath(dsname) {
    // Sanitize mainframe dataset name to file path: BANK.PROD.CORETXN -> BANK/PROD/CORETXN.dat
    const cleanName = dsname.trim().toUpperCase();
    const parts = cleanName.split('.');
    const dir = path.join(this.dataRoot, ...parts.slice(0, -1));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fileName = parts[parts.length - 1] + '.dat';
    return path.join(dir, fileName);
  }

  /**
   * Resolve a dataset name, including relative GDG names like (+1), (0), (-1)
   */
  resolveDatasetName(dsname, isNewGeneration = false) {
    const gdgMatch = dsname.match(/^([A-Z0-9.]+)\(([+-]?\d+)\)$/i);
    if (!gdgMatch) {
      return { baseName: dsname.toUpperCase(), resolvedName: dsname.toUpperCase(), isGdg: false };
    }

    const baseName = gdgMatch[1].toUpperCase();
    const relOffset = parseInt(gdgMatch[2], 10);
    const cat = this.loadCatalog();
    const gdg = cat.gdgBases[baseName];

    if (!gdg) {
      throw new Error(`IDC3009I GDG BASE NOT FOUND: ${baseName}`);
    }

    const gens = gdg.generations || [];
    const currentGen = gens.length > 0 ? gens[gens.length - 1].genNumber : 0;

    let targetGenNum;
    if (isNewGeneration || relOffset > 0) {
      targetGenNum = currentGen + (relOffset > 0 ? relOffset : 1);
    } else {
      const targetIndex = gens.length - 1 + relOffset;
      if (targetIndex < 0 || targetIndex >= gens.length) {
        throw new Error(`IEF212I GDG GENERATION NOT FOUND: ${dsname}`);
      }
      return {
        baseName,
        resolvedName: gens[targetIndex].dsname,
        isGdg: true,
        genNumber: gens[targetIndex].genNumber,
        isNew: false
      };
    }

    const genStr = String(targetGenNum).padStart(4, '0');
    const resolvedName = `${baseName}.G${genStr}V00`;
    return {
      baseName,
      resolvedName,
      isGdg: true,
      genNumber: targetGenNum,
      isNew: true
    };
  }

  /**
   * Validate DCB parameters
   */
  validateDCB(dcb) {
    const errors = [];
    if (!dcb) return errors;

    const recfm = (dcb.recfm || dcb.RECFM || 'FB').toUpperCase();
    const lrecl = parseInt(dcb.lrecl || dcb.LRECL || 80, 10);
    const blksize = parseInt(dcb.blksize || dcb.BLKSIZE || lrecl * 10, 10);

    if (!['F', 'FB', 'V', 'VB', 'U'].includes(recfm)) {
      errors.push(`IEF244I INVALID RECFM: ${recfm}`);
    }
    if (isNaN(lrecl) || lrecl <= 0) {
      errors.push(`IEF244I INVALID LRECL: ${lrecl}`);
    }
    if (recfm === 'FB' && blksize % lrecl !== 0) {
      errors.push(`IEF244I BLKSIZE (${blksize}) MUST BE A MULTIPLE OF LRECL (${lrecl}) FOR RECFM=FB`);
    }
    return errors;
  }

  /**
   * Validate SPACE parameters
   */
  validateSPACE(space) {
    const errors = [];
    if (!space) return errors;
    if (typeof space === 'string') {
      // Parse (TRK, (5, 2), RLSE)
      const match = space.match(/\((TRK|CYL|\d+),\s*\(([0-9]+)(?:,\s*([0-9]+))?\)(?:,\s*(RLSE))?\)/i);
      if (!match) {
        errors.push(`IEF244I INVALID SPACE SPECIFICATION: ${space}`);
      }
    }
    return errors;
  }

  /**
   * Define GDG Base (IDCAMS DEFINE GDG)
   */
  defineGDG(baseName, limit = 5, scratch = true) {
    const cat = this.loadCatalog();
    const name = baseName.toUpperCase();
    if (cat.gdgBases[name] && cat.gdgBases[name].generations) {
      for (const gen of cat.gdgBases[name].generations) {
        if (scratch && fs.existsSync(gen.filePath)) {
          try { fs.unlinkSync(gen.filePath); } catch (e) {}
        }
        delete cat.datasets[gen.dsname];
      }
    }
    for (const dsn of Object.keys(cat.datasets)) {
      if (dsn.startsWith(`${name}.G`)) {
        if (scratch && cat.datasets[dsn].filePath && fs.existsSync(cat.datasets[dsn].filePath)) {
          try { fs.unlinkSync(cat.datasets[dsn].filePath); } catch (e) {}
        }
        delete cat.datasets[dsn];
      }
    }
    cat.gdgBases[name] = {
      name,
      limit: parseInt(limit, 10) || 5,
      scratch: !!scratch,
      generations: [],
      created: new Date().toISOString()
    };
    this.saveCatalog(cat);
    return { status: 'OK', message: `IDC0001I GDG BASE ${name} DEFINED WITH LIMIT ${limit}` };
  }

  /**
   * Define VSAM Cluster (IDCAMS DEFINE CLUSTER)
   */
  defineCluster(params) {
    const { name, keys, recordsize, freespace, volumes, cylinders, tracks } = params;
    const cat = this.loadCatalog();
    const dsname = name.toUpperCase();

    if (cat.datasets[dsname]) {
      throw new Error(`IDC3009I DUPLICATE DATASET NAME ON VOLUME: ${dsname}`);
    }

    const keyLen = keys ? parseInt(keys.length || keys[0] || 12, 10) : 12;
    const keyOffset = keys ? parseInt(keys.offset || keys[1] || 0, 10) : 0;
    const recAvg = recordsize ? parseInt(recordsize.avg || recordsize[0] || 80, 10) : 80;
    const recMax = recordsize ? parseInt(recordsize.max || recordsize[1] || 80, 10) : 80;

    const filePath = this.getDatasetPhysicalPath(dsname);
    // Create empty file if not exists
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }

    cat.datasets[dsname] = {
      name: dsname,
      type: 'VSAM_KSDS',
      recfm: 'FB',
      lrecl: recMax,
      blksize: recMax * 10,
      keys: { length: keyLen, offset: keyOffset },
      recordsize: { avg: recAvg, max: recMax },
      freespace: freespace || [10, 10],
      unit: 'SYSDA',
      volser: (volumes && volumes[0]) || 'WORK01',
      space: { unit: cylinders ? 'CYL' : 'TRK', primary: cylinders || tracks || 5, secondary: 2 },
      cataloged: true,
      filePath,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    this.saveCatalog(cat);
    return { status: 'OK', message: `IDC0001I CLUSTER ${dsname} SUCCESSFULLY DEFINED` };
  }

  /**
   * Allocate dataset (IEFBR14 or JCL DD with DISP=(NEW,CATLG,DELETE))
   */
  allocateDataset(options) {
    const {
      name,
      type = 'PS',
      dcb = {},
      space = { unit: 'TRK', primary: 5, secondary: 2 },
      unit = 'SYSDA',
      volser = 'WORK01',
      disp = ['NEW', 'CATLG', 'DELETE']
    } = options;

    const initialDisp = (disp[0] || 'NEW').toUpperCase();
    const normalDisp = (disp[1] || 'CATLG').toUpperCase();

    const resolution = this.resolveDatasetName(name, initialDisp === 'NEW');
    const resolvedName = resolution.resolvedName;

    const cat = this.loadCatalog();
    const exists = !!cat.datasets[resolvedName];

    // DISP semantics: NEW fails if dataset exists
    if (initialDisp === 'NEW' && exists) {
      throw new Error(`IEF212I DATA SET ALREADY EXISTS: ${resolvedName}`);
    }

    // OLD/SHR fails if dataset does not exist
    if ((initialDisp === 'OLD' || initialDisp === 'SHR') && !exists) {
      throw new Error(`IEF212I DATA SET NOT FOUND: ${resolvedName}`);
    }

    const dcbErrors = this.validateDCB(dcb);
    if (dcbErrors.length > 0) {
      throw new Error(dcbErrors.join('; '));
    }

    const filePath = this.getDatasetPhysicalPath(resolvedName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }

    const lrecl = parseInt(dcb.lrecl || dcb.LRECL || 80, 10);
    const recfm = (dcb.recfm || dcb.RECFM || 'FB').toUpperCase();
    const blksize = parseInt(dcb.blksize || dcb.BLKSIZE || lrecl * 10, 10);

    const dsEntry = {
      name: resolvedName,
      baseName: resolution.baseName,
      type: resolution.isGdg ? 'GDG_GEN' : type,
      recfm,
      lrecl,
      blksize,
      space,
      unit,
      volser,
      cataloged: normalDisp === 'CATLG',
      filePath,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    cat.datasets[resolvedName] = dsEntry;

    // If GDG generation, register with GDG Base
    if (resolution.isGdg && cat.gdgBases[resolution.baseName]) {
      const gdg = cat.gdgBases[resolution.baseName];
      if (!gdg.generations) gdg.generations = [];
      const genObj = {
        genNumber: resolution.genNumber,
        dsname: resolvedName,
        filePath,
        created: dsEntry.created
      };
      // Keep sorted by genNumber
      gdg.generations = gdg.generations.filter(g => g.genNumber !== resolution.genNumber);
      gdg.generations.push(genObj);
      gdg.generations.sort((a, b) => a.genNumber - b.genNumber);

      // Check limit
      while (gdg.generations.length > gdg.limit) {
        const purged = gdg.generations.shift();
        if (gdg.scratch && fs.existsSync(purged.filePath)) {
          fs.unlinkSync(purged.filePath);
        }
        delete cat.datasets[purged.dsname];
      }
    }

    this.saveCatalog(cat);
    return {
      status: 'OK',
      dataset: dsEntry,
      message: `IEF285I ${resolvedName} ALLOCATED ON ${volser}`
    };
  }

  /**
   * Delete dataset (IEFBR14 with DISP=(OLD,DELETE) or IDCAMS DELETE ... PURGE)
   */
  deleteDataset(dsname, purge = false) {
    const resolution = this.resolveDatasetName(dsname);
    const resolvedName = resolution.resolvedName;
    const cat = this.loadCatalog();

    // Check if it is a GDG base
    if (cat.gdgBases[resolvedName]) {
      const gdg = cat.gdgBases[resolvedName];
      if (purge && gdg.generations) {
        for (const gen of gdg.generations) {
          if (fs.existsSync(gen.filePath)) {
            try { fs.unlinkSync(gen.filePath); } catch (e) {}
          }
          delete cat.datasets[gen.dsname];
        }
      }
      for (const dsn of Object.keys(cat.datasets)) {
        if (dsn.startsWith(`${resolvedName}.G`)) {
          if (purge && cat.datasets[dsn].filePath && fs.existsSync(cat.datasets[dsn].filePath)) {
            try { fs.unlinkSync(cat.datasets[dsn].filePath); } catch (e) {}
          }
          delete cat.datasets[dsn];
        }
      }
      delete cat.gdgBases[resolvedName];
      this.saveCatalog(cat);
      return { status: 'OK', message: `IDC0550I GDG BASE ${resolvedName} DELETED` };
    }

    const ds = cat.datasets[resolvedName];
    if (!ds) {
      // Check physical file on disk
      const pPath = this.getDatasetPhysicalPath(resolvedName);
      if (fs.existsSync(pPath)) {
        fs.unlinkSync(pPath);
        return { status: 'OK', message: `IEF285I ${resolvedName} DELETED` };
      }
      throw new Error(`IEF212I DATA SET NOT FOUND FOR DELETE: ${resolvedName}`);
    }

    if (fs.existsSync(ds.filePath)) {
      fs.unlinkSync(ds.filePath);
    }
    delete cat.datasets[resolvedName];

    // If GDG generation, remove from base
    if (resolution.isGdg && cat.gdgBases[resolution.baseName]) {
      const gdg = cat.gdgBases[resolution.baseName];
      gdg.generations = (gdg.generations || []).filter(g => g.dsname !== resolvedName);
    }

    this.saveCatalog(cat);
    return { status: 'OK', message: `IEF285I ${resolvedName} DELETED ON ${ds.volser || 'WORK01'}` };
  }

  /**
   * Rename dataset (IDCAMS ALTER NEWNAME or IEHPROGM RENAME)
   */
  renameDataset(oldName, newName) {
    const cat = this.loadCatalog();
    const oldRes = this.resolveDatasetName(oldName).resolvedName;
    const newRes = this.resolveDatasetName(newName).resolvedName;

    if (!cat.datasets[oldRes]) {
      throw new Error(`IDC3009I ENTRY NOT FOUND FOR ALTER: ${oldRes}`);
    }
    if (cat.datasets[newRes]) {
      throw new Error(`IDC3009I NEWNAME ALREADY EXISTS: ${newRes}`);
    }

    const oldDs = cat.datasets[oldRes];
    const newFilePath = this.getDatasetPhysicalPath(newRes);

    if (fs.existsSync(oldDs.filePath)) {
      fs.renameSync(oldDs.filePath, newFilePath);
    }

    delete cat.datasets[oldRes];
    oldDs.name = newRes;
    oldDs.filePath = newFilePath;
    oldDs.updated = new Date().toISOString();
    cat.datasets[newRes] = oldDs;

    this.saveCatalog(cat);
    return { status: 'OK', message: `IDC0531I ENTRY ${oldRes} ALTERED TO ${newRes}` };
  }

  /**
   * Catalog / Uncatalog dataset
   */
  setCatalogStatus(dsname, cataloged = true) {
    const cat = this.loadCatalog();
    const resolvedName = this.resolveDatasetName(dsname).resolvedName;
    const ds = cat.datasets[resolvedName];
    if (!ds) {
      throw new Error(`IEF212I DATA SET NOT FOUND: ${resolvedName}`);
    }
    ds.cataloged = !!cataloged;
    ds.updated = new Date().toISOString();
    this.saveCatalog(cat);
    return {
      status: 'OK',
      message: cataloged
        ? `IEF285I ${resolvedName} CATALOGED`
        : `IEF285I ${resolvedName} UNCATALOGED`
    };
  }

  /**
   * List catalog entries (IDCAMS LISTCAT)
   */
  listCatalog(filter = '') {
    const cat = this.loadCatalog();
    const result = [];
    const filterUpper = filter.trim().toUpperCase();

    // Regular datasets
    for (const [name, ds] of Object.entries(cat.datasets)) {
      if (!filterUpper || name.includes(filterUpper)) {
        let recordCount = 0;
        let sizeBytes = 0;
        if (fs.existsSync(ds.filePath)) {
          const stat = fs.statSync(ds.filePath);
          sizeBytes = stat.size;
          const content = fs.readFileSync(ds.filePath, 'utf8');
          recordCount = content.split('\n').filter(line => line.length > 0).length;
        }
        result.push({
          ...ds,
          recordCount,
          sizeBytes
        });
      }
    }

    // GDG Bases
    for (const [name, gdg] of Object.entries(cat.gdgBases)) {
      if (!filterUpper || name.includes(filterUpper)) {
        result.push({
          name: gdg.name,
          type: 'GDG_BASE',
          recfm: 'N/A',
          lrecl: 0,
          blksize: 0,
          unit: 'SYSDA',
          volser: 'CATALOG',
          cataloged: true,
          limit: gdg.limit,
          scratch: gdg.scratch,
          generationsCount: (gdg.generations || []).length,
          generations: gdg.generations,
          created: gdg.created
        });
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Read dataset records (first N records or all)
   */
  readDataset(dsname, limit = 100) {
    const resolved = this.resolveDatasetName(dsname);
    const cat = this.loadCatalog();
    const ds = cat.datasets[resolved.resolvedName];

    let filePath;
    if (ds && ds.filePath) {
      filePath = ds.filePath;
    } else {
      filePath = this.getDatasetPhysicalPath(resolved.resolvedName);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`IEF212I DATA SET NOT FOUND: ${resolved.resolvedName}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.length > 0);
    const records = limit ? lines.slice(0, limit) : lines;

    return {
      name: resolved.resolvedName,
      attributes: ds || { name: resolved.resolvedName, type: 'PS', lrecl: 80, recfm: 'FB' },
      totalRecords: lines.length,
      returnedRecords: records.length,
      records
    };
  }

  /**
   * Write dataset records
   */
  writeDataset(dsname, records, append = false) {
    const resolved = this.resolveDatasetName(dsname);
    const cat = this.loadCatalog();
    let ds = cat.datasets[resolved.resolvedName];

    let filePath;
    if (ds && ds.filePath) {
      filePath = ds.filePath;
    } else {
      filePath = this.getDatasetPhysicalPath(resolved.resolvedName);
    }

    const textData = Array.isArray(records) ? records.join('\n') + '\n' : String(records);
    if (append && fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, textData, 'utf8');
    } else {
      fs.writeFileSync(filePath, textData, 'utf8');
    }

    if (ds) {
      ds.updated = new Date().toISOString();
      this.saveCatalog(cat);
    }
    return { status: 'OK', recordsWritten: Array.isArray(records) ? records.length : 1 };
  }
}

module.exports = { CatalogManager };
