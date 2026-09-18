// 집계·분류 로직. 화면과 그래프는 모두 여기 함수를 쓴다.
import { state } from './store.js';


export function won(n, { sign = false } = {}) {
  if (n == null || Number.isNaN(n)) return '-';
  const s = Math.round(Math.abs(n)).toLocaleString('ko-KR');
  const pre = n < 0 ? '-' : (sign && n > 0 ? '+' : '');
  return `${pre}${s}원`;
}
/** 큰 금액을 읽기 쉽게: 1억 넘으면 '억', 아니면 '만' */
export function manwon(n) {
  if (n == null || Number.isNaN(n)) return '-';
  if (Math.abs(n) >= 100000000) {
    const eok = n / 100000000;
    return `${eok.toLocaleString('ko-KR', { maximumFractionDigits: Math.abs(eok) >= 10 ? 1 : 2 })}억`;
  }
  const v = n / 10000;
  const digits = Math.abs(v) >= 100 ? 0 : 1;
  return `${v.toLocaleString('ko-KR', { maximumFractionDigits: digits })}만`;
}
export function pct(n) {
  return n == null || !Number.isFinite(n) ? '-' : `${(n * 100).toFixed(1)}%`;
}

export function categories() { return state.data.categories; }
export function categoryById(id) { return state.data.categories.find((c) => c.id === id); }
export function categoryName(id) { return categoryById(id)?.name || '미분류'; }
export function majorOf(id) { return categoryById(id)?.major || '변동비'; }
export function accountById(id) { return state.data.accounts.find((a) => a.id === id); }
export function accountName(id) { return accountById(id)?.name || id || '-'; }
export function userName(id) { return state.data.users.find((u) => u.id === id)?.name || id; }

/** 키워드 규칙으로 카테고리 추정 */
export function guessCategory(merchant) {
  // 순서가 중요하다: 예) '타이어'(자동차)가 '타이'(식당)보다 먼저
  const order = ['tax', 'car_charge', 'car_buy', 'car_run', 'insurance', 'telecom', 'subscription',
    'housing', 'transit', 'leisure', 'travel', 'kids', 'medical', 'beauty', 'food_cafe', 'food_grocery',
    'food_dining', 'shopping', 'dues', 'pay_unknown', 'card_unknown'];
  const rest = categories().map((c) => c.id).filter((id) => !order.includes(id) && id !== 'etc');
  for (const id of [...order, ...rest]) {
    const c = categoryById(id);
    try {
      if (c?.keywords && new RegExp(c.keywords).test(merchant)) return id;
    } catch { /* 설정에서 키워드를 잘못 적은 경우 건너뛴다 */ }
  }
  return 'etc';
}

/** 사용자 필터 적용 */
export function visibleTx() {
  const u = state.ui.user;
  return state.data.transactions.filter((t) => u === 'all' || t.owner === u);
}

export function months() {
  const s = new Set(state.data.transactions.map((t) => t.date.slice(0, 7)));
  return [...s].sort();
}

const isSpend = (t) => t.type === 'expense' && !t.excluded;

/** 월 × 카테고리 소비 합계 (지출은 양수로 변환) */
export function spendMatrix(txs = visibleTx()) {
  const m = new Map();
  txs.filter(isSpend).forEach((t) => {
    const key = t.date.slice(0, 7);
    const row = m.get(key) || new Map();
    const cid = t.categoryId || 'etc';
    row.set(cid, (row.get(cid) || 0) + -t.amount);
    m.set(key, row);
  });
  return m;
}

export function monthTotals(txs = visibleTx()) {
  const out = new Map();
  const bump = (mo, key, v) => {
    const row = out.get(mo) || { 고정비: 0, 변동비: 0, 일회성: 0, income: 0, incomeMain: 0 };
    row[key] += v;
    out.set(mo, row);
  };
  txs.forEach((t) => {
    const mo = t.date.slice(0, 7);
    if (isSpend(t)) bump(mo, majorOf(t.categoryId), -t.amount);
    else if (t.type === 'income' && !t.excluded) {
      bump(mo, 'income', t.amount);
      if (!/일회성|가족 입금|이자/.test(t.memo || '')) bump(mo, 'incomeMain', t.amount);
    }
  });
  return out;
}

