// 카드사·은행에서 받은 파일을 읽어 거래로 바꾼다.
// 지원: 현대카드(.xls=HTML), 신한카드(.xlsx), 그 외 엑셀/CSV는 열을 추정해서 가져온다.
import { guessCategory } from './model.js';
import { state, dedupKey } from './store.js';

const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d.-]/g, '');
  return s ? Math.round(parseFloat(s)) : 0;
};
const isoDate = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};
const timeOf = (v) => (String(v ?? '').match(/(\d{1,2}:\d{2})(:\d{2})?/) || [])[0] || '';

/** 파일에 적힌 카드번호·계좌번호(예: "본인1234*", "1***-******-5678*")로 등록된 계정을 찾는다 */
export function matchAccount(cardRaw) {
  if (!cardRaw) return null;
  const raw = String(cardRaw);
  const digits = raw.replace(/\D/g, '');
  return state.data.accounts.find((a) => (a.match || []).some((m) => {
    const key = String(m).trim();
    if (!key) return false;
    const md = key.replace(/\D/g, '');
    if (md) return digits.includes(md);          // 숫자면 카드·계좌번호로 비교
    return raw.includes(key);                    // 글자면 카드 이름으로 비교 (예: "The Platinum Ed2")
  })) || null;
}

/** 현대카드: 확장자는 .xls지만 실제로는 HTML 표 */
function parseHyundai(text) {
  const clean = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  const rows = [];
  const skipped = [];
  const trs = clean.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  trs.forEach((tr) => {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => {
      const el = document.createElement('div');
      el.innerHTML = c.replace(/<t[dh][^>]*>|<\/t[dh]>/gi, '');
      return el.textContent.replace(/\s+/g, ' ').trim();
    });
    if (cells.length < 11) return;
    const date = isoDate(cells[0]);
    if (!date) return;
    const status = cells[10];
    const amount = num(cells[5]);
    if (status === '취소') { skipped.push({ date, merchant: cells[4], amount, reason: '승인 취소' }); return; }
    const cardRaw = `${cells[2]} ${cells[3]}`.trim();      // 예: "가족 1***-******-5678*"
    const acct = matchAccount(cells[3]);
    rows.push({
      date, time: cells[1] || '', merchant: cells[4],
      amount: (status === '취소전표접수' ? 1 : -1) * amount,
      cardRaw,
      accountId: acct ? acct.id : '',
      owner: acct ? acct.owner : '',
      type: 'expense', memo: status === '취소전표접수' ? '환불' : '',
      source: 'import:현대카드',
    });
  });
  return { rows, skipped, kind: '현대카드' };
}

/** 현대카드 '이용대금명세서': 가맹점과 금액이 한 칸에 붙어 있고, 카드가 상품명으로 적힌다 */
function parseHyundaiStatement(text) {
  const clean = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  if (!/이용대금명세서/.test(clean)) return null;
  const rows = [];
  const trs = clean.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  trs.forEach((tr) => {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => {
      const el = document.createElement('div');
      el.innerHTML = c.replace(/<t[dh][^>]*>|<\/t[dh]>/gi, '');
      return el.textContent.replace(/\s+/g, ' ').trim();
    });
    if (cells.length < 9) return;
    const date = isoDate(cells[0]);
    if (!date) return;
    const m = cells[2].match(/^(.*?)\s*(-?[\d,]+)$/);      // "씨유CU광명현대점 6,000"
    if (!m) return;
    const merchant = m[1].replace(/^#/, '').trim();          // '#'은 자동납부 표시
    const amount = num(m[2]);
    if (!merchant || !amount) return;
    const cardRaw = cells[1];
    const acct = matchAccount(cardRaw);
    rows.push({
      date, time: '', merchant, amount: -amount, cardRaw,
      accountId: acct ? acct.id : '', owner: acct ? acct.owner : '',
      type: 'expense', memo: cardRaw, source: 'import:현대카드명세서',
    });
  });
  return rows.length ? { rows, skipped: [], kind: '현대카드 명세서' } : null;
}

