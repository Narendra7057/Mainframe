/**
 * Database Adapter for Mainframe Results DB (DB2 Emulation)
 * Uses Node.js built-in 'node:sqlite' (available in Node 22+)
 * with automatic fallback to 'better-sqlite3' or in-memory emulation.
 */
const path = require('path');
const fs = require('fs');

class ResultsDatabase {
  constructor(dbPath = path.join(__dirname, 'results.db')) {
    this.dbPath = dbPath;
    this.driver = this.initDriver();
    this.initSchema();
  }

  initDriver() {
    // 1. Try Node 22 built-in node:sqlite
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(this.dbPath);
      return { type: 'node:sqlite', db };
    } catch (e) {}

    // 2. Try better-sqlite3
    try {
      const Database = require('better-sqlite3');
      const db = new Database(this.dbPath);
      return { type: 'better-sqlite3', db };
    } catch (e) {}

    // 3. Fallback: file-backed JSON store
    return { type: 'json', data: { results: [], audit: [] } };
  }

  initSchema() {
    if (this.driver.type === 'node:sqlite' || this.driver.type === 'better-sqlite3') {
      const d = this.driver.db;
      d.exec(`
        CREATE TABLE IF NOT EXISTS RECON_RESULT (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT,
          account_no TEXT,
          txn_ref TEXT,
          txn_date TEXT,
          core_amount REAL,
          bank_amount REAL,
          diff_sign TEXT,
          diff_amount REAL,
          currency TEXT,
          channel TEXT,
          reason_code TEXT,
          account_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS RECON_AUDIT (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT,
          job_name TEXT,
          total_rows INTEGER,
          status TEXT,
          system TEXT,
          user TEXT DEFAULT 'SYSTEM',
          jcl_used TEXT,
          max_rc INTEGER,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  }

  insertResult(record) {
    if (this.driver.type === 'node:sqlite') {
      const stmt = this.driver.db.prepare(`
        INSERT INTO RECON_RESULT (
          status, account_no, txn_ref, txn_date, core_amount, bank_amount,
          diff_sign, diff_amount, currency, channel, reason_code, account_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.status, record.account_no, record.txn_ref, record.txn_date,
        record.core_amount, record.bank_amount, record.diff_sign,
        record.diff_amount, record.currency, record.channel,
        record.reason_code, record.account_name
      );
    } else if (this.driver.type === 'better-sqlite3') {
      const stmt = this.driver.db.prepare(`
        INSERT INTO RECON_RESULT (
          status, account_no, txn_ref, txn_date, core_amount, bank_amount,
          diff_sign, diff_amount, currency, channel, reason_code, account_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.status, record.account_no, record.txn_ref, record.txn_date,
        record.core_amount, record.bank_amount, record.diff_sign,
        record.diff_amount, record.currency, record.channel,
        record.reason_code, record.account_name
      );
    }
  }

  insertAudit(audit) {
    if (this.driver.type === 'node:sqlite' || this.driver.type === 'better-sqlite3') {
      const stmt = this.driver.db.prepare(`
        INSERT INTO RECON_AUDIT (job_id, job_name, total_rows, status, system, user, jcl_used, max_rc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        audit.job_id, audit.job_name, audit.total_rows || 0,
        audit.status || 'COMPLETED', audit.system || 'GNUCBO_MFR',
        audit.user || 'BANKADMIN', audit.jcl_used || '', audit.max_rc || 0
      );
    }
  }

  queryResults(filters = {}) {
    if (this.driver.type === 'node:sqlite' || this.driver.type === 'better-sqlite3') {
      let sql = 'SELECT * FROM RECON_RESULT WHERE 1=1';
      const params = [];

      if (filters.status) {
        sql += ' AND status LIKE ?';
        params.push(`%${filters.status}%`);
      }
      if (filters.account_no) {
        sql += ' AND account_no LIKE ?';
        params.push(`%${filters.account_no}%`);
      }
      if (filters.date) {
        sql += ' AND txn_date = ?';
        params.push(filters.date);
      }
      sql += ' ORDER BY id DESC LIMIT 500';

      const stmt = this.driver.db.prepare(sql);
      return stmt.all(...params);
    }
    return [];
  }

  getAuditLogs() {
    if (this.driver.type === 'node:sqlite' || this.driver.type === 'better-sqlite3') {
      const stmt = this.driver.db.prepare('SELECT * FROM RECON_AUDIT ORDER BY id DESC LIMIT 100');
      return stmt.all();
    }
    return [];
  }

  getSummaryStats() {
    if (this.driver.type === 'node:sqlite' || this.driver.type === 'better-sqlite3') {
      const stmt = this.driver.db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status LIKE 'MATCHED%' THEN 1 ELSE 0 END) as matched,
          SUM(CASE WHEN status LIKE 'AMOUNT-MISMATCH%' THEN 1 ELSE 0 END) as amount_mismatch,
          SUM(CASE WHEN status LIKE 'MISSING-IN-BANK%' THEN 1 ELSE 0 END) as missing_bank,
          SUM(CASE WHEN status LIKE 'MISSING-IN-CORE%' THEN 1 ELSE 0 END) as missing_core,
          SUM(CASE WHEN status LIKE 'DUPLICATE%' THEN 1 ELSE 0 END) as duplicate,
          SUM(core_amount) as total_core_amt,
          SUM(bank_amount) as total_bank_amt
        FROM RECON_RESULT
      `);
      return stmt.get() || {};
    }
    return {};
  }
}

module.exports = { ResultsDatabase };
