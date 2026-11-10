// Tab keys and which /api functions each tab unlocks.
export const TABS = [
  { id: 'invoice', label: 'Tax Invoice' },
  { id: 'quote', label: 'Quotation' },
  { id: 'dn', label: 'Delivery Note' },
  { id: 'job', label: 'Job' },
  { id: 'acc', label: 'Accounting' },
  { id: 'records', label: 'Records & Export' },
];

export const ALL_TAB_IDS = TABS.map(t => t.id);

export const DEFAULT_STAFF_TABS = {
  invoice: true,
  quote: true,
  dn: true,
  job: true,
  acc: false,
  records: false,
};

export function allTabsOn() {
  const o = {};
  for (const id of ALL_TAB_IDS) o[id] = true;
  return o;
}

export function normalizeTabs(tabs, isAdmin) {
  if (isAdmin) return allTabsOn();
  const src = tabs && typeof tabs === 'object' ? tabs : {};
  const o = {};
  for (const id of ALL_TAB_IDS) o[id] = !!src[id];
  return o;
}

/** null = any signed-in user; string = required tab key */
export const FN_TAB = {
  ping: null,
  getInitialData: null,
  getBranches: null,
  saveBranch: null,
  deleteBranch: null,
  syncData: null,
  getNextInvoiceNo: 'invoice',
  saveInvoice: 'invoice',
  getInvoiceList: 'invoice',
  getInvoice: 'invoice',
  updateInvoice: 'invoice',
  saveQuotation: 'quote',
  getQuotationList: 'quote',
  getQuotation: 'quote',
  quoteMarkConverted: 'quote',
  saveDeliveryNote: 'dn',
  getDeliveryNoteList: 'dn',
  getDeliveryNote: 'dn',
  getNextJobNo: 'job',
  saveJob: 'job',
  updateJob: 'job',
  getJobList: 'job',
  getJob: 'job',
  accGetAll: 'acc',
  accRecordPayment: 'acc',
  accSaveEntry: 'acc',
  accDeleteEntry: 'acc',
  accSaveAccount: 'acc',
  accGetReceipt: 'acc',
  accSaveVoucher: 'acc',
  accPayAgent: 'acc',
  deleteInvoice: 'records',
  restoreInvoice: 'records',
  getCancelledInvoices: 'records',
  deleteQuotation: 'records',
  deleteDeliveryNote: 'records',
  deleteJob: 'records',
  exportData: 'records',
  exportBackup: 'records',
};

export function canCallFn(session, fn) {
  if (!session) return false;
  if (session.isAdmin) return true;
  const need = Object.prototype.hasOwnProperty.call(FN_TAB, fn) ? FN_TAB[fn] : null;
  if (need == null) return true;
  return !!(session.tabs && session.tabs[need]);
}

export function canUseTab(session, tab) {
  if (!session) return false;
  if (session.isAdmin) return true;
  return !!(session.tabs && session.tabs[tab]);
}