/** 신한카드 표준 엑셀 */
function parseShinhanCard(aoa) {
  const head = aoa.findIndex((r) => r.some((c) => /가맹점명/.test(String(c))) && r.some((c) => /금액/.test(String(c))));
  if (head < 0) return null;
  const cols = aoa[head].map((c) => String(c || '').trim());
  const ix = (re) => cols.findIndex((c) => re.test(c));
  const iDate = ix(/거래일|이용일|승인일/), iName = ix(/가맹점명/), iAmt = ix(/^금액|이용금액|승인금액/);
  const iState = ix(/취소상태|취소여부/);
  const iCard = ix(/이용카드|카드번호/);
  if (iDate < 0 || iName < 0 || iAmt < 0) return null;
  const rows = [];
  const skipped = [];
  aoa.slice(head + 1).forEach((r) => {
    const date = isoDate(r[iDate]);
    const amount = num(r[iAmt]);
    if (!date || !amount || /총\s*\d+건/.test(String(r[iName] || ''))) return;
    if (iState >= 0 && /취소/.test(String(r[iState] || ''))) {
      skipped.push({ date, merchant: r[iName], amount, reason: '취소 건' });
      return;
    }
    const cardRaw = iCard >= 0 ? String(r[iCard] || '').trim() : '';
    const acct = matchAccount(cardRaw);
    rows.push({
      date, time: timeOf(r[iDate]), merchant: String(r[iName]).trim(), amount: -amount,
      cardRaw,
      accountId: acct ? acct.id : '', owner: acct ? acct.owner : '',
      type: 'expense', memo: '', source: 'import:신한카드',
    });
  });
  return { rows, skipped, kind: '신한카드' };
}

/** 표 위쪽(제목 영역)에 적힌 계좌번호를 찾는다. 예: "계좌번호 123-456-789012" */
function headerAccount(aoa, headRow) {
  const text = aoa.slice(0, Math.max(headRow, 0)).flat().map((c) => String(c || '')).join(' ');
  const m = text.match(/\d{2,4}-\d{2,6}-\d{3,7}/) || text.match(/계좌번호[^\d]{0,6}([\d-]{8,})/);
  return m ? (m[1] || m[0]) : '';
}

/** 일반 엑셀/CSV: 날짜·내용·금액(또는 입금/출금) 열을 추정 */
function parseGeneric(aoa, fileName = '') {
  let head = -1;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const r = aoa[i].map((c) => String(c || ''));
    if (r.some((c) => /날짜|일자|거래일|승인일|이용일/.test(c)) &&
        r.some((c) => /금액|출금|입금|승인금액/.test(c))) { head = i; break; }
  }
  if (head < 0) return null;
  const cols = aoa[head].map((c) => String(c || '').trim());
  const ix = (re) => cols.findIndex((c) => re.test(c));
  const iDate = ix(/날짜|일자|거래일|승인일|이용일/);
  const iName = ix(/가맹점|내용|적요|기재|메모|거래처/);
  const iAmt = ix(/^금액|승인금액|이용금액|거래금액/);
  const iOut = ix(/출금|지급|인출/), iIn = ix(/입금|예입/);
  const iCard = ix(/이용카드|카드번호|계좌번호|계좌/);
  // 열에 없으면 표 위쪽이나 파일 이름에서 계좌번호를 찾는다
  const fallbackAccount = headerAccount(aoa, head)
    || (fileName.match(/\d{2,4}-\d{2,6}-\d{3,7}|\d{6,}/) || [''])[0];
  const rows = [];
  aoa.slice(head + 1).forEach((r) => {
    const date = isoDate(r[iDate]);
    if (!date) return;
    let amount = 0;
    if (iAmt >= 0 && num(r[iAmt])) amount = -Math.abs(num(r[iAmt]));
    if (iOut >= 0 && num(r[iOut])) amount = -Math.abs(num(r[iOut]));
    if (iIn >= 0 && num(r[iIn])) amount = Math.abs(num(r[iIn]));
    if (!amount) return;
    const cardRaw = (iCard >= 0 ? String(r[iCard] || '').trim() : '') || fallbackAccount;
    const acct = matchAccount(cardRaw);
    rows.push({
      date, time: timeOf(r[iDate]), merchant: String(r[iName >= 0 ? iName : 1] || '').trim(),
      amount, cardRaw, accountId: acct ? acct.id : '', owner: acct ? acct.owner : '',
      type: amount > 0 ? 'income' : 'expense', memo: '', source: 'import:파일',
    });
  });
  return { rows, skipped: [], kind: '일반 파일', columns: cols };
}

