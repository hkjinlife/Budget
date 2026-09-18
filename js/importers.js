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
    const merchant = String(r[iName >= 0 ? iName : 1] || '').trim();
    // 입금·출금 칸이 따로 있으면 통장 내역 → 적요로 종류를 나눈다
    const cls = (iOut >= 0 || iIn >= 0) ? classifyBank(merchant, amount) : { type: 'expense' };
    rows.push({
      date, time: timeOf(r[iDate]), merchant,
      amount, cardRaw, accountId: acct ? acct.id : '', owner: acct ? acct.owner : '',
      type: cls.type, categoryId: cls.categoryId, memo: cls.memo || '', source: 'import:파일',
    });
  });
  return { rows, skipped: [], kind: '일반 파일', columns: cols };
}


/* ---------- 통장·카드 내역 분류 (엑셀·PDF 공통) ---------- */
/** 통장 적요로 거래 종류를 정한다. 모르는 출금은 소비로 세지 않고 '확인 필요' 이체로 둔다 (카드대금 이중 계산 방지) */
export function classifyBank(memo, amount) {
  const m = memo || '';
  const names = (state.data.users || []).map((u) => u.name).filter((n) => n && n.length >= 2);
  if (/펀드|환매|증권|CMS|연금저축|청약/.test(m)) return { type: 'investment' };
  if (/카드/.test(m) && amount < 0) return { type: 'card_payment' };
  if (/대출|원리금/.test(m) && amount < 0) return { type: 'expense', categoryId: 'loan_interest' };
  if (/이자|결산/.test(m) && amount > 0) return { type: 'income', memo: '이자' };
  if (/급여|월급|상여/.test(m) && amount > 0) return { type: 'income', memo: '급여' };
  if (names.some((n) => m.includes(n))) return { type: 'transfer', memo: '본인·가족 계좌 이동' };
  // 사람 이름만 있는 입금(예: "홈) 홍길동")은 월급이 아니라 개인에게 받은 돈일 가능성이 높다
  const bare = m.replace(/^[^가-힣A-Za-z]*(홈|모|폰|인뱅|스뱅)?[)>\s]*/, '').replace(/^(신한|국민|우리|하나|농협|기업|K뱅|카카오|토스)/, '').trim();
  if (amount > 0 && /^[가-힣]{2,4}$/.test(bare)) return { type: 'transfer', memo: '받은 돈 — 확인 필요' };
  if (amount > 0) return { type: 'income' };
  const cat = guessCategory(m);
  if (cat !== 'etc') return { type: 'expense', categoryId: cat };
  return { type: 'transfer', memo: '확인 필요' };
}

/* ---------- PDF ---------- */
let pdfLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    s.onerror = () => { pdfLoading = null; rej(new Error('PDF 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
    document.head.appendChild(s);
  });
  return pdfLoading;
}

/** PDF의 글자를 줄 단위로 모은다. 한 줄 = 같은 높이(y)에 있는 글자 조각들을 왼쪽부터 */
async function pdfLines(file) {
  const pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = [];
    content.items.forEach((it) => {
      const str = (it.str || '').trim();
      if (!str) return;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width || 0, str });
    });
    rows.sort((a, b) => b.y - a.y);
    rows.forEach((r) => {
      r.items.sort((a, b) => a.x - b.x);
      // 가까이 붙은 조각은 한 칸으로 합친다 (예: "2026.09" + ".14")
      const cells = [];
      r.items.forEach((it) => {
        const last = cells[cells.length - 1];
        if (last && it.x - (last.x + last.w) < 2.5) {
          last.str += it.str;
          last.w = it.x + it.w - last.x;
        } else cells.push({ ...it });
      });
      lines.push({ page: p, y: r.y, cells });
    });
  }
  return lines;
}

const DATE_RE = /^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/;
const NUM_RE = /^-?[\d,]+(\.\d+)?$/;
const COLS = [
  ['date', /거래일|일자|날짜|이용일|거래일시/],
  ['time', /시간|시각/],
  ['out', /출금|지급|찾으신/],
  ['in', /입금|맡기신|예입/],
  ['bal', /잔액/],
  ['amt', /이용금액|거래금액|^금액/],
  ['memo', /적요|내용|기재|가맹점|받는분|보낸분|메모/],
  ['branch', /취급|거래점|지점/],
];

