// 데이터 보관·저장 담당.
// 우선순위: (1) 연결된 공유 폴더 파일 → (2) 브라우저에 남은 마지막 데이터 → (3) 기본 데이터 파일
const LS_KEY = 'budget.data.v1';
const LS_UI = 'budget.ui.v1';
const IDB_DB = 'budget-app';
const IDB_STORE = 'handles';

export const state = {
  data: null,
  fileHandle: null,
  dirty: false,
  ui: { user: 'all', month: null, view: 'dashboard' },
  listeners: [],
};

export function onChange(fn) { state.listeners.push(fn); }
function emit() { state.listeners.forEach((f) => f()); }

/* ---------- IndexedDB: 파일 핸들 보관 ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(val, key);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(IDB_STORE, 'readonly');
    const q = t.objectStore(IDB_STORE).get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export const canUseFileSystem = 'showOpenFilePicker' in window;

/* ---------- 불러오기 ---------- */
export async function boot() {
  try {
    const saved = localStorage.getItem(LS_UI);
    if (saved) Object.assign(state.ui, JSON.parse(saved));
  } catch { /* 저장소를 못 쓰는 환경 */ }

  if (canUseFileSystem) {
    try {
      const handle = await idbGet('dataFile');
      if (handle && (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
        state.fileHandle = handle;
        const file = await handle.getFile();
        state.data = JSON.parse(await file.text());
      }
    } catch { /* 권한 없으면 아래로 */ }
  }
  if (!state.data) {
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) state.data = JSON.parse(cached);
    } catch { /* 무시 */ }
  }
  if (!state.data && window.__SEED__) state.data = window.__SEED__;   // 단독 파일 버전
  if (!state.data) {
    try {
      const res = await fetch('가계부_데이터.json');
      state.data = res.ok ? await res.json() : emptyData();
    } catch { state.data = emptyData(); }   // 오프라인이거나 파일이 없을 때
  }
  normalize(state.data);
  if (!state.ui.month) state.ui.month = latestMonth();
  emit();
}

function emptyData() {
  return {
    version: 1, users: [{ id: 'user1', name: '남편' }, { id: 'user2', name: '아내' }],
    accounts: [], categories: [], transactions: [],
    investment: { flows: [], holdings: [], jeonbukLedger: [], valuationDate: today() },
    otherAssets: [], budgets: {}, notes: [], feedback: [], onboarded: false,
  };
}

function normalize(d) {
  d.transactions ||= [];
  d.feedback ||= [];
  d.categories ||= [];
  d.accounts ||= [];
  d.investment ||= { flows: [], holdings: [], jeonbukLedger: [] };
  d.investment.flows ||= [];
  d.investment.holdings ||= [];
  d.budgets ||= {};
  d.transactions.forEach((t) => { t.type ||= 'expense'; });
}

export function today() { return new Date().toISOString().slice(0, 10); }

export function latestMonth() {
  const ms = state.data.transactions.map((t) => t.date.slice(0, 7)).sort();
  return ms.length ? ms[ms.length - 1] : today().slice(0, 7);
}

/* ---------- 저장 ---------- */
let autoSaveTimer = null;

export function touch() {
  state.dirty = true;
  state.data.updatedAt = new Date().toISOString().slice(0, 19);
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.data)); } catch { /* 용량 초과 */ }
  emit();
  // 공유 폴더 파일이 연결돼 있으면 잠시 뒤 자동으로 저장한다
  if (state.fileHandle) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { save().catch(() => { /* 권한 없으면 수동 저장 */ }); }, 2500);
  }
}

export function saveUI() {
  try { localStorage.setItem(LS_UI, JSON.stringify(state.ui)); } catch { /* 무시 */ }
}

export async function connectFile({ create = false } = {}) {
  if (!canUseFileSystem) throw new Error('이 브라우저는 파일 직접 연결을 지원하지 않습니다. 맥 크롬에서 사용하거나 내보내기를 쓰세요.');
  const opts = {
    suggestedName: '가계부_데이터.json',
    types: [{ description: '가계부 데이터', accept: { 'application/json': ['.json'] } }],
  };
  const handle = create ? await window.showSaveFilePicker(opts) : (await window.showOpenFilePicker(opts))[0];
  state.fileHandle = handle;
  await idbSet('dataFile', handle);
  if (create) { await writeHandle(); } else {
    const file = await handle.getFile();
    state.data = JSON.parse(await file.text());
    normalize(state.data);
  }
  state.dirty = false;
  emit();
  return handle.name;
}

async function writeHandle() {
  const w = await state.fileHandle.createWritable();
  await w.write(JSON.stringify(state.data, null, 1));
  await w.close();
}

export async function save() {
  if (state.fileHandle) {
    const perm = await state.fileHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('파일 쓰기 권한이 없습니다.');
    await writeHandle();
    state.dirty = false;
    emit();
    return '공유 폴더 파일에 저장했습니다.';
  }
  const how = await exportFile();
  state.dirty = false;
  emit();
  return how === 'share'
    ? '공유 창에서 "파일에 저장" → 공유 폴더를 고르세요.'
    : '파일을 내려받았습니다. 공유 폴더에 넣어주세요.';
}

function dataFile() {
  return new File([JSON.stringify(state.data, null, 1)], '가계부_데이터.json', { type: 'application/json' });
}

