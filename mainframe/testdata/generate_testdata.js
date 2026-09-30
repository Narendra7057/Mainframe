const fs = require('fs');
const path = require('path');

function pad(str, len) {
  return String(str || '').padEnd(len).substring(0, len);
}

function padNum(num, len) {
  return String(num || 0).padStart(len, '0').substring(0, len);
}

function makeTxn(acct, ref, date, type, amt, curr, chan) {
  // acct(12) + ref(16) + date(8) + type(2) + amt(13) + curr(3) + chan(4) + filler(22) = 80
  const sAcct = pad(acct, 12);
  const sRef = pad(ref, 16);
  const sDate = padNum(date, 8);
  const sType = pad(type, 2);
  const sAmt = padNum(amt, 13);
  const sCurr = pad(curr, 3);
  const sChan = pad(chan, 4);
  const sFiller = ''.padEnd(22, ' ');
  const rec = `${sAcct}${sRef}${sDate}${sType}${sAmt}${sCurr}${sChan}${sFiller}`;
  if (rec.length !== 80) throw new Error(`Invalid record length: ${rec.length}`);
  return rec;
}

const dir = __dirname;

// 1. Core transactions (including valid, exceptions, and validation rejects)
const coreTxns = [
  // Exact Matches
  makeTxn('100000000001', 'TXN000000000101', '20260930', 'DR', 50000, 'USD', 'ATM'),
  makeTxn('100000000002', 'TXN000000000102', '20260930', 'CR', 120000, 'USD', 'ONL'),
  makeTxn('100000000003', 'TXN000000000103', '20260930', 'DR', 25050, 'USD', 'POS'),
  makeTxn('100000000004', 'TXN000000000104', '20260930', 'CR', 85000, 'USD', 'BRH'),

  // Amount Mismatch (Core has $150.00, Bank will have $155.00)
  makeTxn('100000000001', 'TXN000000000105', '20260930', 'DR', 15000, 'USD', 'POS'),

  // Missing in Bank (Only in Core)
  makeTxn('100000000002', 'TXN000000000106', '20260930', 'DR', 30000, 'USD', 'ATM'),

  // Duplicate Reference in Core (repeated twice)
  makeTxn('100000000003', 'TXN000000000107', '20260930', 'DR', 10000, 'USD', 'ONL'),
  makeTxn('100000000003', 'TXN000000000107', '20260930', 'DR', 10000, 'USD', 'ONL'),

  // Unknown Account (not in VSAM master)
  makeTxn('999999999999', 'TXN000000000108', '20260930', 'DR', 7500, 'USD', 'POS'),

  // Planted Validation Errors (filtered out by TXNVALID)
  `${pad('', 12)}${pad('TXN000000000901', 16)}20260930DR${padNum(10000, 13)}USDATM${''.padEnd(22)}`, // blank acct
  `${pad('100000000001', 12)}${pad('', 16)}20260930DR${padNum(10000, 13)}USDATM${''.padEnd(22)}`, // blank ref
  `${pad('100000000001', 12)}${pad('TXN000000000903', 16)}20261345DR${padNum(10000, 13)}USDATM${''.padEnd(22)}`, // bad date
  `${pad('100000000001', 12)}${pad('TXN000000000904', 16)}20260930DR0000000012A00USDATM${''.padEnd(22)}`, // non-numeric amt
  `${pad('100000000001', 12)}${pad('TXN000000000905', 16)}20260930DR0000000000000USDATM${''.padEnd(22)}`, // zero amt
  `${pad('100000000001', 12)}${pad('TXN000000000906', 16)}20260930XX0000000010000USDATM${''.padEnd(22)}`  // bad type
];

// 2. Bank transactions
const bankTxns = [
  // Exact Matches
  makeTxn('100000000001', 'TXN000000000101', '20260930', 'DR', 50000, 'USD', 'ATM'),
  makeTxn('100000000002', 'TXN000000000102', '20260930', 'CR', 120000, 'USD', 'ONL'),
  makeTxn('100000000003', 'TXN000000000103', '20260930', 'DR', 25050, 'USD', 'POS'),
  makeTxn('100000000004', 'TXN000000000104', '20260930', 'CR', 85000, 'USD', 'BRH'),

  // Amount Mismatch (Bank has $155.00 vs Core $150.00)
  makeTxn('100000000001', 'TXN000000000105', '20260930', 'DR', 15500, 'USD', 'POS'),

  // Missing in Core (Only in Bank)
  makeTxn('100000000005', 'TXN000000000201', '20260930', 'CR', 45000, 'USD', 'ONL'),

  // Duplicate Reference in Bank
  makeTxn('100000000006', 'TXN000000000202', '20260930', 'CR', 20000, 'USD', 'POS'),
  makeTxn('100000000006', 'TXN000000000202', '20260930', 'CR', 20000, 'USD', 'POS')
];

fs.writeFileSync(path.join(dir, 'CORETXN_INPUT.dat'), coreTxns.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(dir, 'BANKTXN_INPUT.dat'), bankTxns.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(dir, 'EMPTY_INPUT.dat'), '', 'utf8');

console.log('Test datasets generated successfully:');
console.log(`  CORETXN_INPUT.dat : ${coreTxns.length} records`);
console.log(`  BANKTXN_INPUT.dat : ${bankTxns.length} records`);
console.log(`  EMPTY_INPUT.dat   : 0 records`);
