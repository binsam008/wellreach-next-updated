/* WELL REACH LOGISTICS — core API (mirrors every function of the original Code.gs + accounting).
   Runs unchanged in Node (server.js, file storage) and in the browser (offline mode, localStorage). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WRLCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var S = function (v) { return (v === undefined || v === null) ? '' : String(v); };
  var N = function (v) { return parseFloat(v) || 0; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var same = function (a, b) { return S(a).trim().toLowerCase() === S(b).trim().toLowerCase(); };

  function mkB(name, country, taxLabel) {
    return { name: name, country: country, companyName: 'Well Reach Logistics', address: '', phone: '', email: '', taxLabel: taxLabel,
      taxNo: '', bankName: '', accountName: 'Well Reach Logistics', accountNo: '', iban: '', ifsc: '', bankBranch: '' };
  }
  function defaultBranches() {
    return [mkB('Kochi (Head Office)', 'India', 'GST Registration'), mkB('Mumbai', 'India', 'GST Registration'),
      mkB('Delhi', 'India', 'GST Registration'), mkB('Chennai', 'India', 'GST Registration'),
      mkB('Bahrain (Main Office)', 'Bahrain', 'VAT Registration')];
  }
  function seedAccounts() {
    return [['1000', 'Cash', 'asset'], ['1100', 'Bank', 'asset'], ['1200', 'Accounts Receivable', 'asset'],
      ['2000', 'Accounts Payable', 'liability'], ['2100', 'Output Tax Payable (GST/VAT)', 'liability'], ['3000', "Owner's Equity", 'equity'],
      ['4000', 'Freight & Services Revenue', 'income'], ['4100', 'Other Income', 'income'], ['5000', 'Direct Shipment Costs', 'expense'], ['5100', 'Salaries & Wages', 'expense'],
      ['5200', 'Rent & Utilities', 'expense'], ['5900', 'Other Operating Expenses', 'expense']]
      .map(function (a) { return { code: a[0], name: a[1], type: a[2] }; });
  }
  var BKEYS = ['name', 'country', 'companyName', 'address', 'phone', 'email', 'taxLabel', 'taxNo',
    'bankName', 'accountName', 'accountNo', 'iban', 'ifsc', 'bankBranch'];
  function cleanBranch(b) { var o = {}; BKEYS.forEach(function (k) { o[k] = S(b[k]); }); o.country = o.country || 'India'; return o; }

  /* storage = { load(): object|null, save(object) } */
  function create(storage) {
    var db = storage.load() || {};
    function save() { storage.save(db); }
    db.branches = db.branches || defaultBranches();
    db.invoices = db.invoices || []; db.quotations = db.quotations || []; db.deliveryNotes = db.deliveryNotes || []; db.jobs = db.jobs || [];
    db.accounts = db.accounts || seedAccounts(); db.journal = db.journal || []; db.seq = db.seq || 0;
    seedAccounts().forEach(function (a) {      // accounts used by automatic postings always exist (also on older saved data)
      if (['1000', '1100', '1200', '2000', '2100', '4000', '4100', '5000'].indexOf(a.code) >= 0 && !db.accounts.some(function (x) { return x.code === a.code; })) db.accounts.push(a);
    });
    db.accounts.sort(function (x, y) { return x.code < y.code ? -1 : 1; });
    save();
    function uid() { return Date.now().toString(36) + (++db.seq).toString(36); }

    /* ---------- BRANCHES ---------- */
    function getBranches() {
      if (!db.branches.length) { db.branches = defaultBranches(); save(); }
      return db.branches.filter(function (b) { return S(b.name).trim(); }).map(cleanBranch).sort(function (a, b) {
        return a.country !== b.country ? (a.country === 'India' ? -1 : 1) : (a.name < b.name ? -1 : 1);
      });
    }
    function saveBranch(b) {
      if (!b || !b.name) throw new Error('Branch name is required.');
      var i = db.branches.findIndex(function (x) { return same(x.name, b.name); });
      if (i >= 0) db.branches[i] = cleanBranch(b); else db.branches.push(cleanBranch(b));
      save(); return getBranches();
    }
    function deleteBranch(name) {
      if (!name) throw new Error('Branch name is required.');
      var i = db.branches.findIndex(function (x) { return same(x.name, name); });
      if (i >= 0) db.branches.splice(i, 1);
      save(); return getBranches();
    }

    /* ---------- INVOICES ---------- */
    function getNextInvoiceNo() {
      var max = 0;
      db.invoices.concat(db.cancelledInvoices || []).forEach(function (i) { var m = S(i.invoiceNo).match(/(\d+)\s*$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
      return 'WRL-INV-' + ('0000' + (max + 1)).slice(-4);
    }
    function invRecord(d, id, ts) {
      var r = Object.assign({}, d); delete r.branch; delete r.originalInvoiceNo;
      ['subtotal', 'taxRate', 'taxAmount', 'grandTotal'].forEach(function (k) { r[k] = N(d[k]); });
      r.items = d.items || []; r.id = id; r.timestamp = ts; return r;
    }
    function syncData() {
      var l = db.invoices[db.invoices.length - 1];
      return { branches: getBranches(), nextInvoiceNo: getNextInvoiceNo(),
        lastInvoice: l ? { invoiceNo: S(l.invoiceNo), billTo: S(l.billTo) } : null, syncedAt: new Date().toISOString() };
    }
    function saveInvoice(d) {
      if (!d) throw new Error('No invoice data received.');
      var r = invRecord(d, uid(), new Date().toISOString());
      r.invoiceNo = S(d.invoiceNo).trim() || getNextInvoiceNo();
      db.invoices.push(r);
      if (d.branch && d.branch.name) saveBranch(d.branch);
      postInvoice(r); save();
      return { success: true, invoiceNo: r.invoiceNo, nextInvoiceNo: getNextInvoiceNo() };
    }
    function getInvoiceList() {
      return db.invoices.filter(function (i) { return S(i.invoiceNo).trim(); }).reverse().map(function (i) {
        return { invoiceNo: S(i.invoiceNo).trim(), invoiceDate: S(i.invoiceDate), billTo: S(i.billTo), grandTotal: i.grandTotal, currency: S(i.currency) };
      });
    }
    function getInvoice(no) {
      if (!no) throw new Error('Invoice number is required.');
      var r = db.invoices.find(function (x) { return S(x.invoiceNo).trim() === S(no).trim(); });
      if (!r) throw new Error('Invoice "' + no + '" not found in the system.');
      var o = {};
      ['invoiceNo', 'invoiceDate', 'branchCountry', 'companyName', 'companyAddress', 'companyPhone', 'companyEmail', 'companyTaxNo',
        'billTo', 'billToAddress', 'billToTaxNo', 'placeOfSupply', 'terms', 'shipMode', 'shipTerms', 'awbNo', 'commodity',
        'grossWeight', 'volume', 'currency', 'taxType', 'bankName', 'accountName', 'accountNo', 'iban', 'ifsc', 'bankBranch']
        .forEach(function (k) { o[k] = S(r[k]); });
      o.branch = S(r.branchName); o.taxRate = r.taxRate; o.items = r.items || [];
      return o;
    }
    function updateInvoice(d) {
      if (!d) throw new Error('No invoice data received.');
      var m = S(d.originalInvoiceNo || d.invoiceNo).trim();
      var i = db.invoices.findIndex(function (x) { return S(x.invoiceNo).trim() === m; });
      if (i < 0) throw new Error('Invoice "' + m + '" not found in the system.');
      var old = db.invoices[i], r = invRecord(d, old.id, old.timestamp);   // keeps original creation time
      r.invoiceNo = S(d.invoiceNo).trim() || m;
      db.invoices[i] = r;
      if (d.branch && d.branch.name) saveBranch(d.branch);
      postInvoice(r); save();
      return { success: true, invoiceNo: r.invoiceNo, updated: true };
    }

    /* ---------- QUOTATION / DELIVERY NOTE ---------- */
    function saveQuotation(d) {
      if (!d) throw new Error('No quotation data received.');
      db.quotations.push(Object.assign({}, d, { id: uid(), timestamp: new Date().toISOString(), items: d.items || [] }));
      save(); return { success: true, quotationNo: d.quotationNo };
    }
    function saveDeliveryNote(d) {
      if (!d) throw new Error('No delivery note data received.');
      var no = S(d.deliveryNo).trim(), rec = Object.assign({}, d, { id: uid(), timestamp: new Date().toISOString(), items: d.items || [] });
      var prev = no ? db.deliveryNotes.find(function (x) { return S(x.deliveryNo).trim() === no; }) : null;
      if (prev) { rec.id = prev.id; rec.timestamp = prev.timestamp; db.deliveryNotes = db.deliveryNotes.filter(function (x) { return S(x.deliveryNo).trim() !== no; }); }
      db.deliveryNotes.push(rec);
      save(); return { success: true, deliveryNo: d.deliveryNo };
    }

    /* ---------- ACCOUNTING (double entry) ----------
       Invoice: Dr 1200 Receivable | Cr 4000 Revenue | Cr 2100 Output Tax
       Receipt: Dr 1100 Bank / 1000 Cash | Cr 1200 Receivable            */
    function addEntry(e) { e.id = uid(); db.journal.push(e); return e; }
    function postInvoice(r) {
      db.journal = db.journal.filter(function (e) { return !(e.source === 'invoice' && e.ref === r.id); });   // edit replaces, never duplicates
      var g = r2(r.grandTotal), tax = r2(r.taxAmount);
      if (g <= 0) return;
      var lines = [{ acc: '1200', dr: g, cr: 0 }, { acc: '4000', dr: 0, cr: r2(g - tax) }];
      if (tax > 0) lines.push({ acc: '2100', dr: 0, cr: tax });
      addEntry({ date: S(r.invoiceDate) || today(), memo: 'Invoice ' + r.invoiceNo + ' — ' + S(r.billTo),
        currency: S(r.currency) || 'INR', source: 'invoice', ref: r.id, lines: lines });
    }
    function accGetAll() {
      ensureReceiptNos();
      var paid = {}, agentPaid = {}, costOf = {}, jobsOf = {};
      db.journal.forEach(function (e) {
        if (e.source === 'payment') paid[e.ref] = r2((paid[e.ref] || 0) + e.lines[1].cr);
        if (e.source === 'agentpay') agentPaid[e.ref] = r2((agentPaid[e.ref] || 0) + e.lines[0].dr);
      });
      var jobs = db.jobs.slice().reverse().map(function (jb) {
        var p = agentPaid[jb.jobNo] || 0, left = r2(jb.cost - p), profit = r2(jb.selling - jb.cost);
        var inv = jb.invoiceNo ? db.invoices.find(function (i) { return S(i.invoiceNo) === jb.invoiceNo; }) : null;
        if (jb.invoiceNo) { costOf[jb.invoiceNo] = r2((costOf[jb.invoiceNo] || 0) + jb.cost); jobsOf[jb.invoiceNo] = (jobsOf[jb.invoiceNo] || 0) + 1; }
        return { id: jb.jobNo, jobNo: jb.jobNo, jobDate: S(jb.jobDate), customer: S(jb.customer), invoiceNo: S(jb.invoiceNo), currency: S(jb.currency) || 'INR', agents: S(jb.agents),
          selling: jb.selling, cost: jb.cost, profit: profit, margin: jb.selling ? r2(profit / jb.selling * 100) : 0, paid: p, outstanding: left,
          status: jb.cost <= 0 ? '—' : (left < -0.004 ? 'Overpaid' : (left <= 0.004 ? 'Paid' : (p > 0 ? 'Partial' : 'Unpaid'))),
          invSub: inv ? r2(N(inv.grandTotal) - N(inv.taxAmount)) : null };
      });
      var invoices = db.invoices.map(function (i) {
        var p = paid[i.id] || 0, total = r2(N(i.grandTotal)), bal = r2(total - p), sub = r2(total - N(i.taxAmount)), no = S(i.invoiceNo), has = !!jobsOf[no], jc = costOf[no] || 0;
        return { id: i.id, invoiceNo: no, invoiceDate: S(i.invoiceDate), billTo: S(i.billTo), currency: S(i.currency) || 'INR',
          sub: sub, hasJob: has, jobCost: jc, profit: has ? r2(sub - jc) : null,
          grandTotal: total, paid: p, balance: bal, status: bal < -0.004 ? 'Overpaid' : (bal <= 0.004 ? 'Paid' : (p > 0 ? 'Partial' : 'Unpaid')) };
      }).reverse();
      return { accounts: db.accounts, journal: db.journal, invoices: invoices, jobs: jobs };
    }
    function accRecordPayment(p) {
      var inv = p && db.invoices.find(function (i) { return i.id === p.invoiceId; });
      if (!inv) throw new Error('Invoice not found.');
      var amt = r2(N(p.amount));
      if (amt <= 0) throw new Error('Enter a valid amount.');
      var cur = accGetAll().invoices.find(function (i) { return i.id === inv.id; });
      if (amt > cur.balance + 0.004) throw new Error('Amount exceeds the outstanding balance (' + cur.balance.toFixed(2) + ').');
      ensureReceiptNos();
      var method = p.method === 'Cash' ? 'Cash' : 'Bank';
      var made = addEntry({ date: p.date || today(), memo: 'Receipt for ' + inv.invoiceNo + (p.ref ? ' — ' + p.ref : ''),
        currency: S(inv.currency) || 'INR', source: 'payment', ref: inv.id,
        lines: [{ acc: method === 'Cash' ? '1000' : '1100', dr: amt, cr: 0 }, { acc: '1200', dr: 0, cr: amt }],
        extra: { receiptNo: nextNo('WRL-RCP-', 'receiptNo'), method: method, payRef: S(p.ref).trim() } });
      save(); var out = accGetAll(); out.receipt = buildReceipt(made); return out;
    }
    /* ---------- numbering + receipts ---------- */
    function maxNo(key, prefix) {
      var max = 0;
      db.journal.forEach(function (e) {
        var v = S(e.extra && e.extra[key]), m = /(\d+)\s*$/.exec(v);
        if (m && v.indexOf(prefix) === 0) max = Math.max(max, parseInt(m[1], 10));
      });
      return max;
    }
    function nextNo(prefix, key) { return prefix + ('0000' + (maxNo(key, prefix) + 1)).slice(-4); }
    function ensureReceiptNos() {      // receipts saved before numbers existed get one, once
      var n = maxNo('receiptNo', 'WRL-RCP-'), changed = false;
      db.journal.forEach(function (e) {
        if (e.source === 'payment' && !(e.extra && e.extra.receiptNo)) {
          n++; e.extra = e.extra || {}; e.extra.receiptNo = 'WRL-RCP-' + ('0000' + n).slice(-4);
          e.extra.method = e.extra.method || (e.lines[0].acc === '1000' ? 'Cash' : 'Bank'); changed = true;
        }
      });
      if (changed) save();
    }
    function buildReceipt(e) {
      var idx = db.journal.indexOf(e), paidTo = 0, x2 = e.extra || {};
      db.journal.forEach(function (x, i) { if (x.source === 'payment' && x.ref === e.ref && i <= idx) paidTo += x.lines[1].cr; });
      paidTo = r2(paidTo);
      var inv = db.invoices.find(function (i) { return i.id === e.ref; }) || {}, total = inv.id ? r2(N(inv.grandTotal)) : paidTo;
      return { receiptNo: x2.receiptNo || '', date: e.date, currency: e.currency, amount: e.lines[1].cr,
        method: x2.method || (e.lines[0].acc === '1000' ? 'Cash' : 'Bank'), reference: x2.payRef || '',
        invoiceNo: S(inv.invoiceNo), invoiceDate: S(inv.invoiceDate), invoiceTotal: total, paidToDate: paidTo, balance: r2(total - paidTo),
        customer: S(inv.billTo), customerAddress: S(inv.billToAddress), customerTaxNo: S(inv.billToTaxNo), country: S(inv.branchCountry),
        company: { name: S(inv.companyName), address: S(inv.companyAddress), phone: S(inv.companyPhone), email: S(inv.companyEmail), taxNo: S(inv.companyTaxNo) } };
    }
    function accGetReceipt(id) {
      ensureReceiptNos();
      var e = db.journal.find(function (x) { return x.id === id && x.source === 'payment'; });
      if (!e) throw new Error('Receipt not found.');
      return buildReceipt(e);
    }

    /* ---------- simple Income / Expense vouchers ---------- */
    function voucherCategory(kind, code, newName) {
      var found = null;
      if (newName) {
        found = db.accounts.find(function (a) { return a.type === kind && a.name.toLowerCase() === newName.toLowerCase(); });
        if (found) return found;
        var n = kind === 'expense' ? 5300 : 4200, max = kind === 'expense' ? 5899 : 4899;
        while (db.accounts.some(function (a) { return a.code === String(n); }) && n < max) n++;
        found = { code: String(n), name: newName, type: kind }; db.accounts.push(found);
        db.accounts.sort(function (x, y) { return x.code < y.code ? -1 : 1; });
        return found;
      }
      found = db.accounts.find(function (a) { return a.code === code && a.type === kind; });
      if (!found) throw new Error('Choose ' + (kind === 'expense' ? 'an expense' : 'an income') + ' category.');
      return found;
    }
    function accSaveVoucher(v) {
      if (!v) throw new Error('No voucher data received.');
      var kind = v.kind === 'income' ? 'income' : 'expense', amt = r2(N(v.amount)), existing = null;
      if (amt <= 0) throw new Error('Enter an amount greater than zero.');
      if (v.id) { existing = db.journal.find(function (e) { return e.id === v.id && e.source === 'voucher'; }); if (!existing) throw new Error('Voucher not found.'); }
      var cat = voucherCategory(kind, S(v.category).trim(), S(v.newCategory).trim());
      var payAcc = v.method === 'Cash' ? '1000' : '1100', method = payAcc === '1000' ? 'Cash' : 'Bank';
      var party = S(v.party).trim(), desc = S(v.description).trim(), ref = S(v.ref).trim();
      var entry = { id: existing ? existing.id : uid(), date: S(v.date) || today(),
        memo: (kind === 'expense' ? 'Expense: ' : 'Income: ') + cat.name + (party ? ' — ' + party : '') + (desc ? ' (' + desc + ')' : ''),
        currency: S(v.currency).trim() || 'INR', source: 'voucher', ref: '',
        lines: kind === 'expense' ? [{ acc: cat.code, dr: amt, cr: 0 }, { acc: payAcc, dr: 0, cr: amt }]
                                  : [{ acc: payAcc, dr: amt, cr: 0 }, { acc: cat.code, dr: 0, cr: amt }],
        extra: { kind: kind, voucherNo: existing ? existing.extra.voucherNo : nextNo(kind === 'expense' ? 'EXP-' : 'INC-', 'voucherNo'),
          category: cat.code, method: method, party: party, description: desc, ref: ref } };
      if (existing) db.journal[db.journal.indexOf(existing)] = entry; else db.journal.push(entry);
      save(); return accGetAll();
    }

    /* ---------- quotation -> invoice ---------- */
    function getQuotationList() {
      var out = [], at = {};
      for (var i = db.quotations.length - 1; i >= 0; i--) {          // newest first; a quotation saved twice is listed once
        var q = db.quotations[i], no = S(q.quotationNo).trim(); if (!no) continue;
        var done = q.status === 'Converted', k = 'k:' + no;
        if (at[k] === undefined) {
          at[k] = out.length;
          out.push({ quotationNo: no, quotationDate: S(q.quotationDate), quoteTo: S(q.quoteTo), currency: S(q.currency), grandTotal: N(q.grandTotal),
            status: done ? 'Converted' : 'Saved', invoiceNo: done ? S(q.convertedInvoice) : '' });
        } else if (done && out[at[k]].status !== 'Converted') { out[at[k]].status = 'Converted'; out[at[k]].invoiceNo = S(q.convertedInvoice); }
      }
      return out;
    }
    function getQuotation(no) {
      if (!no) throw new Error('Quotation number is required.');
      var want = S(no).trim(), r = null;
      for (var i = db.quotations.length - 1; i >= 0 && !r; i--) if (S(db.quotations[i].quotationNo).trim() === want) r = db.quotations[i];
      if (!r) throw new Error('Quotation "' + no + '" not found in the system.');
      var o = { quotationNo: want, items: r.items || [] };
      ['quotationDate', 'companyName', 'companyAddress', 'website', 'crNumber', 'quoteTo', 'customerAddress', 'customerMobile', 'blNo', 'numPcs',
        'origin', 'destination', 'grossWeight', 'chargeableWeight', 'commodity', 'shipMode', 'shipTerms', 'currency', 'vatRate', 'terms']
        .forEach(function (k) { o[k] = S(r[k]); });
      return o;
    }
    function quoteMarkConverted(p) {
      if (!p || !p.quotationNo) return { success: false, updated: 0 };
      var n = 0;
      db.quotations.forEach(function (q) { if (S(q.quotationNo).trim() === S(p.quotationNo).trim()) { q.status = 'Converted'; q.convertedInvoice = S(p.invoiceNo); n++; } });
      if (n) save(); return { success: true, updated: n };
    }

    /* ---------- JOBS: selling / quoted agent / cost -> profit; cost is posted to the books ---------- */
    function jobClean(d) {
      var items = [], sell = 0, cost = 0, names = [], seen = {};
      ((d && d.items) || []).forEach(function (it) {
        var qty = N(it.qty), rate = N(it.rate), c = r2(N(it.cost)), agent = S(it.agent).trim(), desc = S(it.desc).trim();
        if (!desc && !qty && !rate && !c && !agent) return;
        items.push({ desc: desc, qty: qty, unit: S(it.unit), rate: rate, agent: agent, cost: c });
        sell += r2(qty * rate); cost += c;
        if (agent && !seen[agent.toLowerCase()]) { seen[agent.toLowerCase()] = true; names.push(agent); }
      });
      return { items: items, selling: r2(sell), cost: r2(cost), agents: names.join(', ') };
    }
    function nextJobNo() {
      var max = 0;
      db.jobs.forEach(function (j) { var m = S(j.jobNo).match(/(\d+)\s*$/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
      return 'JOB-' + ('0000' + (max + 1)).slice(-4);
    }
    function postJob(rec, oldNo) {
      db.journal = db.journal.filter(function (e) { return !(e.source === 'job' && (e.ref === rec.jobNo || e.ref === oldNo)); });
      if (rec.cost <= 0) return;
      addEntry({ date: S(rec.jobDate) || today(), memo: 'Job ' + rec.jobNo + ' cost' + (rec.agents ? ' — ' + rec.agents : (rec.customer ? ' — ' + S(rec.customer) : '')),
        currency: S(rec.currency) || 'INR', source: 'job', ref: rec.jobNo, lines: [{ acc: '5000', dr: rec.cost, cr: 0 }, { acc: '2000', dr: 0, cr: rec.cost }] });
    }
    var JOBKEYS = ['jobDate', 'invoiceNo', 'branchName', 'branchCountry', 'customer', 'customerAddress', 'currency', 'awbNo', 'commodity', 'grossWeight', 'volume',
      'shipMode', 'shipTerms', 'origin', 'destination', 'remarks'];
    function jobRecord(d, c, no, id, ts) {
      var r = { id: id, timestamp: ts, jobNo: no, items: c.items, selling: c.selling, cost: c.cost, agents: c.agents };
      JOBKEYS.forEach(function (k) { r[k] = S(d[k]).trim(); }); return r;
    }
    function saveJob(d) {
      if (!d) throw new Error('No job data received.');
      var c = jobClean(d); if (!c.items.length) throw new Error('Add at least one line.');
      var no = S(d.jobNo).trim() || nextJobNo();
      if (db.jobs.some(function (j) { return j.jobNo === no; })) throw new Error('Job number "' + no + '" already exists — use Load Job to edit it.');
      var rec = jobRecord(d, c, no, uid(), new Date().toISOString()); db.jobs.push(rec); postJob(rec); save();
      return { success: true, jobNo: no, nextJobNo: nextJobNo() };
    }
    function updateJob(d) {
      if (!d) throw new Error('No job data received.');
      var orig = S(d.originalJobNo || d.jobNo).trim(), i = db.jobs.findIndex(function (j) { return j.jobNo === orig; });
      if (i < 0) throw new Error('Job "' + orig + '" not found in the system.');
      var c = jobClean(d); if (!c.items.length) throw new Error('Add at least one line.');
      var no = S(d.jobNo).trim() || orig;
      if (no !== orig && db.jobs.some(function (j) { return j.jobNo === no; })) throw new Error('Job number "' + no + '" already exists.');
      var old = db.jobs[i], rec = jobRecord(d, c, no, old.id, old.timestamp); db.jobs[i] = rec;
      if (no !== orig) db.journal.forEach(function (e) { if (e.ref === orig && (e.source === 'agentpay' || e.source === 'job')) e.ref = no; });
      postJob(rec, orig); save(); return { success: true, jobNo: no, updated: true };
    }
    function deleteJob(no) {
      if (!no) throw new Error('Job number is required.');
      var want = S(no).trim(), i = db.jobs.findIndex(function (j) { return j.jobNo === want; });
      if (i < 0) throw new Error('Job "' + no + '" not found in the system.');
      if (db.journal.some(function (e) { return e.source === 'agentpay' && e.ref === want; })) throw new Error('This job has agent payments recorded. Delete those payment entries in the Journal first.');
      db.jobs.splice(i, 1); db.journal = db.journal.filter(function (e) { return !(e.source === 'job' && e.ref === want); }); save(); return { success: true };
    }
    function getJobList() {
      return db.jobs.slice().reverse().map(function (j) {
        return { jobNo: j.jobNo, jobDate: j.jobDate, invoiceNo: j.invoiceNo, customer: j.customer, currency: j.currency, totalSelling: j.selling, totalCost: j.cost, profit: r2(j.selling - j.cost), agents: j.agents };
      });
    }
    function getJob(no) {
      if (!no) throw new Error('Job number is required.');
      var j = db.jobs.find(function (x) { return x.jobNo === S(no).trim(); });
      if (!j) throw new Error('Job "' + no + '" not found in the system.');
      var o = { jobNo: j.jobNo, items: j.items }; JOBKEYS.forEach(function (k) { o[k] = S(j[k]); }); return o;
    }
    function accPayAgent(p) {
      if (!p) throw new Error('No payment data received.');
      var jb = accGetAll().jobs.find(function (x) { return x.id === S(p.jobId); });
      if (!jb) throw new Error('Job not found.');
      var amt = r2(N(p.amount)); if (amt <= 0) throw new Error('Enter a valid amount.');
      if (amt > jb.outstanding + 0.004) throw new Error('Amount exceeds the agent cost still to pay (' + jb.outstanding.toFixed(2) + ').');
      var method = p.method === 'Cash' ? 'Cash' : 'Bank', ref = S(p.ref).trim();
      addEntry({ date: p.date || today(), memo: 'Paid agent for ' + jb.jobNo + (ref ? ' — ' + ref : ''), currency: jb.currency, source: 'agentpay', ref: jb.jobNo,
        lines: [{ acc: '2000', dr: amt, cr: 0 }, { acc: method === 'Cash' ? '1000' : '1100', dr: 0, cr: amt }],
        extra: { payNo: nextNo('PAY-', 'payNo'), method: method, payRef: ref } });
      save(); return accGetAll();
    }

    function accSaveEntry(e) {
      var L = ((e && e.lines) || []).map(function (l) { return { acc: S(l.acc), dr: r2(N(l.dr)), cr: r2(N(l.cr)) }; })
        .filter(function (l) { return l.dr || l.cr; });
      if (L.length < 2) throw new Error('A journal entry needs at least two lines.');
      L.forEach(function (l) { if (!db.accounts.some(function (a) { return a.code === l.acc; })) throw new Error('Choose an account for every line.'); });
      var dr = r2(L.reduce(function (s, l) { return s + l.dr; }, 0)), cr = r2(L.reduce(function (s, l) { return s + l.cr; }, 0));
      if (dr !== cr || dr <= 0) throw new Error('Debits (' + dr.toFixed(2) + ') must equal credits (' + cr.toFixed(2) + ').');
      addEntry({ date: e.date || today(), memo: S(e.memo), currency: S(e.currency) || 'INR', source: 'manual', ref: '', lines: L });
      save(); return accGetAll();
    }
    function accDeleteEntry(id) {
      var e = db.journal.find(function (x) { return x.id === id; });
      if (!e) throw new Error('Entry not found.');
      if (e.source === 'invoice') throw new Error('Invoice entries follow the invoice — edit the invoice instead.');
      if (e.source === 'job') throw new Error('Job cost entries follow the job — edit the job instead.');
      db.journal = db.journal.filter(function (x) { return x.id !== id; }); save(); return accGetAll();
    }
    function accSaveAccount(a) {
      var code = S(a && a.code).trim(), name = S(a && a.name).trim();
      if (!/^[A-Za-z0-9._-]{1,12}$/.test(code) || !name || ['asset', 'liability', 'equity', 'income', 'expense'].indexOf(a.type) < 0)
        throw new Error('Enter a code (letters/numbers), a name and a type.');
      var rec = { code: code, name: name, type: a.type }, i = db.accounts.findIndex(function (x) { return x.code === code; });
      if (i >= 0) db.accounts[i] = rec; else db.accounts.push(rec);
      db.accounts.sort(function (x, y) { return x.code < y.code ? -1 : 1; }); save(); return accGetAll();
    }


    /* ---------- DELETE / RESTORE / EXPORT ---------- */
    function cancelledList() { return db.cancelledInvoices || (db.cancelledInvoices = []); }
    function latest(list, key) {        // a document saved twice is kept once (the newest)
      var seen = {}, out = [];
      for (var i = list.length - 1; i >= 0; i--) { var k = S(list[i][key]).trim(); if (k && !seen[k]) { seen[k] = 1; out.unshift(list[i]); } }
      return out;
    }
    /* Deleting an invoice: removed from the list and the books; blocked while receipts exist; the number is never
       reused (tax rules expect an unbroken sequence) and the full record is kept so it can be restored. */
    function deleteInvoice(no) {
      var want = S(no).trim(), i = db.invoices.findIndex(function (x) { return S(x.invoiceNo).trim() === want; });
      if (i < 0) throw new Error('Invoice "' + want + '" not found in the system.');
      var inv = db.invoices[i], rc = db.journal.filter(function (e) { return e.source === 'payment' && e.ref === inv.id; });
      if (rc.length) throw new Error('Invoice ' + want + ' has ' + rc.length + ' receipt(s) recorded (' + rc.map(function (e) { return (e.extra && e.extra.receiptNo) || 'receipt'; }).join(', ') + '). Delete those receipts in Accounting first.');
      db.invoices.splice(i, 1);
      db.journal = db.journal.filter(function (e) { return !(e.source === 'invoice' && e.ref === inv.id); });
      db.quotations.forEach(function (q) { if (q.status === 'Converted' && S(q.convertedInvoice).trim() === want) { q.status = 'Saved'; q.convertedInvoice = ''; } });
      cancelledList().push({ invoiceNo: want, invoiceDate: S(inv.invoiceDate), billTo: S(inv.billTo), currency: S(inv.currency), grandTotal: N(inv.grandTotal), cancelledAt: new Date().toISOString(), record: inv });
      save(); return { success: true, invoiceNo: want, nextInvoiceNo: getNextInvoiceNo() };
    }
    function restoreInvoice(no) {
      var want = S(no).trim(), c = cancelledList(), i = c.findIndex(function (x) { return x.invoiceNo === want; });
      if (i < 0) throw new Error('Cancelled invoice "' + want + '" not found.');
      if (db.invoices.some(function (x) { return S(x.invoiceNo).trim() === want; })) throw new Error('Invoice number ' + want + ' is already in use.');
      var r = c[i].record; db.invoices.push(r); c.splice(i, 1); postInvoice(r); save();
      return { success: true, invoiceNo: want };
    }
    function getCancelledInvoices() {
      return cancelledList().slice().reverse().map(function (c) { return { invoiceNo: c.invoiceNo, invoiceDate: c.invoiceDate, billTo: c.billTo, currency: c.currency, grandTotal: c.grandTotal, cancelledAt: c.cancelledAt }; });
    }
    function deleteQuotation(no) {
      var want = S(no).trim(), n = db.quotations.length;
      db.quotations = db.quotations.filter(function (q) { return S(q.quotationNo).trim() !== want; });
      if (db.quotations.length === n) throw new Error('Quotation "' + want + '" not found in the system.');
      save(); return { success: true };
    }
    function getDeliveryNoteList() {
      return latest(db.deliveryNotes, 'deliveryNo').reverse().map(function (d) { return { deliveryNo: S(d.deliveryNo).trim(), deliveryDate: S(d.deliveryDate), deliverTo: S(d.deliverTo) }; });
    }
    function getDeliveryNote(no) {
      var want = S(no).trim(), r = latest(db.deliveryNotes, 'deliveryNo').find(function (x) { return S(x.deliveryNo).trim() === want; });
      if (!r) throw new Error('Delivery note "' + want + '" not found in the system.');
      var o = JSON.parse(JSON.stringify(r)); delete o.id; delete o.timestamp; o.items = o.items || []; return o;
    }
    function deleteDeliveryNote(no) {
      var want = S(no).trim(), n = db.deliveryNotes.length;
      db.deliveryNotes = db.deliveryNotes.filter(function (d) { return S(d.deliveryNo).trim() !== want; });
      if (db.deliveryNotes.length === n) throw new Error('Delivery note "' + want + '" not found in the system.');
      save(); return { success: true };
    }
    /* Export: rows of plain values; the browser turns them into a CSV file that opens in Excel. */
    function flatRows(list) {
      var keys = [];
      list.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== 'items' && k !== 'record' && keys.indexOf(k) < 0) keys.push(k); }); });
      if (!keys.length) return [['(no records yet)']];
      return [keys].concat(list.map(function (r) { return keys.map(function (k) { var v = r[k]; return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); }); }));
    }
    function lineRows(list, noKey) {
      var keys = [], rows = [];
      list.forEach(function (r) { (r.items || []).forEach(function (it) { Object.keys(it).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); }); });
      list.forEach(function (r) { (r.items || []).forEach(function (it, n) { rows.push([S(r[noKey]), n + 1].concat(keys.map(function (k) { var v = it[k]; return v === undefined || v === null ? '' : v; }))); }); });
      return [[noKey, 'line'].concat(keys)].concat(rows);
    }
    function journalRows() {
      var nm = {}, no = {}, rows = [['date', 'entry', 'source', 'document', 'receiptNo', 'memo', 'currency', 'accountCode', 'accountName', 'debit', 'credit']];
      db.accounts.forEach(function (a) { nm[a.code] = a.name; });
      db.invoices.forEach(function (i) { no[i.id] = S(i.invoiceNo); });
      db.journal.slice().sort(function (a, b) { return S(a.date) < S(b.date) ? -1 : S(a.date) > S(b.date) ? 1 : 0; }).forEach(function (e) {
        (e.lines || []).forEach(function (l) { rows.push([S(e.date), e.id, S(e.source), no[e.ref] || S(e.ref), S(e.extra && e.extra.receiptNo), S(e.memo), S(e.currency), l.acc, nm[l.acc] || '', l.dr || 0, l.cr || 0]); });
      });
      return rows;
    }
    function exportData(kind) {
      var Q = function () { return latest(db.quotations, 'quotationNo'); }, D = function () { return latest(db.deliveryNotes, 'deliveryNo'); };
      var map = {
        invoices: function () { return flatRows(db.invoices); }, invoice_lines: function () { return lineRows(db.invoices, 'invoiceNo'); },
        quotations: function () { return flatRows(Q()); }, quotation_lines: function () { return lineRows(Q(), 'quotationNo'); },
        delivery_notes: function () { return flatRows(D()); }, delivery_note_lines: function () { return lineRows(D(), 'deliveryNo'); },
        jobs: function () { return flatRows(db.jobs); }, journal: journalRows, accounts: function () { return flatRows(db.accounts); },
        cancelled_invoices: function () { return flatRows(cancelledList().map(function (c) { return { invoiceNo: c.invoiceNo, invoiceDate: c.invoiceDate, billTo: c.billTo, currency: c.currency, grandTotal: c.grandTotal, cancelledAt: c.cancelledAt }; })); }
      };
      if (!Object.prototype.hasOwnProperty.call(map, kind)) throw new Error('Unknown export: ' + kind);
      return { filename: 'WRL-' + String(kind).replace(/_/g, '-') + '-' + today() + '.csv', rows: map[kind]() };
    }
    function exportBackup() { return { filename: 'WRL-backup-' + today() + '.json', data: db }; }

    return { ping: function () { return 'pong'; },
      getInitialData: function () { return { branches: getBranches(), nextInvoiceNo: getNextInvoiceNo() }; },
      getBranches: getBranches, saveBranch: saveBranch, deleteBranch: deleteBranch, getNextInvoiceNo: getNextInvoiceNo,
      syncData: syncData, saveInvoice: saveInvoice, getInvoiceList: getInvoiceList, getInvoice: getInvoice, updateInvoice: updateInvoice,
      saveQuotation: saveQuotation, saveDeliveryNote: saveDeliveryNote,
      accGetAll: accGetAll, accRecordPayment: accRecordPayment, accSaveEntry: accSaveEntry,
      accDeleteEntry: accDeleteEntry, accSaveAccount: accSaveAccount, accGetReceipt: accGetReceipt, accSaveVoucher: accSaveVoucher,
      getQuotationList: getQuotationList, getQuotation: getQuotation, quoteMarkConverted: quoteMarkConverted,
      getNextJobNo: nextJobNo, saveJob: saveJob, updateJob: updateJob, deleteJob: deleteJob, getJobList: getJobList, getJob: getJob, accPayAgent: accPayAgent,
      deleteInvoice: deleteInvoice, restoreInvoice: restoreInvoice, getCancelledInvoices: getCancelledInvoices, deleteQuotation: deleteQuotation,
      getDeliveryNoteList: getDeliveryNoteList, getDeliveryNote: getDeliveryNote, deleteDeliveryNote: deleteDeliveryNote, exportData: exportData, exportBackup: exportBackup };
  }
  return { create: create };
});