/** 아이폰에서는 공유 창(파일에 저장)으로, 그 외에는 내려받기로 내보낸다 */
export async function exportFile() {
  const file = dataFile();
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '가계부 데이터' });
      return 'share';
    } catch (e) {
      if (e.name === 'AbortError') return 'share';   // 사용자가 취소함
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `가계부_데이터_${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'download';
}

export async function importFile(file, { mode = 'merge' } = {}) {
  const text = await file.text();
  const incoming = JSON.parse(text);
  return applyIncoming(incoming, { mode });
}

/** 다른 기기/드라이브에서 온 데이터를 지금 데이터와 합친다 */
export function applyIncoming(incoming, { mode = 'merge' } = {}) {
  if (!incoming || !incoming.transactions) throw new Error('가계부 데이터가 아닙니다.');

  if (mode === 'replace' || !state.data?.transactions?.length) {
    state.data = incoming;
    normalize(state.data);
    touch();
    return { mode: 'replace', total: incoming.transactions.length, added: 0, updated: 0 };
  }

  // 합치기: 양쪽에만 있는 거래를 모두 살린다
  const mine = state.data;
  const newer = (incoming.updatedAt || '') > (mine.updatedAt || '');
  const byId = new Map(mine.transactions.map((t) => [t.id, t]));
  const byKey = new Map(mine.transactions.map((t) => [dedupKey(t), t]));
  let added = 0;
  let updated = 0;
  incoming.transactions.forEach((t) => {
    const same = byId.get(t.id) || byKey.get(dedupKey(t));
    if (!same) {
      mine.transactions.push(t);
      byId.set(t.id, t);
      byKey.set(dedupKey(t), t);
      added += 1;
      return;
    }
    // 같은 거래라면 더 최근에 저장된 쪽의 분류·메모를 따른다
    if (newer && (same.categoryId !== t.categoryId || same.type !== t.type
      || same.excluded !== t.excluded || same.memo !== t.memo)) {
      Object.assign(same, { categoryId: t.categoryId, type: t.type, excluded: t.excluded, memo: t.memo });
      updated += 1;
    }
  });
  mine.transactions.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  // 피드백도 합친다
  const fbIds = new Set((mine.feedback || []).map((f) => f.id));
  (incoming.feedback || []).forEach((f) => {
    if (!fbIds.has(f.id)) { mine.feedback.unshift(f); fbIds.add(f.id); }
  });
  mine.feedback.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 설정(계좌·카테고리·대출·투자·사용자)은 더 최근에 저장된 파일 것을 쓴다
  if (newer) {
    ['users', 'accounts', 'categories', 'loans', 'otherAssets', 'budgets'].forEach((k) => {
      if (incoming[k]) mine[k] = incoming[k];
    });
    if (incoming.investment) mine.investment = incoming.investment;
  }
  normalize(mine);
  touch();
  return { mode: 'merge', total: mine.transactions.length, added, updated, newer };
}

/* ---------- 거래 추가/수정 ---------- */
export function dedupKey(t) {
  return [t.date, t.accountId || '', (t.merchant || '').replace(/\s+/g, ''), t.amount].join('|');
}

export function existingKeys() {
  return new Set(state.data.transactions.map(dedupKey));
}

export function addTransactions(list) {
  const seen = existingKeys();
  const added = [];
  const dup = [];
  list.forEach((t) => {
    const k = dedupKey(t);
    if (seen.has(k)) { dup.push(t); return; }
    seen.add(k);
    t.id ||= `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    added.push(t);
  });
  state.data.transactions.push(...added);
  state.data.transactions.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  if (added.length) touch();
  return { added, dup };
}

/* ---------- 피드백 ---------- */
export function addFeedback({ text, kind, user }) {
  state.data.feedback ||= [];
  const item = {
    id: `fb_${Date.now().toString(36)}`,
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    user, kind, text, status: 'open',
  };
  state.data.feedback.unshift(item);
  touch();
  return item;
}

export function updateFeedback(id, patch) {
  const f = (state.data.feedback || []).find((x) => x.id === id);
  if (f) { Object.assign(f, patch); touch(); }
}

export function removeFeedback(id) {
  const i = (state.data.feedback || []).findIndex((x) => x.id === id);
  if (i >= 0) { state.data.feedback.splice(i, 1); touch(); }
}

/** 새로 시작하기 — 무엇을 지울지 고를 수 있다 */
export function resetData({ transactions = true, investment = false, loans = false, settings = false } = {}) {
  if (transactions) state.data.transactions = [];
  if (investment) state.data.investment = { flows: [], holdings: [], jeonbukLedger: [], valuationDate: today() };
  if (loans) state.data.loans = [];
  if (settings) {
    const fresh = emptyData();
    state.data.categories = fresh.categories.length ? fresh.categories : state.data.categories;
    state.data.accounts = [];
  }
  state.data.notes = [];
  touch();
}

/** 이 기기에 남은 사본을 지운다 (공유 폴더의 파일은 그대로) */
export async function forgetDevice() {
  try { localStorage.removeItem(LS_KEY); } catch { /* 무시 */ }
  try { await idbSet('dataFile', null); } catch { /* 무시 */ }
  state.fileHandle = null;
}

export function removeTransaction(id) {
  const i = state.data.transactions.findIndex((t) => t.id === id);
  if (i >= 0) { state.data.transactions.splice(i, 1); touch(); }
}