function sheetToAoa(input, isText = false) {
  // CSV는 글자로 읽어야 한글이 깨지지 않는다
  const wb = XLSX.read(input, { type: isText ? 'string' : 'array', cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  let result = null;
  if (name.endsWith('.xls')) {
    const text = await file.text();
    if (/<table|<tr/i.test(text)) result = parseHyundaiStatement(text) || parseHyundai(text);
  }
  if (!result && /\.(xlsx|xls|csv|txt)$/.test(name)) {
    if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    const isText = /\.(csv|txt)$/.test(name);
    const input = isText
      ? (await file.text()).replace(/^\uFEFF/, '')
      : new Uint8Array(await file.arrayBuffer());
    const aoa = sheetToAoa(input, isText);
    result = parseShinhanCard(aoa) || parseGeneric(aoa, file.name);
  }
  if (!result) throw new Error('읽을 수 있는 표를 찾지 못했습니다. 현대카드 .xls, 신한카드 .xlsx, 또는 날짜·내용·금액 열이 있는 엑셀/CSV를 넣어주세요.');
  result.rows.forEach((r) => { r.categoryId = r.type === 'expense' ? guessCategory(r.merchant) : null; });
  result.fileName = file.name;
  // 파일 안에 카드·계좌가 몇 개나 섞여 있는지 (내 것 / 아내 것 구분용)
  const cards = new Map();
  result.rows.forEach((r) => {
    const key = r.cardRaw || '(카드번호 없음)';
    const c = cards.get(key) || { cardRaw: r.cardRaw || '', count: 0, amount: 0, accountId: r.accountId || '' };
    c.count += 1;
    c.amount += r.amount;
    cards.set(key, c);
  });
  result.cards = [...cards.values()];
  return result;
}

/** 파일 내용과 앱에 이미 있는 내역을 대조한다 */
export function reconcile(parsed) {
  const existing = state.data.transactions;
  const byKey = new Map(existing.map((t) => [dedupKey(t), t]));
  const dates = parsed.rows.map((r) => r.date).sort();
  const range = { from: dates[0], to: dates[dates.length - 1] };

  const fresh = [];
  const dup = [];
  parsed.rows.forEach((r) => {
    (byKey.has(dedupKey(r)) ? dup : fresh).push(r);
  });

  // 같은 날·같은 가맹점인데 금액이 다른 건 (오타나 부분 취소일 수 있음).
  // 하루에 같은 가맹점을 여러 번 쓴 경우가 많아, 건수가 같은데 금액 구성이 다를 때만 알린다.
  const nameKey = (t) => `${t.date}|${(t.merchant || '').replace(/\s+/g, '')}`;
  const group = (list) => {
    const m = new Map();
    list.forEach((t) => {
      const k = nameKey(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return m;
  };
  const fileGroups = group(parsed.rows);
  const appGroups = group(existing.filter((t) => t.type === 'expense'
    && t.date >= range.from && t.date <= range.to));
  const mismatched = [];
  fileGroups.forEach((fileRows, key) => {
    const appRows = appGroups.get(key);
    if (!appRows || appRows.length !== fileRows.length) return;   // 건수가 다르면 신규/누락 목록에서 다룬다
    const sortAmt = (rs) => rs.map((r) => r.amount).sort((a, b) => a - b);
    const a = sortAmt(appRows);
    const f = sortAmt(fileRows);
    if (a.join(',') === f.join(',')) return;
    mismatched.push({ app: appRows[0], file: fileRows[0], appRows, fileRows });
  });

  // 파일 기간 안에 앱에만 있는 거래 (파일에서 빠졌거나, 직접 입력한 건)
  const fileKeys = new Set(parsed.rows.map(dedupKey));
  const accounts = new Set(parsed.rows.map((r) => r.accountId).filter(Boolean));
  const onlyInApp = existing.filter((t) => t.type === 'expense'
    && t.date >= range.from && t.date <= range.to
    && (accounts.size ? accounts.has(t.accountId) : true)
    && !fileKeys.has(dedupKey(t)));

  const note = parsed.kind === '현대카드 명세서'
    ? '명세서는 매입일 기준이라 실시간 이용내역과 날짜가 하루 이틀 어긋날 수 있습니다. 이미 넣은 기간과 겹치면 같은 거래가 두 번 들어갈 수 있으니, 겹치지 않는 기간만 넣으세요.'
    : '';
  return { fresh, dup, mismatched, onlyInApp, range, note, skipped: parsed.skipped || [] };
}