/** 통장·카드 내역 PDF → 거래 목록 */
async function parsePdf(file) {
  const lines = await pdfLines(file);
  const allText = lines.map((l) => l.cells.map((c) => c.str).join(' ')).join('\n');
  if (!lines.length || allText.replace(/\s/g, '').length < 20) {
    throw new Error('PDF에서 글자를 찾지 못했습니다. 스캔한(사진으로 된) PDF는 읽을 수 없습니다.');
  }
  const acctMatch = allText.match(/계좌번호\s*[:：]?\s*([\d-]{8,})/) || allText.match(/\d{3,4}-\d{2,6}-\d{3,7}/);
  const cardRawAll = acctMatch ? (acctMatch[1] || acctMatch[0]) : '';

  // 표 머리글 찾기 (여러 쪽이면 쪽마다 머리글이 반복된다)
  let header = null;
  const rows = [];
  lines.forEach((line) => {
    const text = line.cells.map((c) => c.str).join(' ');
    const isHeader = (/출금|지급|찾으신/.test(text) && /입금|맡기신/.test(text))
      || (/이용금액|거래금액/.test(text) && /가맹점|이용일/.test(text));
    if (isHeader) {
      header = {};
      line.cells.forEach((c) => {
        const col = COLS.find(([, re]) => re.test(c.str));
        if (col && header[col[0]] == null) header[col[0]] = c.x + c.w / 2;
      });
      return;
    }
    if (!header || !DATE_RE.test(line.cells[0]?.str || '')) return;

    const cells = line.cells;
    const date = isoDate(cells[0].str);
    const time = timeOf(cells.map((c) => c.str).join(' '));
    const numCols = ['out', 'in', 'bal', 'amt'].filter((k) => header[k] != null)
      .sort((a, b) => header[a] - header[b]);
    const nums = cells.slice(1).filter((c) => NUM_RE.test(c.str.replace(/원$/, '')) && !/^\d{1,2}:\d{2}/.test(c.str));
    const vals = {};
    if (nums.length === numCols.length) {
      nums.forEach((c, i) => { vals[numCols[i]] = num(c.str); });   // 개수가 맞으면 순서대로
    } else {
      nums.forEach((c) => {                                          // 아니면 가까운 머리글로
        const mid = c.x + c.w / 2;
        const best = numCols.reduce((a, k) => (Math.abs(header[k] - mid) < Math.abs(header[a] - mid) ? k : a), numCols[0]);
        if (best && vals[best] == null) vals[best] = num(c.str);
      });
    }
    const texts = cells.slice(1).filter((c) => !nums.includes(c) && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(c.str));
    let memoCells = texts;
    if (header.memo != null) {
      // 적요 칸 가장 가까운 글자들 (취급점 같은 오른쪽 칸은 뺀다)
      const textCols = ['memo', 'branch', 'bal', 'in', 'out', 'amt'].filter((k) => header[k] != null);
      memoCells = texts.filter((c) => {
        const mid = c.x + c.w / 2;
        const best = textCols.reduce((a, k) => (Math.abs(header[k] - mid) < Math.abs(header[a] - mid) ? k : a), 'memo');
        return best === 'memo';
      });
      if (!memoCells.length) memoCells = texts.slice(0, 1);
    }
    const memo = memoCells.map((c) => c.str).join(' ').trim();
    let amount = 0;
    if (vals.in) amount = Math.abs(vals.in);
    else if (vals.out) amount = -Math.abs(vals.out);
    else if (vals.amt) amount = -Math.abs(vals.amt);
    if (!date || !amount) return;
    rows.push({ date, time, merchant: memo || '(내용 없음)', amount, balance: vals.bal ?? null });
  });
  if (!rows.length) {
    throw new Error('PDF에서 거래 표를 찾지 못했습니다. 날짜·입금·출금(또는 이용금액) 머리글이 있는 내역 PDF를 넣어주세요.');
  }

  const isBank = header && (header.out != null || header.in != null);
  const acct = matchAccount(cardRawAll);
  return {
    kind: isBank ? '통장 PDF' : '카드 PDF',
    skipped: [],
    rows: rows.map((r) => {
      const cls = isBank ? classifyBank(r.merchant, r.amount) : { type: 'expense' };
      return {
        date: r.date, time: r.time, merchant: r.merchant, amount: r.amount, cardRaw: cardRawAll,
        accountId: acct ? acct.id : '', owner: acct ? acct.owner : '',
        type: cls.type, categoryId: cls.categoryId, memo: cls.memo || '', source: 'import:PDF',
      };
    }),
  };
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
  if (name.endsWith('.pdf')) result = await parsePdf(file);
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
  if (!result) throw new Error('읽을 수 있는 표를 찾지 못했습니다. 카드사·은행의 엑셀(.xls, .xlsx), CSV, PDF 내역을 넣어주세요.');
  result.rows.forEach((r) => {
    if (r.type === 'expense') r.categoryId ||= guessCategory(r.merchant);
    else r.categoryId = r.categoryId || null;
  });
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


/* ---------- 자동 연결: 은행 내역을 올리면 자산에도 반영 ---------- */
// 적요·금액이 맞으면 그 금액만큼 자산(연금저축·청약 등)의 원금과 평가금액을 늘린다.
// userName: 적요가 가족 이름일 때만 (예: 본인 명의 청약 자동이체), amount: 금액이 정확히 같을 때만
export const DEFAULT_AUTOLINKS = [
  { id: 'kis', name: '연금저축 자동이체', match: '한국증권|한국투자', dir: 'out', asset: '연금저축|한국투자', on: true },
  { id: 'sub', name: '주택청약 자동이체', match: '청약', dir: 'out', asset: '청약', on: true },
  { id: 'sub_self', name: '주택청약 (본인 이름 10만원 자동이체)', userName: true, amount: 100000, dir: 'out', asset: '청약', on: true },
];

export function autoLinks() {
  return state.data.autoLinks?.length ? state.data.autoLinks : DEFAULT_AUTOLINKS;
}

const OTHER_BANK = /신한|국민|우리|하나|농협|기업|K뱅|케이뱅|카카오|토스|새마을|우체국|SC|씨티|수협|부산|대구|광주|경남|제주|IBK|KB/;

/** 투자 계좌(예: 전북은행)로 쓰는 통장인지 */
function investGroupOf(accountId) {
  const a = state.data.accounts.find((x) => x.id === accountId);
  if (!a) return null;
  if (a.investGroup) return a.investGroup;
  return /전북/.test(a.name) ? 'jeonbuk' : null;
}

/** 투자 통장(전북 등)의 입출금 → 투자 원금 기록. 계좌 기준이라 금액이 바뀌어도 그대로 맞는다 */
export function applyInvestFlows(rows) {
  const notes = [];
  const users = (state.data.users || []).map((u) => u.name).filter((n) => n && n.length >= 2);
  state.data.linked ||= {};
  const inv = state.data.investment ||= { flows: [], holdings: [] };
  inv.flows ||= [];
  const flowKeys = new Set(inv.flows.map((f) => `${f.date}|${f.amount}`));
  let principalDelta = 0;
  let fxDelta = 0;
  rows.forEach((t) => {
    const group = investGroupOf(t.accountId);
    if (!group) return;
    const m = t.merchant || '';
    if (/펀드|환매|취소|이자|결산/.test(m)) return;          // 펀드 사고팔기·이자는 원금 변동 아님
    const k = `${t.date}|${t.amount}`;
    if (flowKeys.has(k) || state.data.linked[linkKey(t)]) return;
    const own = users.some((n) => m.includes(n));
    const internal = own && !OTHER_BANK.test(m.replace(/^[^가-힣A-Za-z]*/, ''));   // 같은 은행 안 본인 계좌(외화예금 등)
    inv.flows.push({
      date: t.date, amount: t.amount, group, include: !internal, memo: m,
      note: internal ? '같은 은행 본인 계좌(외화예금 등)로 이동 — 원금 변동 아님' : '통장 내역에서 자동 연결',
    });
    flowKeys.add(k);
    state.data.linked[linkKey(t)] = 'flow';
    if (internal) fxDelta += -t.amount; else principalDelta += t.amount;
  });
  if (principalDelta) notes.push(`투자 원금 ${principalDelta > 0 ? '+' : ''}${principalDelta.toLocaleString('ko-KR')}원`);
  if (fxDelta) notes.push(`외화예금으로 옮긴 돈 ${fxDelta > 0 ? '+' : ''}${fxDelta.toLocaleString('ko-KR')}원 — 달러 잔액은 월말 정리에서 고쳐주세요`);
  return notes;
}

export const linkKey = (t) => `${t.date}|${t.accountId}|${t.merchant}|${t.amount}`;

function ruleMatches(rule, t, users) {
  if (rule.on === false) return false;
  if (rule.dir === 'out' && t.amount >= 0) return false;
  if (rule.dir === 'in' && t.amount <= 0) return false;
  const m = t.merchant || '';
  if (rule.match && !new RegExp(rule.match).test(m)) return false;
  if (rule.userName && !users.some((n) => m.includes(n))) return false;
  if (rule.amount && Math.abs(t.amount) !== Number(rule.amount)) return false;
  return true;
}

/**
 * 저축·투자로 보이는 출금을 골라 '어디에 연결할지' 제안한다.
 * 규칙에 맞으면 대상 자산을 미리 골라두고, 안 맞아도 이체·투자로 분류된 출금은 목록에 꼭 올린다.
 */
export function suggestLinks(rows) {
  const users = (state.data.users || []).map((u) => u.name).filter((n) => n && n.length >= 2);
  state.data.linked ||= {};
  return rows
    .filter((t) => t.amount < 0 && !state.data.linked[linkKey(t)] && !investGroupOf(t.accountId))
    .map((t) => {
      const rule = autoLinks().find((r) => ruleMatches(r, t, users));
      const looksSaving = rule || t.type === 'investment'
        || (t.type === 'transfer' && /본인|가족|확인/.test(t.memo || ''));
      if (!looksSaving) return null;
      return { t, ruleId: rule?.id || null, asset: rule?.asset || '' };
    })
    .filter(Boolean);
}

/** 사용자가 고른 대로 자산에 반영하고, 원하면 다음부터 자동으로 고르도록 규칙을 저장한다 */
export function commitLinks(choices) {
  const notes = [];
  const users = (state.data.users || []).map((u) => u.name).filter((n) => n && n.length >= 2);
  const assets = state.data.otherAssets ||= [];
  state.data.linked ||= {};
  const sums = new Map();
  choices.forEach(({ t, assetName, remember }) => {
    if (!assetName) return;
    const a = assets.find((x) => x.name === assetName);
    if (!a) return;
    const amt = Math.abs(t.amount);
    a.principal = (a.principal || 0) + amt;
    a.value = (a.value || 0) + amt;               // 평가금액은 월말에 실제 값으로 고친다
    a.updatedAt = new Date().toISOString().slice(0, 10);
    state.data.linked[linkKey(t)] = assetName;
    const tx = state.data.transactions.find((x) => linkKey(x) === linkKey(t));
    if (tx) { tx.type = 'investment'; tx.memo = `${assetName} 납입`; }
    sums.set(assetName, (sums.get(assetName) || 0) + amt);
    if (remember) {
      // 적요가 가족 이름뿐이면 다른 이체와 헷갈리니 금액까지 같이 기억한다
      const m = (t.merchant || '').trim();
      const isName = users.some((n) => m.includes(n)) && m.replace(/[^가-힣]/g, '').length <= 5;
      const core = m.replace(/\d{3,}/g, '').replace(/[()[\]{}.*+?^$|\\]/g, '').trim() || m;
      state.data.autoLinks = autoLinks().map((r) => ({ ...r }));
      const exists = state.data.autoLinks.some((r) => ruleMatches(r, t, users) && new RegExp(r.asset).test(assetName));
      if (!exists) {
        state.data.autoLinks.push({
          id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          name: `${assetName} ${isName ? `(${Math.abs(t.amount).toLocaleString('ko-KR')}원)` : `(${core})`}`,
          ...(isName ? { userName: true, amount: Math.abs(t.amount) } : { match: core }),
          dir: 'out', asset: assetName.replace(/[()[\]{}.*+?^$|\\]/g, '.'), on: true,
        });
      }
    }
  });
  sums.forEach((v, k) => notes.push(`${k} +${v.toLocaleString('ko-KR')}원`));
  return notes;
}