export function categoryTotalsFor(month, txs = visibleTx()) {
  const row = spendMatrix(txs).get(month) || new Map();
  return [...row.entries()]
    .map(([id, amount]) => ({ id, name: categoryName(id), major: majorOf(id), amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** 평균을 낼 만한 '온전한 달' — 카드 상세가 있는 달만 */
export function fullMonths() {
  const counts = new Map();
  state.data.transactions.filter((t) => t.accountId?.includes('card')).forEach((t) => {
    const mo = t.date.slice(0, 7);
    counts.set(mo, (counts.get(mo) || 0) + 1);
  });
  const today = new Date().toISOString().slice(0, 7);
  return [...counts.entries()].filter(([mo, n]) => n >= 20 && mo < today).map(([mo]) => mo).sort();
}

/* ---------- 투자 ---------- */
export function investSummary() {
  const inv = state.data.investment;
  const groups = {};
  const add = (g) => (groups[g] ||= { inflow: 0, outflow: 0, principal: 0, value: 0, internal: 0 });
  inv.flows.forEach((f) => {
    const g = add(f.group || 'jeonbuk');
    if (f.include === false) { g.internal += f.amount; return; }
    if (f.amount >= 0) g.inflow += f.amount; else g.outflow += f.amount;
    g.principal += f.amount;
  });
  inv.holdings.forEach((h) => { add(h.group || 'jeonbuk').value += Number(h.value) || 0; });
  Object.values(groups).forEach((g) => {
    g.profit = g.value - g.principal;
    g.rate = g.principal ? g.profit / g.principal : null;
  });
  // 전북 안에서 외화예금으로 옮긴 돈은 원금이 아니라 내부 이동 — 달러 성과만 따로 본다
  const fxValue = inv.holdings.filter((h) => h.kind === 'fx').reduce((s, h) => s + (Number(h.value) || 0), 0);
  const jb = groups.jeonbuk;
  const fx = jb && jb.internal ? {
    principal: -jb.internal, value: fxValue,
    profit: fxValue + jb.internal, rate: jb.internal ? (fxValue + jb.internal) / -jb.internal : null,
  } : null;
  const fund = jb ? {
    principal: jb.principal - (fx?.principal || 0),
    value: jb.value - (fx?.value || 0),
  } : null;
  if (fund) { fund.profit = fund.value - fund.principal; fund.rate = fund.principal ? fund.profit / fund.principal : null; }
  const total = Object.values(groups).reduce((a, g) => ({
    principal: a.principal + g.principal, value: a.value + g.value,
  }), { principal: 0, value: 0 });
  total.profit = total.value - total.principal;
  total.rate = total.principal ? total.profit / total.principal : null;
  return { groups, fx, fund, total };
}

export const GROUP_NAMES = { jeonbuk: '전북은행 (펀드+외화)', crypto: '비트코인', etc: '기타' };


/* ---------- 대출 ---------- */
export const LOAN_TYPES = {
  equal_payment: '원리금균등',
  equal_principal: '원금균등',
  interest_only: '만기일시(이자만)',
};

export function loans() { return state.data.loans || []; }

export function visibleLoans() {
  const u = state.ui.user;
  return loans().filter((l) => u === 'all' || l.owner === u);
}

export function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** 월 납입액: 적어둔 값이 있으면 그대로, 없으면 계산 */
export function loanPayment(loan) {
  if (loan.monthlyPayment) return loan.monthlyPayment;
  const r = (loan.rate || 0) / 100 / 12;
  const n = Math.max(monthsBetween(loan.startDate, loan.endDate), 1);
  if (loan.type === 'interest_only') return Math.round((loan.balance || 0) * r);
  if (loan.type === 'equal_principal') return Math.round((loan.principal || 0) / n + (loan.balance || 0) * r);
  if (!r) return Math.round((loan.principal || 0) / n);
  return Math.round((loan.principal || 0) * r / (1 - (1 + r) ** -n));
}

/**
 * 남은 상환 일정. prepay만큼 지금 갚았다고 가정할 수도 있다.
 * 반환: {rows:[{month, date, interest, principal, balance}], totalInterest, months, endDate}
 */
export function loanSchedule(loan, prepay = 0) {
  const r = (loan.rate || 0) / 100 / 12;
  const pay = loanPayment(loan);
  const start = new Date(loan.balanceDate || new Date().toISOString().slice(0, 10));
  let balance = Math.max((loan.balance || 0) - prepay, 0);
  const n = Math.max(monthsBetween(loan.startDate, loan.endDate), 1);
  const fixedPrincipal = (loan.principal || 0) / n;
  const rows = [];
  let totalInterest = 0;
  for (let m = 1; m <= 720 && balance > 0; m += 1) {
    const interest = Math.round(balance * r);
    let principal;
    if (loan.type === 'interest_only') {
      principal = m >= monthsBetween(loan.balanceDate || loan.startDate, loan.endDate) ? balance : 0;
    } else if (loan.type === 'equal_principal') {
      principal = Math.min(Math.round(fixedPrincipal), balance);
    } else {
      principal = Math.min(pay - interest, balance);
    }
    if (principal <= 0 && loan.type !== 'interest_only') break;   // 납입액이 이자보다 적으면 끝나지 않는다
    balance -= principal;
    totalInterest += interest;
    const date = new Date(start);
    date.setMonth(date.getMonth() + m);
    rows.push({ month: m, date: date.toISOString().slice(0, 10), interest, principal, balance });
  }
  return {
    rows,
    totalInterest,
    months: rows.length,
    endDate: rows.length ? rows[rows.length - 1].date : loan.endDate,
  };
}

export function loanSummary(list = visibleLoans()) {
  const out = {
    count: list.length, principal: 0, balance: 0, payment: 0,
    interestThisMonth: 0, principalThisMonth: 0, remainInterest: 0, lastEnd: '',
  };
  list.forEach((l) => {
    const r = (l.rate || 0) / 100 / 12;
    const pay = loanPayment(l);
    const interest = Math.round((l.balance || 0) * r);
    const sch = loanSchedule(l);
    out.principal += l.principal || 0;
    out.balance += l.balance || 0;
    out.payment += pay;
    out.interestThisMonth += interest;
    out.principalThisMonth += Math.max(pay - interest, 0);
    out.remainInterest += sch.totalInterest;
    if (sch.endDate > out.lastEnd) out.lastEnd = sch.endDate;
  });
  out.paidRatio = out.principal ? (out.principal - out.balance) / out.principal : 0;
  return out;
}


/* ---------- 리포트 ---------- */

/** 매달 반복되는 결제(구독·고정지출)를 찾아낸다 */
export function recurringPayments(txs = visibleTx()) {
  const byMerchant = new Map();
  txs.filter(isSpend).forEach((t) => {
    const key = (t.merchant || '').replace(/\s+/g, '').slice(0, 20);
    if (!key) return;
    const g = byMerchant.get(key) || { name: t.merchant, months: new Set(), total: 0, count: 0, last: '', categoryId: t.categoryId };
    g.months.add(t.date.slice(0, 7));
    g.total += -t.amount;
    g.count += 1;
    if (t.date > g.last) g.last = t.date;
    byMerchant.set(key, g);
  });
  return [...byMerchant.values()]
    .filter((g) => g.months.size >= 3)                 // 세 달 이상 나타나면 반복 결제로 본다
    .map((g) => ({ ...g, monthCount: g.months.size, perMonth: Math.round(g.total / g.months.size) }))
    .sort((a, b) => b.perMonth - a.perMonth);
}

/** 한 달치 자동 리포트 */
export function report(month) {
  const txs = visibleTx();
  const totals = monthTotals(txs);
  const base = fullMonths().filter((m) => m !== month).slice(-3);   // 비교 기준: 최근 온전한 달들
  const cur = totals.get(month) || { 고정비: 0, 변동비: 0, 일회성: 0, income: 0, incomeMain: 0 };
  const avg = (key) => (base.length
    ? base.reduce((sum, m) => sum + (totals.get(m)?.[key] || 0), 0) / base.length : 0);

  const spend = cur.고정비 + cur.변동비;
  const avgSpend = avg('고정비') + avg('변동비');
  const curCats = new Map(categoryTotalsFor(month, txs).map((r) => [r.id, r.amount]));
  const avgCats = new Map();
  categories().forEach((c) => {
    const vals = base.map((m) => (spendMatrix(txs).get(m)?.get(c.id) || 0));
    avgCats.set(c.id, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  });
  const changes = categories()
    .filter((c) => c.major !== '일회성')
    .map((c) => ({
      id: c.id, name: c.name, major: c.major,
      now: curCats.get(c.id) || 0, avg: avgCats.get(c.id) || 0,
      diff: (curCats.get(c.id) || 0) - (avgCats.get(c.id) || 0),
    }))
    .filter((c) => Math.abs(c.diff) >= 30000)
    .sort((a, b) => b.diff - a.diff);

  const big = txs.filter((t) => t.type === 'expense' && !t.excluded && t.date.startsWith(month)
    && majorOf(t.categoryId) !== '일회성')
    .sort((a, b) => a.amount - b.amount).slice(0, 5)
    .map((t) => ({ date: t.date, merchant: t.merchant, amount: -t.amount, category: categoryName(t.categoryId) }));

  const once = categoryTotalsFor(month, txs).filter((r) => r.major === '일회성');
  const inv = investSummary();
  const loan = loanSummary();
  const fixedRatio = cur.incomeMain ? cur.고정비 / cur.incomeMain : null;
  const surplus = cur.incomeMain - spend;

  return {
    month, base, spend, avgSpend, diff: spend - avgSpend,
    fixed: cur.고정비, variable: cur.변동비, income: cur.incomeMain,
    oneTimeIncome: cur.income - cur.incomeMain, once,
    surplus, fixedRatio, changes, big,
    recurring: recurringPayments(txs).slice(0, 12),
    invest: inv, loan,
    netWorth: inv.total.value + (state.data.otherAssets || []).reduce((a, x) => a + (x.value || 0), 0) - loan.balance,
  };
}

/** 사람이 읽는 문장으로 정리 (복사해서 상담·기록에 쓰기 좋게) */
export function reportText(r) {
  const L = [];
  const m = `${r.month.slice(0, 4)}년 ${Number(r.month.slice(5, 7))}월`;
  L.push(`[${m} 가계 리포트]`);
  L.push('');
  L.push(`· 소비 ${won(r.spend)} (고정비 ${won(r.fixed)} + 변동비 ${won(r.variable)})`);
  if (r.avgSpend) L.push(`· 최근 평균 대비 ${r.diff >= 0 ? '+' : ''}${manwon(r.diff)}원 (기준: ${r.base.join(', ')})`);
  L.push(`· 정기 수입 ${won(r.income)} → 남는 돈 ${won(r.surplus, { sign: true })}`);
  if (r.fixedRatio != null) L.push(`· 수입 대비 고정비 ${pct(r.fixedRatio)}`);
  if (r.oneTimeIncome) L.push(`· 일회성 유입 ${won(r.oneTimeIncome)} (따로 계산)`);
  if (r.once.length) L.push(`· 일회성 지출: ${r.once.map((o) => `${o.name} ${manwon(o.amount)}원`).join(', ')}`);
  L.push('');
  const up = r.changes.filter((c) => c.diff > 0).slice(0, 3);
  const down = r.changes.filter((c) => c.diff < 0).slice(-3).reverse();
  if (up.length) L.push(`· 늘어난 항목: ${up.map((c) => `${c.name} +${manwon(c.diff)}원`).join(', ')}`);
  if (down.length) L.push(`· 줄어든 항목: ${down.map((c) => `${c.name} ${manwon(c.diff)}원`).join(', ')}`);
  if (r.big.length) {
    L.push('');
    L.push(`· 큰 지출: ${r.big.map((b) => `${b.merchant} ${manwon(b.amount)}원`).join(', ')}`);
  }
  if (r.recurring.length) {
    const sum = r.recurring.reduce((a, x) => a + x.perMonth, 0);
    L.push(`· 매달 반복되는 결제 ${r.recurring.length}건, 월 ${won(sum)}`);
  }
  L.push('');
  L.push(`· 투자: 원금 ${won(r.invest.total.principal)} → 평가 ${won(r.invest.total.value)} (${pct(r.invest.total.rate)})`);
  if (r.loan.count) {
    L.push(`· 대출: 잔액 ${won(r.loan.balance)}, 금리 적용 월 이자 ${won(r.loan.interestThisMonth)}, 월 납입 ${won(r.loan.payment)}`);
  }
  L.push(`· 순자산(부동산 등 기록 자산 포함 − 대출): ${won(r.netWorth)}`);
  return L.join('\n');
}


/* ---------- 달력 ---------- */
/** 날짜별 소비 합계 (YYYY-MM-DD → 원) */
export function dayTotals(month, txs = visibleTx()) {
  const out = new Map();
  txs.filter((t) => isSpend(t) && t.date.startsWith(month)).forEach((t) => {
    out.set(t.date, (out.get(t.date) || 0) + -t.amount);
  });
  return out;
}

/** 달력 칸에 들어갈 짧은 금액 (8,500 / 3.2만 / 299만 / 7.2억) */
export function shortWon(n) {
  if (!n) return '';
  const a = Math.abs(n);
  if (a >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (a >= 1000000) return `${Math.round(n / 10000)}만`;
  if (a >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  return n.toLocaleString('ko-KR');
}

/* ---------- 월말 정리 ---------- */
// kind: upload(파일 올리기) / holdings(투자 평가금액 여러 개) / asset(자산 하나의 금액)
export const DEFAULT_CHECKLIST = [
  { id: 'card_shinhan', name: '신한카드', kind: 'upload', hint: '이용내역 엑셀이나 PDF를 받아 올리세요' },
  { id: 'card_hyundai', name: '현대카드', kind: 'upload', hint: '이용대금명세서 또는 실시간 이용내역(.xls)' },
  { id: 'bank_shinhan', name: '신한은행', kind: 'upload', hint: '입출금 거래내역 엑셀이나 PDF' },
  { id: 'bank_jeonbuk', name: '전북은행', kind: 'holdings', group: 'jeonbuk', hint: '펀드·외화예금 평가금액을 고치세요', alsoUpload: true },
  { id: 'kis', name: '한국투자증권', kind: 'asset', match: '연금저축|한국투자', hint: '연금저축 평가금액과 원금', alsoUpload: true, withPrincipal: true },
  { id: 'apt', name: '아파트 시세', kind: 'asset', match: '아파트', hint: 'KB시세나 실거래가' },
  { id: 'housing_sub', name: '주택청약', kind: 'asset', match: '청약', hint: '지금까지 넣은 총액' },
  { id: 'metlife', name: '변액유니버셜', kind: 'asset', match: '변액', hint: '보험사 앱의 적립금' },
];

export function checklist() {
  return state.data.checklist?.length ? state.data.checklist : DEFAULT_CHECKLIST;
}

export function monthStatus(month) {
  state.data.monthly ||= {};
  return (state.data.monthly[month] ||= {});
}

export function findAsset(item) {
  const assets = state.data.otherAssets || [];
  const re = item.match ? new RegExp(item.match) : null;
  return assets.find((a) => (re ? re.test(a.name) : a.name === item.name)) || null;
}

/* ---------- 증여 ---------- */
// 세율·공제는 상속세 및 증여세법 기준(2026). 참고용 계산이며 최종 판단은 세무사 확인.
export const GIFT_RULES = {
  // [과세표준 상한, 세율, 누진공제]
  brackets: [[1e8, 0.1, 0], [5e8, 0.2, 1e7], [1e9, 0.3, 6e7], [3e9, 0.4, 1.6e8], [Infinity, 0.5, 4.6e8]],
  limits: { direct: 5e7, other: 1e7, birth: 1e8, spouse: 6e8 },   // 직계존속(10년), 기타친족(10년), 혼인·출산(평생), 배우자(10년)
  creditRate: 0.03,                                                // 기한 내 신고세액공제
};
// 받은 사람 쪽에서 본 관계
export const GIFT_RELATIONS = ['부', '모', '조부', '조모', '배우자', '장인', '장모', '시부', '시모', '기타친족'];
const giftClass = (rel) => (['부', '모', '조부', '조모'].includes(rel) ? 'direct' : rel === '배우자' ? 'spouse' : 'other');

/** 증여세 산출세액 (과세표준 → 세액) */
export function giftTax(base) {
  if (!(base > 0)) return 0;
  const [, rate, ded] = GIFT_RULES.brackets.find(([upto]) => base <= upto);
  return Math.round(base * rate - ded);
}

/** 지금 과세표준이 속한 세율 구간과, 그 구간에서 더 받을 수 있는 금액 */
export function giftBracket(base) {
  const b = Math.max(0, base || 0);
  const i = GIFT_RULES.brackets.findIndex(([upto]) => b < upto);
  const [upto, rate] = GIFT_RULES.brackets[i];
  return { rate, upto, room: upto === Infinity ? null : upto - b };
}

export function giftList() {
  return (state.data.gifts || []).filter((g) => !g.deleted).sort((a, b) => a.date.localeCompare(b.date));
}

/** 10년 합산 묶음: 부모님(부·모)은 한 사람으로 본다(상증법 §47②). 조부모도 부부 합산. 그 밖에는 증여자별 */
export function giftGroupKey(g) {
  const who = ['부', '모'].includes(g.relation) ? '부모' : ['조부', '조모'].includes(g.relation) ? '조부모' : g.giver;
  return `${g.receiver}|${who}`;
}

const addYears = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;

/** 증여 현황: 받은 사람별·합산 묶음별 누적, 지금 과세표준·세율 구간, 공제 사용 */
export function giftStatus(receiver = 'all', asOf = new Date().toISOString().slice(0, 10)) {
  const list = giftList().filter((g) => receiver === 'all' || g.receiver === receiver);
  const from = addYears(asOf, -10);             // 이 날 이후 증여만 10년 합산에 들어간다
  const groups = new Map();
  list.forEach((g) => {
    const k = giftGroupKey(g);
    if (!groups.has(k)) groups.set(k, { key: k, receiver: g.receiver, givers: [], relation: g.relation, items: [] });
    const gr = groups.get(k);
    if (!gr.givers.includes(g.giver)) gr.givers.push(g.giver);
    gr.items.push(g);
  });
  const order = (state.data.users || []).map((u) => u.id);
  const out = [...groups.values()].sort((a, b) => order.indexOf(a.receiver) - order.indexOf(b.receiver)).map((gr) => {
    const inWin = gr.items.filter((g) => g.date >= from);
    const last = gr.items[gr.items.length - 1];                    // 가장 최근 신고(또는 예상)
    const dropped = gr.items.filter((g) => g.date < from && g.date <= last.date);
    const base = last.date >= from ? (Number(last.base) || 0) : 0;
    const next = inWin[0];
    return {
      ...gr,
      cls: giftClass(gr.relation),
      total: gr.items.reduce((s, g) => s + (Number(g.amount) || 0), 0),
      paid: gr.items.reduce((s, g) => s + (Number(g.paid) || 0), 0),
      window: inWin.reduce((s, g) => s + (Number(g.amount) || 0), 0),
      base,
      prevTax: last.date >= from ? (Number(last.calcTax) || 0) : 0,  // 다음 증여 때 빼주는 기납부세액
      bracket: giftBracket(base),
      nextDrop: next ? { date: addYears(next.date, 10), amount: Number(next.amount) || 0 } : null,
      changedWindow: dropped.length > 0 && last.date >= from,         // 마지막 신고 뒤로 합산에서 빠진 증여가 있음
      estimated: gr.items.some((g) => g.status === '예상'),
    };
  });
  // 받은 사람별 공제 사용 (직계·기타친족은 10년, 혼인·출산은 평생). 같은 묶음 안에서는 마지막 신고의 공제가 누적 기준
  const recv = [...new Set(list.map((g) => g.receiver))].map((id) => {
    const mine = out.filter((o) => o.receiver === id);
    const lastOf = (o) => o.items[o.items.length - 1];
    const used = (cls, field) => mine.filter((o) => o.cls === cls && lastOf(o).date >= from)
      .reduce((s, o) => s + (Number(lastOf(o)[field]) || 0), 0);
    const items = list.filter((g) => g.receiver === id);
    const total = items.reduce((s, g) => s + (Number(g.amount) || 0), 0);
    const paid = items.reduce((s, g) => s + (Number(g.paid) || 0), 0);
    return {
      id, total, paid, count: items.length, rate: total ? paid / total : 0,
      direct: used('direct', 'deductDirect'),
      other: used('other', 'deductOther'),
      birth: Math.max(0, ...items.map((g) => Number(g.deductBirth) || 0)),
    };
  });
  const total = list.reduce((s, g) => s + (Number(g.amount) || 0), 0);
  const paid = list.reduce((s, g) => s + (Number(g.paid) || 0), 0);
  return { groups: out, receivers: recv, total, paid, count: list.length, rate: total ? paid / total : 0 };
}

/** 새 증여의 예상 세액. 같은 묶음의 마지막 신고 위에 얹는다고 보고 계산한다 (합산 제외·공제 변화는 세무사 확인) */
export function giftEstimate({ date, receiver, giver, relation, amount }) {
  const g0 = { date, receiver, giver, relation };
  const key = giftGroupKey(g0);
  const prev = giftList().filter((g) => giftGroupKey(g) === key && g.date <= date);
  const from = addYears(date, -10);
  const last = prev.filter((g) => g.date >= from).pop();
  const amt = Number(amount) || 0;
  let base;
  let ded = { deductDirect: 0, deductOther: 0, deductBirth: 0 };
  if (last) {
    // 공제는 이미 앞 신고에서 반영돼 있으므로 받은 금액이 그대로 과세표준에 더해진다
    base = (Number(last.base) || 0) + amt;
    ded = { deductDirect: last.deductDirect || 0, deductOther: last.deductOther || 0, deductBirth: last.deductBirth || 0 };
  } else {
    // 처음 받는 묶음: 같은 종류 공제 중 10년 안에 다른 사람에게서 쓴 만큼 빼고 남은 공제
    const cls = giftClass(relation);
    const st = giftStatus(receiver, date).receivers.find((r) => r.id === receiver);
    const field = cls === 'direct' ? 'deductDirect' : cls === 'other' ? 'deductOther' : null;
    const limit = cls === 'spouse' ? GIFT_RULES.limits.spouse : GIFT_RULES.limits[cls];
    const usedAlready = st ? (cls === 'direct' ? st.direct : cls === 'other' ? st.other : 0) : 0;
    const d = Math.min(amt, Math.max(0, limit - usedAlready));
    if (field) ded[field] = d;
    base = Math.max(0, amt - d);
  }
  const surcharge = ['조부', '조모'].includes(relation) ? 1.3 : 1;     // 세대생략 할증 30%
  const calcTax = Math.round(giftTax(base) * surcharge);
  const prevTax = last ? Number(last.calcTax) || 0 : 0;
  const credit = Math.max(0, Math.round((calcTax - prevTax) * GIFT_RULES.creditRate));
  const paid = Math.max(0, calcTax - prevTax - credit);
  return {
    ...ded, addBack: last ? Number(last.taxable) || 0 : 0, taxable: (last ? Number(last.taxable) || 0 : 0) + amt,
    // 이번 증여의 맨 위 금액에 붙는 세율 (과세표준이 구간 끝과 같으면 그 구간 세율)
    base, rate: `${Math.round(GIFT_RULES.brackets.find(([upto]) => base <= upto)[1] * 100)}%`, calcTax, prevTax, credit, paid,
    droppedSinceLast: prev.some((g) => g.date < from),
  };
}
