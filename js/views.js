// 화면 렌더링. 각 함수는 HTML 문자열을 만들고, mount()에서 이벤트를 붙인다.
import { state, touch, removeTransaction, addTransactions, today, canUseFileSystem, connectFile, exportFile, importFile, save, resetData, forgetDevice, addFeedback, updateFeedback, removeFeedback, saveUI as saveUIState, applyIncoming } from './store.js';
import * as M from './model.js';
import { monthlyChart, categoryChart, investChart, loanChart } from './charts.js';
import { parseFile, reconcile } from './importers.js';
import * as gd from './gdrive.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const toast = (msg) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
};

const monthLabel = (mo) => `${Number(mo.slice(5, 7))}월`;
const catOptions = (sel) => M.categories().map((c) =>
  `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const TYPES = { expense: '소비', income: '수입', transfer: '계좌이체', investment: '투자', card_payment: '카드대금' };
const editable = () => !!state.ui.edit;
const lockNote = (what) => `<div class="notice">지금은 <b>보기 모드</b>입니다. ${what}을 고치려면 위쪽 <b>편집</b> 버튼을 누르세요.</div>`;

/* ================= 대시보드 ================= */
export function welcome() {
  return `
  <div class="card">
    <h2>처음 오셨네요</h2>
    <p>아직 가계부 데이터가 없습니다. 클라우드 공유 폴더에 있는 <b>가계부_데이터.json</b>을 불러오면 시작됩니다.</p>
    <div class="btn-row" style="margin-top:12px">
      <label class="btn btn-primary" style="display:inline-block">데이터 파일 불러오기
        <input type="file" id="welcomeImport" accept=".json" hidden></label>
      <button class="btn" data-goto="entry">직접 입력부터 하기</button>
    </div>
  </div>
  <div class="card">
    <h2>아이폰에서 앱처럼 쓰기</h2>
    <ol class="tight">
      <li>사파리에서 이 주소를 엽니다.</li>
      <li>아래 <b>공유</b> 버튼(↑)을 누릅니다.</li>
      <li><b>홈 화면에 추가</b>를 고릅니다.</li>
    </ol>
    <p class="muted" style="margin-top:8px">홈 화면 아이콘으로 열면 주소창 없이 전체화면으로 뜨고, 인터넷이 없어도 열립니다.</p>
  </div>`;
}

function mountWelcome() {
  document.getElementById('welcomeImport').onchange = async (e) => {
    try {
      const r = await importFile(e.target.files[0]);
      toast(`${r.total}건 불러왔습니다.`);
      render();
    } catch (err) { toast(err.message); }
  };
  document.querySelector('[data-goto="entry"]').onclick = () => { state.ui.view = 'entry'; render(); };
}

export function dashboard() {
  const mos = M.months();
  if (!mos.length) return welcome();
  const cur = state.ui.month && mos.includes(state.ui.month) ? state.ui.month : mos[mos.length - 1];
  state.ui.month = cur;
  const totals = M.monthTotals();
  const full = M.fullMonths();
  const avgBase = full.length ? full.slice(-2) : [];
  const avg = (key) => (avgBase.length
    ? avgBase.reduce((s, mo) => s + (totals.get(mo)?.[key] || 0), 0) / avgBase.length : 0);

  const row = totals.get(cur) || { 고정비: 0, 변동비: 0, 일회성: 0, income: 0, incomeMain: 0 };
  const spend = row.고정비 + row.변동비;
  const avgSpend = avg('고정비') + avg('변동비');
  const diff = avgSpend ? spend - avgSpend : 0;
  const rows = M.categoryTotalsFor(cur).filter((r) => r.major !== '일회성');
  const prevMo = mos[mos.indexOf(cur) - 1];
  const prev = prevMo ? new Map(M.categoryTotalsFor(prevMo).map((r) => [r.id, r.amount])) : null;
  const once = M.categoryTotalsFor(cur).filter((r) => r.major === '일회성');

  return `
  <div class="filters">
    <label class="field">기준 달
      <select id="monthPick">${mos.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('')}</select>
    </label>
    <div class="muted" style="flex:2 1 260px">
      평균은 카드 상세가 온전한 달(${avgBase.map(monthLabel).join('·') || '없음'}) 기준입니다.
    </div>
  </div>

  <div class="grid" style="margin-bottom:14px">
    <div class="tile"><div class="label">${monthLabel(cur)} 소비 (일회성 제외)</div>
      <div class="value">${M.won(spend)}</div>
      <div class="sub ${diff > 0 ? 'neg' : 'pos'}">${avgSpend ? `평균 대비 ${diff > 0 ? '+' : ''}${M.manwon(diff)}원` : '비교할 평균 없음'}</div></div>
    <div class="tile"><div class="label">고정비</div><div class="value">${M.won(row.고정비)}</div>
      <div class="sub">대출이자·보험·구독 등</div></div>
    <div class="tile"><div class="label">변동비</div><div class="value">${M.won(row.변동비)}</div>
      <div class="sub">생활 소비</div></div>
    <div class="tile"><div class="label">정기 수입</div><div class="value">${M.won(row.incomeMain)}</div>
      <div class="sub ${row.incomeMain - spend >= 0 ? 'pos' : 'neg'}">남는 돈 ${M.won(row.incomeMain - spend, { sign: true })}</div>
      ${row.income - row.incomeMain ? `<div class="sub">일회성 유입 ${M.manwon(row.income - row.incomeMain)}원 별도</div>` : ''}
      ${row.incomeMain === 0 ? '<div class="sub">아직 이 달 급여가 들어오기 전입니다</div>' : ''}</div>
  </div>

  <div class="card">
    <div class="card-head"><h2>월별 소비와 수입</h2><span class="muted">막대=소비(누적), 선=정기 수입</span></div>
    <div class="chart-box"><canvas id="chartMonthly"></canvas></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>${monthLabel(cur)} 카테고리별 소비</h2>
      <span class="muted">${prevMo ? `괄호는 ${monthLabel(prevMo)} 대비` : ''}</span></div>
    <div class="chart-box tall"><canvas id="chartCategory"></canvas></div>
    <div class="legend">
      <span><i style="background:var(--series-1)"></i>고정비</span>
      <span><i style="background:var(--series-2)"></i>변동비</span>
    </div>
  </div>

  ${once.length ? `<div class="card"><div class="card-head"><h2>${monthLabel(cur)} 일회성 지출</h2>
    <span class="muted">월 평균에서 제외됨</span></div>
    <table><tbody>${once.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${M.won(r.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}

  ${(state.data.notes || []).length ? `<div class="card"><h2>참고</h2>
    <ul class="tight">${state.data.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
  `;
}

function mountDashboard() {
  const mos = M.months();
  if (!mos.length) { mountWelcome(); return; }
  const cur = state.ui.month;
  const totals = M.monthTotals();
  const show = mos.slice(-8);
  monthlyChart(document.getElementById('chartMonthly'), {
    labels: show.map(monthLabel),
    fixed: show.map((m) => totals.get(m)?.고정비 || 0),
    variable: show.map((m) => totals.get(m)?.변동비 || 0),
    income: show.map((m) => totals.get(m)?.incomeMain || 0),
  });
  const rows = M.categoryTotalsFor(cur).filter((r) => r.major !== '일회성');
  const prevMo = mos[mos.indexOf(cur) - 1];
  const prev = prevMo ? new Map(M.categoryTotalsFor(prevMo).map((r) => [r.id, r.amount])) : null;
  categoryChart(document.getElementById('chartCategory'), rows, { compare: prev });
  document.getElementById('monthPick').onchange = (e) => {
    state.ui.month = e.target.value;
    render();
  };
}

/* ================= 거래내역 ================= */
export function transactions() {
  const f = (state.ui.filter ||= { month: '', type: 'expense', q: '', cat: '' });
  const mos = M.months();
  return `
  <div class="filters">
    <label class="field">달
      <select id="fMonth"><option value="">전체</option>
        ${mos.map((m) => `<option value="${m}" ${m === f.month ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="field">종류
      <select id="fType"><option value="">전체</option>
        ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field">카테고리
      <select id="fCat"><option value="">전체</option>${catOptions(f.cat)}</select></label>
    <label class="field">검색
      <input id="fQ" type="search" placeholder="가맹점·적요" value="${esc(f.q)}"></label>
  </div>
  <div class="card"><div id="txTable"></div></div>`;
}

function filteredTx() {
  const f = state.ui.filter;
  return M.visibleTx().filter((t) => (!f.month || t.date.startsWith(f.month))
    && (!f.type || t.type === f.type)
    && (!f.cat || t.categoryId === f.cat)
    && (!f.q || (t.merchant || '').includes(f.q) || (t.memo || '').includes(f.q)))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
}

function txTableHtml() {
  const list = filteredTx();
  const sum = list.filter((t) => t.type === 'expense' && !t.excluded).reduce((s, t) => s + -t.amount, 0);
  const ed = editable();
  const rows = list.slice(0, 400).map((t) => `
    <tr data-id="${t.id}" class="${t.excluded ? 'is-excluded' : ''}">
      <td>${t.date.slice(5)}</td>
      <td>${esc(M.userName(t.owner))}</td>
      <td title="${esc(M.accountName(t.accountId))}">${esc((M.accountName(t.accountId) || '').replace(/\(.*\)/, ''))}</td>
      <td style="white-space:normal;min-width:160px">${esc(t.merchant)}${t.memo ? ` <span class="chip">${esc(t.memo)}</span>` : ''}</td>
      <td class="num ${t.amount > 0 ? 'pos' : ''}">${M.won(-t.amount)}</td>
      <td>${ed ? `<select data-act="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === t.type ? 'selected' : ''}>${v}</option>`).join('')}</select>`
    : esc(TYPES[t.type] || t.type)}</td>
      <td>${ed ? `<select data-act="cat" ${t.type !== 'expense' ? 'disabled' : ''}>${catOptions(t.categoryId)}</select>`
    : (t.type === 'expense' ? esc(M.categoryName(t.categoryId)) : '<span class="muted">-</span>')}</td>
      ${ed ? `<td><input type="checkbox" data-act="excl" ${t.excluded ? 'checked' : ''} title="집계에서 제외"></td>
      <td><button class="btn btn-quiet" data-act="del" title="삭제">✕</button></td>` : `<td>${t.excluded ? '<span class="chip">제외</span>' : ''}</td>`}
    </tr>`).join('');
  return `<div class="card-head"><h2>${list.length}건</h2><span class="muted">소비 합계 ${M.won(sum)}${list.length > 400 ? ' · 최근 400건만 표시' : ''}</span></div>
    ${ed ? '' : lockNote('카테고리·종류')}
    <div class="table-wrap"><table>
      <thead><tr><th>날짜</th><th>사용자</th><th>수단</th><th>내용</th><th class="num">금액</th><th>종류</th><th>카테고리</th>${ed ? '<th>제외</th><th></th>' : '<th></th>'}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function mountTransactions() {
  const draw = () => { document.getElementById('txTable').innerHTML = txTableHtml(); bindRows(); };
  const f = state.ui.filter;
  const on = (id, key, ev = 'change') => {
    const el = document.getElementById(id);
    el.addEventListener(ev, () => { f[key] = el.value; draw(); });
  };
  on('fMonth', 'month'); on('fType', 'type'); on('fCat', 'cat'); on('fQ', 'q', 'input');
  function bindRows() {
    if (!editable()) return;
    document.querySelectorAll('#txTable tbody tr').forEach((tr) => {
      const t = state.data.transactions.find((x) => x.id === tr.dataset.id);
      if (!t) return;
      tr.querySelector('[data-act="cat"]').onchange = (e) => { t.categoryId = e.target.value; touch(); };
      tr.querySelector('[data-act="type"]').onchange = (e) => {
        t.type = e.target.value;
        if (t.type !== 'expense') t.categoryId = null; else t.categoryId ||= M.guessCategory(t.merchant);
        touch(); draw();
      };
      tr.querySelector('[data-act="excl"]').onchange = (e) => { t.excluded = e.target.checked; touch(); draw(); };
      tr.querySelector('[data-act="del"]').onclick = () => {
        if (confirm(`${t.date} ${t.merchant} ${M.won(-t.amount)} 삭제할까요?`)) { removeTransaction(t.id); draw(); }
      };
    });
  }
  draw();
}

/* ================= 수기 입력 ================= */
export function entry() {
  const accounts = state.data.accounts;
  return `
  <div class="card">
    <h2>새 거래 입력</h2>
    <div class="row-2">
      <label class="field">날짜<input type="date" id="eDate" value="${today()}"></label>
      <label class="field">시간(선택)<input type="time" id="eTime"></label>
    </div>
    <label class="field">내용 (가맹점·적요)<input id="eName" placeholder="예: 한살림 철산매장"></label>
    <div class="row-2">
      <label class="field">금액 (지출은 그냥 숫자)<input id="eAmt" type="number" inputmode="numeric" placeholder="예: 34500"></label>
      <label class="field">종류<select id="eType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    </div>
    <div class="row-2">
      <label class="field">사용자<select id="eOwner">${state.data.users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
      <label class="field">수단<select id="eAcct"><option value="">(없음/현금)</option>
        ${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
    </div>
    <label class="field">카테고리<select id="eCat">${catOptions('food_grocery')}</select></label>
    <label class="field">메모<input id="eMemo" placeholder="선택"></label>
    <div class="btn-row"><button class="btn btn-primary" id="eSave">추가</button>
      <span class="muted" id="eHint">지출이면 금액만 넣으면 됩니다. 수입은 종류를 '수입'으로 바꾸세요.</span></div>
  </div>
  <div class="card"><h2>최근에 입력한 것</h2><div id="recentManual"></div></div>

  <div class="card">
    <h2>카드사·은행 파일로 한 번에 넣기</h2>
    <p class="muted">현대카드 이용내역(.xls), 신한카드(.xlsx), 그 밖에 날짜·내용·금액 열이 있는 엑셀/CSV를 읽습니다.
      이미 있는 거래는 자동으로 건너뛰고, 빠진 것·금액이 다른 것을 알려줍니다.</p>
    <div class="btn-row" style="margin-top:10px">
      <input type="file" id="impFile" accept=".xls,.xlsx,.csv" style="max-width:320px">
    </div>
  </div>
  <div id="impResult"></div>`;
}

function mountEntry() {
  const g = (id) => document.getElementById(id);
  g('eName').addEventListener('blur', () => {
    if (g('eType').value === 'expense' && g('eName').value) g('eCat').value = M.guessCategory(g('eName').value);
  });
  const drawRecent = () => {
    const list = state.data.transactions.filter((t) => t.source === 'manual').slice(-10).reverse();
    g('recentManual').innerHTML = list.length
      ? `<div class="table-wrap"><table><tbody>${list.map((t) => `<tr><td>${t.date.slice(5)}</td>
          <td>${esc(t.merchant)}</td><td class="num">${M.won(-t.amount)}</td>
          <td>${esc(M.categoryName(t.categoryId))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">아직 직접 입력한 거래가 없습니다.</p>';
  };
  g('eSave').onclick = () => {
    const amtRaw = Number(g('eAmt').value);
    if (!g('eName').value.trim() || !amtRaw) { toast('내용과 금액을 넣어주세요.'); return; }
    const type = g('eType').value;
    const amount = type === 'income' ? Math.abs(amtRaw) : -Math.abs(amtRaw);
    const { added, dup } = addTransactions([{
      date: g('eDate').value, time: g('eTime').value, merchant: g('eName').value.trim(),
      amount, type, owner: g('eOwner').value, accountId: g('eAcct').value,
      categoryId: type === 'expense' ? g('eCat').value : null,
      memo: g('eMemo').value.trim(), source: 'manual',
    }]);
    if (!added.length && dup.length) { toast('같은 거래가 이미 있습니다.'); return; }
    g('eName').value = ''; g('eAmt').value = ''; g('eMemo').value = '';
    drawRecent();
    toast('추가했습니다.');
  };
  drawRecent();
  mountImport();
}

function mountImport() {
  const out = document.getElementById('impResult');
  document.getElementById('impFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    out.innerHTML = '<div class="card"><p class="muted">읽는 중…</p></div>';
    try {
      const parsed = await parseFile(file);
      const rec = reconcile(parsed);
      out.innerHTML = renderReconcile(parsed, rec);
      bindCardMapping(parsed, rec, out);
    } catch (err) {
      out.innerHTML = `<div class="card"><h2>읽지 못했습니다</h2><p class="neg">${esc(err.message)}</p></div>`;
    }
  };
}

/** 누구 것인지 추측: 등록된 계정 → 파일 이름의 사람 이름 → 카드 표기의 '가족' */
function guessOwner(parsed, card) {
  const acct = state.data.accounts.find((a) => a.id === card.accountId);
  if (acct?.owner) return acct.owner;
  const byName = state.data.users.find((u) => parsed.fileName.includes(u.name));
  if (byName) return byName.id;
  // 파일 이름에 '아내', '와이프' 같은 말이 있으면 두 번째 사용자로 본다
  if (/아내|와이프|집사람|처/.test(parsed.fileName) && state.data.users[1]) return state.data.users[1].id;
  if (/가족/.test(card.cardRaw)) {
    const other = state.data.users.find((u) => u.id !== state.data.users[0].id);
    if (other) return other.id;
  }
  return state.data.users[0].id;
}

/** 파일 이름·카드 표기에서 새 계정 이름을 추측한다 */
function guessAccountName(parsed, card) {
  const brand = parsed.kind === '현대카드' ? '현대카드'
    : parsed.kind === '신한카드' ? '신한카드'
      : (parsed.fileName.match(/신한|국민|우리|하나|농협|기업|카카오|토스|전북|삼성|현대|롯데|비씨/) || ['새 계좌'])[0];
  // 파일 이름에 사용자 이름이 있으면 같이 붙인다 (예: 신한은행_아내.xlsx)
  const person = state.data.users.find((u) => parsed.fileName.includes(u.name));
  const tail = (card.cardRaw.match(/(\d{3,4})\*?\s*$/) || [])[1] || '';
  return `${brand}${person ? `(${person.name})` : ''}${tail ? ` ${tail}` : ''}`.trim();
}

function bindCardMapping(parsed, rec, out) {
  document.querySelectorAll('[data-card]').forEach((tr) => {
    const sel = tr.querySelector('[data-role="acct"]');
    const nameInput = tr.querySelector('[data-role="newname"]');
    const ownerSel = tr.querySelector('[data-role="owner"]');
    sel.onchange = () => {
      const isNew = sel.value === '__new__';
      nameInput.style.display = isNew ? 'block' : 'none';
      if (!isNew) {
        const a = state.data.accounts.find((x) => x.id === sel.value);
        if (a?.owner) ownerSel.value = a.owner;
      }
    };
  });

  document.getElementById('impAdd').onclick = () => {
    // 1) 화면에서 고른 대로 카드 → 계정을 정한다 (새 계정이면 만든다)
    const mapping = new Map();
    let failed = false;
    document.querySelectorAll('[data-card]').forEach((tr) => {
      const i = Number(tr.dataset.card);
      const card = parsed.cards[i];
      const sel = tr.querySelector('[data-role="acct"]');
      const owner = tr.querySelector('[data-role="owner"]').value;
      let accountId = sel.value;
      if (accountId === '__new__') {
        const name = tr.querySelector('[data-role="newname"]').value.trim();
        if (!name) { failed = true; return; }
        accountId = `acct_${Date.now().toString(36)}${i}`;
        const digits = (card.cardRaw.match(/\d{3,}/g) || []);
        state.data.accounts.push({
          id: accountId, name, type: parsed.kind.includes('카드') ? 'card' : 'bank',
          owner, number: card.cardRaw, match: digits.slice(-1),
        });
      }
      mapping.set(card.cardRaw || '', { accountId, owner });
    });
    if (failed) { toast('새로 등록할 카드 이름을 넣어주세요.'); return; }

    // 2) 거래에 반영하고 중복을 다시 확인한 뒤 넣는다
    rec.fresh.forEach((r) => {
      const m = mapping.get(r.cardRaw || '');
      if (m) { r.accountId = m.accountId; r.owner = m.owner; }
    });
    const { added, dup } = addTransactions(rec.fresh);
    toast(`${added.length}건 추가했습니다.`);
    out.innerHTML = `<div class="card"><h2>완료</h2>
      <p>${added.length}건을 가계부에 넣었습니다.${dup.length ? ` (중복 ${dup.length}건은 건너뜀)` : ''}
      <b>저장</b> 버튼을 눌러 공유 폴더 파일에 반영하세요.</p></div>`;
  };
}

function renderReconcile(parsed, rec) {
  const tbl = (rows, cols) => `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  return `
  <div class="card">
    <div class="card-head"><h2>${esc(parsed.kind)} · ${esc(parsed.fileName)}</h2>
      <span class="muted">${rec.range.from} ~ ${rec.range.to}</span></div>
    <div class="grid">
      <div class="tile"><div class="label">새로 추가할 거래</div><div class="value">${rec.fresh.length}건</div>
        <div class="sub">${M.won(rec.fresh.filter((r) => r.amount < 0).reduce((s, r) => s + -r.amount, 0))}</div></div>
      <div class="tile"><div class="label">이미 있는 거래</div><div class="value">${rec.dup.length}건</div><div class="sub">건너뜁니다</div></div>
      <div class="tile"><div class="label">금액이 다른 건</div><div class="value ${rec.mismatched.length ? 'neg' : ''}">${rec.mismatched.length}건</div><div class="sub">확인 필요</div></div>
      <div class="tile"><div class="label">앱에만 있는 거래</div><div class="value ${rec.onlyInApp.length ? 'neg' : ''}">${rec.onlyInApp.length}건</div><div class="sub">직접 입력했거나 파일에 없음</div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>이 파일은 누구 것인가요?</h2>
      <span class="muted">파일에 적힌 카드·계좌 번호로 자동으로 찾습니다</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>파일 속 표기</th><th class="num">건수</th><th class="num">금액</th><th>넣을 곳</th><th>사용자</th></tr></thead>
      <tbody>
      ${parsed.cards.map((c, i) => `
        <tr data-card="${i}">
          <td>${esc(c.cardRaw || '(번호 없음)')}</td>
          <td class="num">${c.count}건</td>
          <td class="num">${M.won(c.amount)}</td>
          <td><select data-role="acct">
            ${state.data.accounts.map((a) => `<option value="${a.id}" ${a.id === c.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            <option value="__new__" ${c.accountId ? '' : 'selected'}>+ 새 카드·계좌로 등록</option>
          </select>
          <input data-role="newname" placeholder="예: 신한카드(아내)" style="display:${c.accountId ? 'none' : 'block'};margin-top:6px"
            value="${esc(c.accountId ? '' : guessAccountName(parsed, c))}"></td>
          <td><select data-role="owner">
            ${state.data.users.map((u) => `<option value="${u.id}" ${u.id === guessOwner(parsed, c) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
          </select></td>
        </tr>`).join('')}
      </tbody></table></div>
    <p class="muted" style="margin-top:8px">새로 등록하면 다음부터는 이 카드가 자동으로 그 사람 것으로 들어갑니다.</p>
    ${rec.note ? `<div class="notice" style="margin-top:12px">${esc(rec.note)}</div>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-primary" id="impAdd" ${rec.fresh.length ? '' : 'disabled'}>${rec.fresh.length}건 가계부에 넣기</button>
    </div>
  </div>

  ${rec.mismatched.length ? `<div class="card"><h2>금액이 다릅니다 — 확인하세요</h2>
    ${tbl(rec.mismatched.map((m) => `<tr><td>${m.app.date.slice(5)}</td><td>${esc(m.app.merchant)}</td>
      <td class="num">${(m.appRows || [m.app]).map((r) => M.won(-r.amount)).join(', ')}</td>
      <td class="num">${(m.fileRows || [m.file]).map((r) => M.won(-r.amount)).join(', ')}</td></tr>`).join(''),
  ['날짜', '내용', '앱', '파일'])}</div>` : ''}

  ${rec.onlyInApp.length ? `<div class="card"><h2>파일에는 없고 앱에만 있는 거래</h2>
    <p class="muted">직접 입력한 거래라면 정상입니다. 아니라면 취소된 건일 수 있습니다.</p>
    ${tbl(rec.onlyInApp.slice(0, 40).map((t) => `<tr><td>${t.date.slice(5)}</td><td>${esc(t.merchant)}</td>
      <td class="num">${M.won(-t.amount)}</td><td>${esc(t.source || '')}</td></tr>`).join(''), ['날짜', '내용', '금액', '출처'])}</div>` : ''}

  ${rec.skipped.length ? `<div class="card"><h2>취소 건 (넣지 않음)</h2>
    ${tbl(rec.skipped.slice(0, 20).map((s) => `<tr><td>${s.date.slice(5)}</td><td>${esc(s.merchant)}</td>
      <td class="num">${M.won(s.amount)}</td><td>${esc(s.reason)}</td></tr>`).join(''), ['날짜', '내용', '금액', '사유'])}</div>` : ''}

  ${rec.fresh.length ? `<div class="card"><h2>새로 들어갈 거래 미리보기</h2>
    ${tbl(rec.fresh.slice(0, 30).map((r) => `<tr><td>${r.date.slice(5)}</td><td>${esc(r.merchant)}</td>
      <td class="num">${M.won(-r.amount)}</td><td>${esc(M.categoryName(r.categoryId))}</td></tr>`).join(''),
  ['날짜', '내용', '금액', '카테고리'])}</div>` : ''}`;
}

/* ================= 투자 ================= */
export function invest() {
  const s = M.investSummary();
  const inv = state.data.investment;
  const g = (k) => s.groups[k] || { principal: 0, value: 0, profit: 0, rate: null };
  const tile = (label, o, sub) => `<div class="tile"><div class="label">${label}</div>
    <div class="value">${M.won(o.value)}</div>
    <div class="sub ${o.profit >= 0 ? 'pos' : 'neg'}">${M.won(o.profit, { sign: true })} (${M.pct(o.rate)}) · 원금 ${M.manwon(o.principal)}원</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  return `
  <div class="grid" style="margin-bottom:14px">
    ${tile('전체', s.total)}
    ${tile('전북은행 (펀드+외화)', g('jeonbuk'))}
    ${s.fund ? tile('└ 펀드', s.fund) : ''}
    ${s.fx ? tile('└ 외화예금', s.fx) : ''}
    ${s.groups.crypto ? tile('비트코인', g('crypto')) : ''}
  </div>

  <div class="card">
    <div class="card-head"><h2>투입 원금 대비 평가금액</h2><span class="muted">평가일 ${esc(inv.valuationDate || '-')}</span></div>
    <div class="chart-box"><canvas id="chartInvest"></canvas></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>보유 자산 — 평가금액</h2>
      ${editable() ? '<button class="btn" id="addHolding">+ 자산 추가</button>' : ''}</div>
    ${editable() ? '' : lockNote('평가금액')}
    <div class="table-wrap"><table>
      <thead><tr><th>자산</th><th>계좌</th><th>구분</th><th class="num">평가금액</th>${editable() ? '<th></th>' : ''}</tr></thead>
      <tbody id="holdBody"></tbody></table></div>
    ${editable() ? '<p class="muted" style="margin-top:8px">평가금액만 바꾸면 위 성과가 바로 다시 계산됩니다.</p>' : ''}
  </div>

  <div class="card">
    <div class="card-head"><h2>원금 입금·출금 내역</h2>
      ${editable() ? '<button class="btn" id="addFlow">+ 내역 추가</button>' : ''}</div>
    <p class="muted">입금은 양수(+), 출금은 음수(−). '원금 반영'을 끄면 계좌 안에서 옮긴 돈으로 보고 원금에서 뺍니다.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>날짜</th><th>내용</th><th>구분</th><th class="num">금액</th><th>원금 반영</th><th>메모</th>${editable() ? '<th></th>' : ''}</tr></thead>
      <tbody id="flowBody"></tbody></table></div>
  </div>

  ${(state.data.otherAssets || []).length ? `<div class="card">
    <div class="card-head"><h2>그 밖의 자산</h2><span class="muted">직접 기록</span></div>
    <div class="table-wrap"><table><thead><tr><th>자산</th><th class="num">평가</th><th class="num">취득·원금</th><th>메모</th></tr></thead>
    <tbody>${state.data.otherAssets.map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${M.won(a.value)}</td>
      <td class="num">${M.won(a.principal)}</td><td>${esc(a.memo || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}

function mountInvest() {
  const inv = state.data.investment;
  const s = M.investSummary();
  const rows = [];
  if (s.fund) rows.push({ name: '펀드', ...s.fund });
  if (s.fx) rows.push({ name: '외화예금', ...s.fx });
  if (s.groups.crypto) rows.push({ name: '비트코인', ...s.groups.crypto });
  investChart(document.getElementById('chartInvest'), rows);

  const groupOpts = (sel) => Object.entries(M.GROUP_NAMES)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

  const drawHold = () => {
    const ed = editable();
    document.getElementById('holdBody').innerHTML = inv.holdings.map((h, i) => (ed ? `
      <tr data-i="${i}">
        <td><input data-f="name" value="${esc(h.name)}" style="min-width:180px"></td>
        <td><input data-f="account" value="${esc(h.account || '')}" style="min-width:120px"></td>
        <td><select data-f="group">${groupOpts(h.group)}</select></td>
        <td class="num"><input data-f="value" type="number" inputmode="numeric" value="${h.value}" style="min-width:120px;text-align:right"></td>
        <td><button class="btn btn-quiet" data-f="del">✕</button></td>
      </tr>` : `
      <tr><td style="white-space:normal;min-width:180px">${esc(h.name)}</td><td>${esc(h.account || '')}</td>
        <td>${esc(M.GROUP_NAMES[h.group] || h.group)}</td><td class="num">${M.won(h.value)}</td></tr>`)).join('');
    if (ed) bind('holdBody', inv.holdings, drawHold);
  };
  const drawFlow = () => {
    const ed = editable();
    const list = [...inv.flows].sort((a, b) => a.date.localeCompare(b.date));
    inv.flows = list;
    document.getElementById('flowBody').innerHTML = list.map((f, i) => (ed ? `
      <tr data-i="${i}">
        <td><input data-f="date" type="date" value="${esc(f.date)}"></td>
        <td><input data-f="memo" value="${esc(f.memo || '')}" style="min-width:150px"></td>
        <td><select data-f="group">${groupOpts(f.group)}</select></td>
        <td class="num"><input data-f="amount" type="number" inputmode="numeric" value="${f.amount}" style="min-width:120px;text-align:right"></td>
        <td><input data-f="include" type="checkbox" ${f.include !== false ? 'checked' : ''}></td>
        <td style="white-space:normal;max-width:220px"><span class="muted">${esc(f.note || '')}</span></td>
        <td><button class="btn btn-quiet" data-f="del">✕</button></td>
      </tr>` : `
      <tr><td>${esc(f.date)}</td><td style="white-space:normal;min-width:150px">${esc(f.memo || '')}</td>
        <td>${esc(M.GROUP_NAMES[f.group] || f.group)}</td>
        <td class="num ${f.amount < 0 ? 'neg' : ''}">${M.won(f.amount, { sign: true })}</td>
        <td>${f.include !== false ? '○' : '<span class="muted">제외</span>'}</td>
        <td style="white-space:normal;max-width:220px"><span class="muted">${esc(f.note || '')}</span></td></tr>`)).join('');
    if (ed) bind('flowBody', inv.flows, drawFlow);
  };
  function bind(bodyId, arr, redraw) {
    document.querySelectorAll(`#${bodyId} tr`).forEach((tr) => {
      const obj = arr[Number(tr.dataset.i)];
      tr.querySelectorAll('[data-f]').forEach((el) => {
        const f = el.dataset.f;
        if (f === 'del') {
          el.onclick = () => { if (confirm('이 줄을 지울까요?')) { arr.splice(Number(tr.dataset.i), 1); touch(); redraw(); refreshInvest(); } };
        } else if (el.type === 'checkbox') {
          el.onchange = () => { obj[f] = el.checked; touch(); refreshInvest(); };
        } else {
          el.onchange = () => {
            obj[f] = el.type === 'number' ? Number(el.value) : el.value;
            touch(); refreshInvest();
          };
        }
      });
    });
  }
  function refreshInvest() {
    const s2 = M.investSummary();
    const rows2 = [];
    if (s2.fund) rows2.push({ name: '펀드', ...s2.fund });
    if (s2.fx) rows2.push({ name: '외화예금', ...s2.fx });
    if (s2.groups.crypto) rows2.push({ name: '비트코인', ...s2.groups.crypto });
    investChart(document.getElementById('chartInvest'), rows2);
    document.querySelectorAll('.grid .tile').forEach((el, i) => {
      const order = [s2.total, s2.groups.jeonbuk, s2.fund, s2.fx, s2.groups.crypto].filter(Boolean);
      const o = order[i];
      if (!o) return;
      el.querySelector('.value').textContent = M.won(o.value);
      const sub = el.querySelector('.sub');
      sub.textContent = `${M.won(o.profit, { sign: true })} (${M.pct(o.rate)}) · 원금 ${M.manwon(o.principal)}원`;
      sub.className = `sub ${o.profit >= 0 ? 'pos' : 'neg'}`;
    });
  }
  if (editable()) document.getElementById('addHolding').onclick = () => {
    inv.holdings.push({ name: '새 자산', account: '', group: 'jeonbuk', value: 0, kind: 'fund' });
    touch(); drawHold(); refreshInvest();
  };
  if (editable()) document.getElementById('addFlow').onclick = () => {
    inv.flows.push({ date: today(), amount: 0, group: 'jeonbuk', include: true, memo: '직접 입력', note: '' });
    touch(); drawFlow(); refreshInvest();
  };
  drawHold(); drawFlow();
}


/* ================= 대출 ================= */
export function loanView() {
  const list = M.visibleLoans();
  if (!list.length) {
    return `<div class="card">
      <h2>등록된 대출이 없습니다</h2>
      <p class="muted">주택담보대출, 신용대출, 전세자금대출 등을 등록하면 이자와 원금이 어떻게 줄어드는지 보여줍니다.</p>
      <div class="btn-row" style="margin-top:12px">
        ${editable() ? '<button class="btn btn-primary" id="addLoan">+ 대출 추가</button>'
    : '<span class="muted">위쪽 <b>편집</b> 버튼을 누르면 추가할 수 있습니다.</span>'}
      </div></div>`;
  }
  const s = M.loanSummary(list);
  const done = s.lastEnd ? s.lastEnd.slice(0, 7).replace('-', '년 ') + '월' : '-';
  return `
  <div class="grid" style="margin-bottom:14px">
    <div class="tile"><div class="label">남은 대출 잔액</div><div class="value">${M.won(s.balance)}</div>
      <div class="sub">처음 ${M.manwon(s.principal)}원 중 ${M.pct(s.paidRatio)} 갚음</div></div>
    <div class="tile"><div class="label">매달 나가는 돈</div><div class="value">${M.won(s.payment)}</div>
      <div class="sub">이자 ${M.manwon(s.interestThisMonth)}원 + 원금 ${M.manwon(s.principalThisMonth)}원</div></div>
    <div class="tile"><div class="label">앞으로 낼 이자</div><div class="value">${M.won(s.remainInterest)}</div>
      <div class="sub">지금 조건 그대로 끝까지 갈 경우</div></div>
    <div class="tile"><div class="label">다 갚는 시점</div><div class="value">${done}</div>
      <div class="sub">남은 기간 약 ${Math.round(M.monthsBetween(new Date().toISOString().slice(0, 10), s.lastEnd) / 12)}년</div></div>
  </div>

  <div class="notice">매달 나가는 ${M.manwon(s.payment)}원 중 <b>원금 ${M.manwon(s.principalThisMonth)}원은 없어지는 돈이 아니라 빚이 줄어드는 부분</b>입니다.
    실제 비용은 이자 ${M.manwon(s.interestThisMonth)}원입니다. (대시보드의 소비에는 실제로 통장에서 나간 전액이 잡힙니다)</div>

  <div class="card" style="margin-top:14px">
    <div class="card-head"><h2>대출 잔액이 줄어드는 모습</h2><span class="muted">지금 조건이 그대로 유지될 경우</span></div>
    <div class="chart-box"><canvas id="chartLoan"></canvas></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>대출 목록</h2>
      ${editable() ? '<button class="btn" id="addLoan">+ 대출 추가</button>' : ''}</div>
    ${editable() ? '' : lockNote('대출 정보')}
    <div class="table-wrap"><table>
      <thead><tr><th>이름</th><th>사용자</th><th class="num">잔액</th><th class="num">금리</th><th>방식</th>
        <th class="num">월 납입</th><th>만기</th>${editable() ? '<th></th>' : ''}</tr></thead>
      <tbody id="loanBody"></tbody></table></div>
    ${editable() ? '<p class="muted" style="margin-top:8px">금리가 바뀌거나 잔액이 달라지면 여기서 고치세요. 아내분 대출도 추가할 수 있습니다.</p>' : ''}
  </div>

  <div class="card">
    <h2>미리 갚으면 얼마나 아낄까</h2>
    <div class="row-2">
      <label class="field">지금 더 갚을 금액
        <input id="prepayAmt" type="number" inputmode="numeric" placeholder="예: 50000000" value="50000000"></label>
      <label class="field">대상 대출
        <select id="prepayLoan">${list.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
    </div>
    <div id="prepayResult"></div>
    <p class="muted" style="margin-top:8px">중도상환수수료는 계산에 넣지 않았습니다. 은행에 남은 수수료율을 확인하세요.
      이 계산은 참고용이며, 상환 여부는 전문가와 상의해 결정하세요.</p>
  </div>

  <div class="card">
    <div class="card-head"><h2>실제 납부 내역</h2><span class="muted">통장에서 빠져나간 기록</span></div>
    <div id="loanPaid"></div>
  </div>`;
}

function mountLoan() {
  const list = M.visibleLoans();
  const addBtn = document.getElementById('addLoan');
  if (addBtn) {
    addBtn.onclick = () => {
      state.data.loans ||= [];
      const today2 = today();
      state.data.loans.push({
        id: `loan_${Date.now().toString(36)}`, name: '새 대출', bank: '', number: '',
        owner: state.data.users[0].id, principal: 0, balance: 0, balanceDate: today2,
        rate: 4, type: 'equal_payment', startDate: today2,
        endDate: `${Number(today2.slice(0, 4)) + 30}${today2.slice(4)}`,
        monthlyPayment: 0, payAccountId: '', memo: '',
      });
      touch(); render();
    };
  }
  if (!list.length) return;

  // 잔액 추이 (연 단위)
  const series = list.map((l) => ({ label: l.name, sch: M.loanSchedule(l) }));
  const maxLen = Math.max(...series.map((s) => s.sch.rows.length));
  const labels = [];
  for (let i = 0; i < maxLen; i += 12) labels.push(series[0].sch.rows[i]?.date.slice(0, 4) || '');
  const sets = series.map((s) => ({
    label: s.label,
    data: labels.map((_, i) => s.sch.rows[i * 12]?.balance ?? 0),
  }));
  loanChart(document.getElementById('chartLoan'), { labels, sets });

  const drawLoans = () => {
    const ed = editable();
    document.getElementById('loanBody').innerHTML = list.map((l, i) => (ed ? `
      <tr data-loan="${i}">
        <td><input data-f="name" value="${esc(l.name)}" style="min-width:150px"></td>
        <td><select data-f="owner">${state.data.users.map((u) => `<option value="${u.id}" ${u.id === l.owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></td>
        <td class="num"><input data-f="balance" type="number" value="${l.balance}" style="min-width:120px;text-align:right"></td>
        <td class="num"><input data-f="rate" type="number" step="0.01" value="${l.rate}" style="min-width:70px;text-align:right"></td>
        <td><select data-f="type">${Object.entries(M.LOAN_TYPES).map(([k, v]) => `<option value="${k}" ${k === l.type ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="num"><input data-f="monthlyPayment" type="number" value="${l.monthlyPayment || ''}" placeholder="비우면 계산" style="min-width:110px;text-align:right"></td>
        <td><input data-f="endDate" type="date" value="${esc(l.endDate)}"></td>
        <td><button class="btn btn-quiet" data-f="del">✕</button></td>
      </tr>` : `
      <tr><td style="white-space:normal;min-width:160px">${esc(l.name)}<div class="muted">${esc(l.bank || '')} ${esc(l.number || '')}</div></td>
        <td>${esc(M.userName(l.owner))}</td>
        <td class="num">${M.won(l.balance)}</td>
        <td class="num">${l.rate}%</td>
        <td>${esc(M.LOAN_TYPES[l.type] || l.type)}</td>
        <td class="num">${M.won(M.loanPayment(l))}</td>
        <td>${esc(l.endDate)}</td></tr>`)).join('');
    if (ed) {
      document.querySelectorAll('[data-loan]').forEach((tr) => {
        const l = list[Number(tr.dataset.loan)];
        tr.querySelectorAll('[data-f]').forEach((el) => {
          const f = el.dataset.f;
          if (f === 'del') {
            el.onclick = () => {
              if (!confirm(`'${l.name}' 대출을 지울까요?`)) return;
              state.data.loans.splice(state.data.loans.indexOf(l), 1);
              touch(); render();
            };
          } else {
            el.onchange = () => {
              l[f] = el.type === 'number' ? Number(el.value) : el.value;
              if (f === 'balance') l.balanceDate = today();
              touch(); render();
            };
          }
        });
      });
    }
  };
  drawLoans();

  // 조기상환 시뮬레이션
  const calcPrepay = () => {
    const amt = Number(document.getElementById('prepayAmt').value) || 0;
    const loan = list.find((l) => l.id === document.getElementById('prepayLoan').value) || list[0];
    const before = M.loanSchedule(loan);
    const after = M.loanSchedule(loan, amt);
    const saveInterest = before.totalInterest - after.totalInterest;
    const saveMonths = before.months - after.months;
    document.getElementById('prepayResult').innerHTML = amt <= 0 ? '' : `
      <div class="grid">
        <div class="tile"><div class="label">아끼는 이자</div><div class="value pos">${M.won(saveInterest)}</div>
          <div class="sub">남은 이자 ${M.manwon(before.totalInterest)} → ${M.manwon(after.totalInterest)}</div></div>
        <div class="tile"><div class="label">빨라지는 기간</div><div class="value">${Math.floor(saveMonths / 12)}년 ${saveMonths % 12}개월</div>
          <div class="sub">${before.endDate.slice(0, 7)} → ${after.endDate.slice(0, 7)}</div></div>
        <div class="tile"><div class="label">갚은 돈 대비</div><div class="value">${M.pct(amt ? saveInterest / amt : 0)}</div>
          <div class="sub">${M.manwon(amt)}원을 갚아 이자 ${M.manwon(saveInterest)}원 절약</div></div>
      </div>`;
  };
  document.getElementById('prepayAmt').addEventListener('input', calcPrepay);
  document.getElementById('prepayLoan').addEventListener('change', calcPrepay);
  calcPrepay();

  // 실제 납부 내역 (거래에서 가져옴)
  const paid = M.visibleTx()
    .filter((t) => t.categoryId === 'loan_interest')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);
  document.getElementById('loanPaid').innerHTML = paid.length
    ? `<div class="table-wrap"><table><thead><tr><th>날짜</th><th>내용</th><th class="num">금액</th></tr></thead>
       <tbody>${paid.map((t) => `<tr><td>${t.date}</td><td>${esc(t.merchant)}</td><td class="num">${M.won(-t.amount)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">통장 내역에서 대출이자로 분류된 거래가 아직 없습니다.</p>';
}


/* ================= 리포트 ================= */
export function reportView() {
  const mos = M.months();
  if (!mos.length) return welcome();
  const cur = state.ui.reportMonth && mos.includes(state.ui.reportMonth)
    ? state.ui.reportMonth : (M.fullMonths().at(-1) || mos.at(-1));
  state.ui.reportMonth = cur;
  const r = M.report(cur);
  const line = (label, value, sub, cls = '') => `<div class="tile"><div class="label">${label}</div>
    <div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  const upDown = (list, positive) => (list.length ? `<div class="table-wrap"><table><tbody>
    ${list.map((c) => `<tr><td>${esc(c.name)}</td>
      <td class="num ${positive ? 'neg' : 'pos'}">${c.diff > 0 ? '+' : ''}${M.manwon(c.diff)}원</td>
      <td class="num muted">${M.manwon(c.now)} / 평균 ${M.manwon(c.avg)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">눈에 띄는 변화가 없습니다.</p>');

  return `
  <div class="filters">
    <label class="field">기준 달
      <select id="reportMonth">${mos.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <div class="muted" style="flex:2 1 240px">비교 기준: ${r.base.join(', ') || '비교할 달 없음'}</div>
  </div>

  <div class="grid" style="margin-bottom:14px">
    ${line('이 달 소비', M.won(r.spend), r.avgSpend ? `평균 대비 ${r.diff >= 0 ? '+' : ''}${M.manwon(r.diff)}원` : '비교 기준 없음', r.diff > 0 ? 'neg' : 'pos')}
    ${line('남는 돈', M.won(r.surplus, { sign: true }), `수입 ${M.manwon(r.income)}원 − 소비 ${M.manwon(r.spend)}원`, r.surplus >= 0 ? 'pos' : 'neg')}
    ${line('수입 대비 고정비', M.pct(r.fixedRatio), `고정비 ${M.manwon(r.fixed)}원`)}
    ${line('순자산', M.won(r.netWorth), `투자·자산 − 대출 ${M.manwon(r.loan.balance)}원`)}
  </div>

  <div class="card">
    <div class="card-head"><h2>이 달에 달라진 것</h2><span class="muted">최근 평균과 비교</span></div>
    <h3>늘어난 항목</h3>
    ${upDown(r.changes.filter((c) => c.diff > 0).slice(0, 5), true)}
    <h3 style="margin-top:14px">줄어든 항목</h3>
    ${upDown(r.changes.filter((c) => c.diff < 0).slice(-5).reverse(), false)}
  </div>

  <div class="card">
    <div class="card-head"><h2>큰 지출</h2><span class="muted">일회성 제외, 상위 5건</span></div>
    ${r.big.length ? `<div class="table-wrap"><table>
      <thead><tr><th>날짜</th><th>내용</th><th>카테고리</th><th class="num">금액</th></tr></thead>
      <tbody>${r.big.map((b) => `<tr><td>${b.date.slice(5)}</td><td>${esc(b.merchant)}</td>
        <td>${esc(b.category)}</td><td class="num">${M.won(b.amount)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">큰 지출이 없습니다.</p>'}
    ${r.once.length ? `<h3 style="margin-top:14px">일회성 지출 (월 평균에서 제외)</h3>
      <div class="table-wrap"><table><tbody>${r.once.map((o) => `<tr><td>${esc(o.name)}</td>
        <td class="num">${M.won(o.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>

  <div class="card">
    <div class="card-head"><h2>매달 빠져나가는 돈</h2>
      <span class="muted">3개월 이상 반복된 결제 · 월 ${M.won(r.recurring.reduce((a, x) => a + x.perMonth, 0))}</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>가맹점</th><th>카테고리</th><th class="num">월 평균</th><th class="num">나타난 달</th></tr></thead>
      <tbody>${r.recurring.map((x) => `<tr><td style="white-space:normal">${esc(x.name)}</td>
        <td>${esc(M.categoryName(x.categoryId))}</td>
        <td class="num">${M.won(x.perMonth)}</td><td class="num">${x.monthCount}개월</td></tr>`).join('')}</tbody></table></div>
    <p class="muted" style="margin-top:8px">안 쓰는 구독이 있는지 확인해보세요.</p>
  </div>

  <div class="card">
    <div class="card-head"><h2>요약</h2>
      <button class="btn" id="copyReport">복사하기</button></div>
    <pre id="reportText" style="white-space:pre-wrap;font:13px/1.7 inherit;background:var(--surface-2);padding:12px;border-radius:9px;margin:0">${esc(M.reportText(r))}</pre>
    <p class="muted" style="margin-top:8px">이 요약을 복사해서 기록해두거나, 더 깊은 분석이 필요할 때 데이터 파일과 함께 보내면 됩니다.</p>
  </div>`;
}

function mountReport() {
  const sel = document.getElementById('reportMonth');
  if (!sel) { mountWelcome(); return; }
  sel.onchange = (e) => { state.ui.reportMonth = e.target.value; render(); };
  document.getElementById('copyReport').onclick = async () => {
    const text = document.getElementById('reportText').textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast('요약을 복사했습니다.');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast('요약을 복사했습니다.');
    }
  };
}

/* ================= 설정 ================= */
export function settings() {
  const d = state.data;
  const KINDS = { bug: '안 되는 것', idea: '이렇게 됐으면', ask: '궁금한 것' };
  const list = d.feedback || [];
  const open = list.filter((f) => f.status !== 'done');
  return `
  <div class="card">
    <div class="card-head"><h2>쓰면서 느낀 점 남기기</h2>
      <span class="muted">${open.length ? `아직 반영 안 된 ${open.length}건` : '모두 반영됨'}</span></div>
    <p class="muted">불편한 점, 있었으면 하는 기능을 적어두세요. 앱을 고칠 때 이 목록을 보고 같이 정리합니다.</p>
    <div class="row-2" style="margin-top:10px">
      <label class="field">누가
        <select id="fbUser">${d.users.map((u) => `<option value="${u.id}" ${u.id === (state.ui.user !== 'all' ? state.ui.user : d.users[0].id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label class="field">무엇
        <select id="fbKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    </div>
    <label class="field">내용
      <textarea id="fbText" rows="3" placeholder="예: 폰에서 카테고리 글자가 잘려요 / 영수증 사진도 붙이고 싶어요"></textarea></label>
    <div class="btn-row">
      <button class="btn btn-primary" id="fbAdd">남기기</button>
      ${list.length ? '<button class="btn" id="fbCopy">전체 복사</button>' : ''}
    </div>
    ${list.length ? `<div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>언제</th><th>누가</th><th>무엇</th><th>내용</th><th>상태</th><th></th></tr></thead>
      <tbody>${list.map((f) => `<tr data-fb="${f.id}" class="${f.status === 'done' ? 'is-excluded' : ''}">
        <td>${esc(f.date.slice(5))}</td>
        <td>${esc(M.userName(f.user))}</td>
        <td><span class="chip">${esc(KINDS[f.kind] || f.kind)}</span></td>
        <td style="white-space:normal;min-width:200px">${esc(f.text)}</td>
        <td><button class="btn btn-quiet" data-fb-act="toggle">${f.status === 'done' ? '되돌리기' : '반영됨'}</button></td>
        <td><button class="btn btn-quiet" data-fb-act="del">✕</button></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
  </div>

  <div class="card">
    <div class="card-head"><h2>구글 드라이브 자동 동기화</h2>
      <span class="muted">${esc(gd.drive.status)}</span></div>
    ${gd.isConfigured() ? `
      <p class="muted">${gd.drive.fileId
    ? `연결된 파일: <b>${esc(gd.drive.fileName || '가계부_데이터.json')}</b> — 고치면 3초 뒤 자동 저장되고, 앱을 열 때 최신 내용을 받아옵니다.`
    : '드라이브에 있는 가계부 파일을 고르면 자동 동기화가 시작됩니다.'}</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary" id="gdConnect">구글 연결</button>
        <button class="btn" id="gdPick">드라이브 파일 고르기</button>
        <button class="btn" id="gdCreate">새 파일 만들기</button>
        ${gd.drive.fileId ? '<button class="btn" id="gdPull">지금 불러오기</button><button class="btn" id="gdPush">지금 저장</button>' : ''}
        ${gd.drive.fileId ? '<button class="btn btn-quiet" id="gdForget">연결 끊기</button>' : ''}
      </div>
      <label class="field" style="margin-top:12px">자동 동기화
        <select id="gdAuto">
          <option value="on" ${state.ui.autoSync !== false ? 'selected' : ''}>켜기 (권장)</option>
          <option value="off" ${state.ui.autoSync === false ? 'selected' : ''}>끄기 — 저장 버튼을 눌렀을 때만</option>
        </select></label>
    ` : `
      <p class="muted">아직 구글 연동 설정이 없습니다. 구글 클라우드 콘솔에서 받은 값을 넣어주세요. (README의 '구글 드라이브 연동' 참고)</p>
      <label class="field">클라이언트 ID<input id="gdClientId" placeholder="1234-abcd.apps.googleusercontent.com"></label>
      <label class="field">API 키<input id="gdApiKey" placeholder="AIzaSy..."></label>
      <div class="btn-row"><button class="btn btn-primary" id="gdSaveCfg">저장하고 연결</button></div>
    `}
  </div>

  <div class="card">
    <h2>데이터 파일</h2>
    <p class="muted">가계 데이터는 JSON 파일 하나로 관리합니다. iCloud나 구글드라이브 공유 폴더에 두면 아내분과 같이 볼 수 있습니다.</p>
    <div class="btn-row" style="margin-top:10px">
      ${canUseFileSystem ? `<button class="btn btn-primary" id="btnConnect">공유 폴더 파일 연결</button>
        <button class="btn" id="btnCreate">새 파일 만들기</button>` : ''}
      <button class="btn" id="btnExport">파일 내보내기</button>
      <label class="btn" style="display:inline-block">파일 가져와 합치기
        <input type="file" id="fileImport" accept=".json" hidden></label>
      <label class="btn" style="display:inline-block">통째로 바꾸기
        <input type="file" id="fileReplace" accept=".json" hidden></label>
    </div>
    <p class="muted" style="margin-top:10px">
      ${canUseFileSystem
    ? '연결해두면 고칠 때마다 2.5초 뒤 자동으로 그 파일에 저장됩니다.'
    : '아이폰에서는 저장을 누르면 공유 창이 열립니다. <b>파일에 저장</b> → 공유 폴더를 고르면 됩니다.'}
    </p>
    <p class="muted">마지막 수정: ${esc(d.updatedAt || '-')} · 거래 ${d.transactions.length}건</p>
  </div>

  <div class="card">
    <h2>새로 시작하기</h2>
    <p class="muted">카드·은행 파일을 처음부터 다시 올리고 싶을 때 씁니다. 지우기 전에 <b>파일 내보내기</b>로 백업해두세요.</p>
    ${editable() ? `<div class="btn-row" style="margin-top:10px">
      <button class="btn" id="resetTx">거래내역만 지우기</button>
      <button class="btn" id="resetAll">전부 지우기</button>
      <button class="btn" id="forgetDev">이 기기의 사본 지우기</button>
    </div>
    <ul class="tight" style="margin-top:10px">
      <li><b>거래내역만 지우기</b> — 계좌·카테고리·대출·투자 설정은 그대로 두고 거래만 비웁니다</li>
      <li><b>전부 지우기</b> — 빈 가계부로 되돌립니다 (카테고리 기준표는 유지)</li>
      <li><b>이 기기의 사본 지우기</b> — 공유 폴더 파일은 그대로 두고, 이 브라우저에 남은 데이터만 지웁니다</li>
    </ul>` : lockNote('데이터 지우기')}
  </div>

  <div class="card">
    <h2>아이폰에서 앱처럼 쓰기</h2>
    <ol class="tight">
      <li>사파리에서 이 주소를 연다</li>
      <li>아래 <b>공유</b> 버튼(↑) → <b>홈 화면에 추가</b></li>
    </ol>
    <p class="muted" style="margin-top:8px">홈 화면 아이콘으로 열면 주소창 없이 전체화면이고, 인터넷이 없어도 열립니다.
      아이폰에서는 <b>저장</b>을 누르면 파일이 내려받아지니, 파일 앱에서 공유 폴더에 덮어쓰세요.</p>
  </div>

  <div class="card">
    <h2>사용자</h2>
    ${editable() ? '' : lockNote('이름과 분류 규칙')}
    <div class="table-wrap"><table><thead><tr><th>이름</th><th>ID</th></tr></thead>
      <tbody>${d.users.map((u) => `<tr><td>${editable() ? `<input data-user="${u.id}" value="${esc(u.name)}">` : esc(u.name)}</td><td class="muted">${u.id}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="card">
    <h2>카테고리와 자동분류 규칙</h2>
    <p class="muted">키워드가 가맹점 이름에 있으면 그 카테고리로 자동 분류합니다. | 로 구분합니다.</p>
    <div class="table-wrap"><table><thead><tr><th>대분류</th><th>카테고리</th><th>키워드</th></tr></thead>
      <tbody>${d.categories.map((c) => `<tr><td>${esc(c.major)}</td><td>${esc(c.name)}</td>
        <td style="white-space:normal">${editable() ? `<input data-cat="${c.id}" value="${esc(c.keywords || '')}" style="min-width:240px">` : `<span class="muted">${esc(c.keywords || '-')}</span>`}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>계좌·카드</h2>
      ${editable() ? '<button class="btn" id="addAccount">+ 추가</button>' : ''}</div>
    <p class="muted">식별번호는 파일에 적힌 카드·계좌 번호의 일부입니다. 이 번호로 <b>누구 것인지 자동 구분</b>합니다.
      쉼표로 여러 개를 넣을 수 있습니다.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>이름</th><th>종류</th><th>사용자</th><th>식별번호</th>${editable() ? '<th></th>' : ''}</tr></thead>
      <tbody>${d.accounts.map((a, i) => (editable() ? `
        <tr data-acct="${i}">
          <td><input data-f="name" value="${esc(a.name)}" style="min-width:150px"></td>
          <td><select data-f="type">${['card', 'bank', 'cash'].map((k) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${k === 'card' ? '카드' : k === 'bank' ? '통장' : '현금'}</option>`).join('')}</select></td>
          <td><select data-f="owner">${d.users.map((u) => `<option value="${u.id}" ${u.id === a.owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></td>
          <td><input data-f="match" value="${esc((a.match || []).join(', '))}" placeholder="예: 1234" style="min-width:120px"></td>
          <td><button class="btn btn-quiet" data-f="del">✕</button></td>
        </tr>` : `
        <tr><td>${esc(a.name)}</td><td>${a.type === 'card' ? '카드' : a.type === 'bank' ? '통장' : '현금'}</td>
          <td>${esc(M.userName(a.owner))}</td><td>${esc((a.match || []).join(', ')) || '<span class="muted">없음</span>'}</td></tr>`)).join('')}
      </tbody>
    </table></div>
  </div>`;
}

function mountSettings() {
  const g = (id) => document.getElementById(id);
  const merge = (incoming) => applyIncoming(incoming, { mode: 'merge' });
  const wrap = (fn) => async () => {
    try { await fn(); render(); } catch (e) { toast(e.message); }
  };

  if (g('gdSaveCfg')) {
    g('gdSaveCfg').onclick = () => {
      const cfg = { googleClientId: g('gdClientId').value.trim(), googleApiKey: g('gdApiKey').value.trim() };
      if (!cfg.googleClientId || !cfg.googleApiKey) { toast('두 값을 모두 넣어주세요.'); return; }
      try { localStorage.setItem('budget.gdrive.config', JSON.stringify(cfg)); } catch { /* 무시 */ }
      toast('저장했습니다. 화면을 새로고침합니다.');
      setTimeout(() => location.reload(), 800);
    };
  }
  if (g('gdConnect')) {
    g('gdConnect').onclick = wrap(async () => { await gd.connect(); toast('구글에 연결했습니다.'); });
    g('gdPick').onclick = wrap(async () => {
      const f = await gd.pickFile();
      if (!f) return;
      const r = await gd.pull({ merge });
      toast(`${f.name} 연결됨. 새 거래 ${r.added || 0}건 받았습니다.`);
    });
    g('gdCreate').onclick = wrap(async () => {
      const f = await gd.createFile();
      toast(`드라이브에 ${f.name}을 만들었습니다.`);
    });
    if (g('gdPull')) g('gdPull').onclick = wrap(async () => {
      const r = await gd.pull({ merge });
      toast(r.added ? `새 거래 ${r.added}건을 받았습니다.` : '이미 최신입니다.');
    });
    if (g('gdPush')) g('gdPush').onclick = wrap(async () => {
      await gd.push({ merge });
      toast('드라이브에 저장했습니다.');
    });
    if (g('gdForget')) g('gdForget').onclick = wrap(async () => {
      gd.signOut();
      try { localStorage.removeItem('budget.gdrive.file'); } catch { /* 무시 */ }
      gd.drive.fileId = null;
      toast('연결을 끊었습니다.');
    });
    if (g('gdAuto')) g('gdAuto').onchange = (e) => {
      state.ui.autoSync = e.target.value === 'on';
      saveUIState();
      toast(state.ui.autoSync ? '자동 동기화를 켰습니다.' : '자동 동기화를 껐습니다.');
    };
  }


  // 피드백은 보기 모드에서도 남길 수 있다
  g('fbAdd').onclick = () => {
    const text = g('fbText').value.trim();
    if (!text) { toast('내용을 적어주세요.'); return; }
    addFeedback({ text, kind: g('fbKind').value, user: g('fbUser').value });
    g('fbText').value = '';
    toast('남겼습니다. 저장 버튼을 눌러 공유 폴더에 반영하세요.');
    render();
  };
  const fbCopy = g('fbCopy');
  if (fbCopy) {
    fbCopy.onclick = async () => {
      const KINDS = { bug: '안 되는 것', idea: '이렇게 됐으면', ask: '궁금한 것' };
      const text = (state.data.feedback || [])
        .map((f) => `[${f.status === 'done' ? '반영됨' : '대기'}] ${f.date} ${M.userName(f.user)} (${KINDS[f.kind] || f.kind}): ${f.text}`)
        .join('\n');
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      toast('피드백을 복사했습니다.');
    };
  }
  document.querySelectorAll('[data-fb]').forEach((tr) => {
    const id = tr.dataset.fb;
    tr.querySelector('[data-fb-act="toggle"]').onclick = () => {
      const f = state.data.feedback.find((x) => x.id === id);
      updateFeedback(id, { status: f.status === 'done' ? 'open' : 'done' });
      render();
    };
    tr.querySelector('[data-fb-act="del"]').onclick = () => {
      if (confirm('이 피드백을 지울까요?')) { removeFeedback(id); render(); }
    };
  });

  if (canUseFileSystem) {
    g('btnConnect').onclick = async () => {
      try { toast(`${await connectFile()} 연결됨`); render(); } catch (e) { toast(e.message); }
    };
    g('btnCreate').onclick = async () => {
      try { toast(`${await connectFile({ create: true })} 만들었습니다`); render(); } catch (e) { toast(e.message); }
    };
  }
  g('btnExport').onclick = async () => {
    const how = await exportFile();
    toast(how === 'share' ? '공유 창에서 "파일에 저장"을 고르세요.' : '내보냈습니다.');
  };
  g('fileImport').onchange = async (e) => {
    try {
      const r = await importFile(e.target.files[0]);
      toast(r.added || r.updated
        ? `합쳤습니다. 새 거래 ${r.added}건${r.updated ? `, 분류 수정 ${r.updated}건` : ''} (전체 ${r.total}건)`
        : `새로 들어온 거래가 없습니다. (전체 ${r.total}건)`);
      render();
    } catch (err) { toast(err.message); }
  };
  g('fileReplace').onchange = async (e) => {
    if (!confirm('지금 기기에 있는 내용을 버리고 파일 내용으로 통째로 바꿉니다.\n계속할까요?')) {
      e.target.value = ''; return;
    }
    try {
      const r = await importFile(e.target.files[0], { mode: 'replace' });
      toast(`${r.total}건으로 바꿨습니다.`);
      render();
    } catch (err) { toast(err.message); }
  };
  const resetTx = document.getElementById('resetTx');
  if (resetTx) {
    resetTx.onclick = () => {
      const n = state.data.transactions.length;
      if (!confirm(`거래 ${n}건을 모두 지웁니다. 계좌·카테고리·대출·투자 설정은 남습니다.\n계속할까요?`)) return;
      resetData({ transactions: true });
      toast('거래내역을 비웠습니다.');
      render();
    };
    document.getElementById('resetAll').onclick = () => {
      if (!confirm('거래·투자·대출을 모두 지우고 빈 가계부로 되돌립니다.\n되돌릴 수 없습니다. 계속할까요?')) return;
      if (!confirm('정말 전부 지울까요? 백업 파일이 있는지 다시 확인하세요.')) return;
      resetData({ transactions: true, investment: true, loans: true });
      toast('빈 가계부로 되돌렸습니다.');
      render();
    };
    document.getElementById('forgetDev').onclick = async () => {
      if (!confirm('이 기기에 남은 사본을 지웁니다. 공유 폴더의 파일은 그대로입니다.\n계속할까요?')) return;
      await forgetDevice();
      toast('이 기기의 사본을 지웠습니다. 새로고침하면 파일을 다시 불러옵니다.');
    };
  }

  document.querySelectorAll('[data-user]').forEach((el) => {
    el.onchange = () => {
      state.data.users.find((u) => u.id === el.dataset.user).name = el.value;
      touch(); renderUserSwitch();
    };
  });
  document.querySelectorAll('[data-cat]').forEach((el) => {
    el.onchange = () => {
      state.data.categories.find((c) => c.id === el.dataset.cat).keywords = el.value;
      touch();
    };
  });

  if (editable()) {
    document.querySelectorAll('[data-acct]').forEach((tr) => {
      const a = state.data.accounts[Number(tr.dataset.acct)];
      tr.querySelectorAll('[data-f]').forEach((el) => {
        const f = el.dataset.f;
        if (f === 'del') {
          el.onclick = () => {
            const used = state.data.transactions.filter((t2) => t2.accountId === a.id).length;
            if (used && !confirm(`이 계좌·카드로 기록된 거래가 ${used}건 있습니다. 그래도 지울까요?`)) return;
            state.data.accounts.splice(Number(tr.dataset.acct), 1);
            touch(); render();
          };
        } else {
          el.onchange = () => {
            a[f] = f === 'match'
              ? el.value.split(',').map((x) => x.trim()).filter(Boolean)
              : el.value;
            touch();
          };
        }
      });
    });
    const add = document.getElementById('addAccount');
    if (add) add.onclick = () => {
      state.data.accounts.push({
        id: `acct_${Date.now().toString(36)}`, name: '새 카드', type: 'card',
        owner: state.data.users[0].id, number: '', match: [],
      });
      touch(); render();
    };
  }
}

/* ================= 라우팅 ================= */
const VIEWS = {
  dashboard: [dashboard, mountDashboard],
  transactions: [transactions, mountTransactions],
  entry: [entry, mountEntry],
  invest: [invest, mountInvest],
  loan: [loanView, mountLoan],
  report: [reportView, mountReport],
  settings: [settings, mountSettings],
};

export function render() {
  const [html, mount] = VIEWS[state.ui.view] || VIEWS.dashboard;
  const app = document.getElementById('app');
  app.innerHTML = html();
  mount?.();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.ui.view));
}

export function renderUserSwitch() {
  const el = document.getElementById('userSwitch');
  const opts = [{ id: 'all', name: '통합' }, ...state.data.users];
  el.innerHTML = opts.map((u) => `<button data-user="${u.id}" class="${state.ui.user === u.id ? 'is-active' : ''}">${esc(u.name)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { state.ui.user = b.dataset.user; renderUserSwitch(); render(); };
  });
}

export { save };
