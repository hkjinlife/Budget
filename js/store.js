// 데이터 보관·저장 담당.
// 우선순위: (1) 연결된 공유 폴더 파일 → (2) 브라우저에 남은 마지막 데이터 → (3) 기본 데이터 파일
const LS_KEY = 'budget.data.v1';
const LS_UI = 'budget.ui.v1';
const IDB_DB = 'budget-app';
const IDB_STORE = 'handles';

// 새로 시작하는 가족을 위한 기본 카테고리와 자동분류 키워드
export const DEFAULT_CATEGORIES = [
 {
  "id": "loan_interest",
  "name": "대출이자",
  "major": "고정비",
  "keywords": "대출이자"
 },
 {
  "id": "insurance",
  "name": "보험",
  "major": "고정비",
  "keywords": "손해보험|화재|METLIFE|삼성생명|DB손보|현대해상환급|메리츠|예별"
 },
 {
  "id": "telecom",
  "name": "통신비",
  "major": "고정비",
  "keywords": "SKT|SK브로드밴드|우주패스"
 },
 {
  "id": "subscription",
  "name": "정기구독·디지털",
  "major": "고정비",
  "keywords": "ANTHROPIC|MICROSOFT|DROPBOX|구글플레이|A1891|애플코리아|와우멤버십|코스트코연회비|LG전자구독료|한국교육방송|엘지전자_CNSPay|Disney|디즈니|넷플릭스|NETFLIX|유튜브|YOUTUBE|구글페이먼트|한글과컴퓨터|한컴|CLEVERBRIDGE|쿠팡플레이|티빙|웨이브|왓챠|멜론|스포티파이|SPOTIFY|APPLE\\.COM|ICLOUD|OPENAI|CHATGPT|NOTION|ADOBE"
 },
 {
  "id": "housing",
  "name": "주거·관리비",
  "major": "고정비",
  "keywords": "아파트관리비|도시가스"
 },
 {
  "id": "food_grocery",
  "name": "식비-장보기",
  "major": "변동비",
  "keywords": "한살림|더프레시|코스트코코리아|코스트코_온라인|공판장|푸메|푸드마켓|미가마트|축산|정육|하나로|이마트|홈플러스|롯데마트|과일|야채|채소|반찬|수산|농산|식자재|오아시스마켓|마켓컬리|컬리"
 },
 {
  "id": "food_dining",
  "name": "식비-외식·배달",
  "major": "변동비",
  "keywords": "쿠팡이츠|파파존스|김밥|순대|마라탕|현대옥|양와당|서향|여의나룻|섹타나인|캘리포니아|웰스토리|휴게소|돌구이|숯불|구이|갈비|삼겹|고기|국밥|해장|냉면|막국수|칼국수|짬뽕|짜장|반점|초밥|스시|라멘|우동|돈까스|돈가스|카레|치킨|피자|버거|떡볶이|분식|족발|보쌈|곱창|막창|샤브|쌀국수|타이|파스타|레스토랑|식당|포차|맥주|이자카야|덮밥|솥|돼지집|한우|회센터|횟집|아라도|피카소|푸드솔루션|배민|배달의민족|요기요|국수|샐러디|맥도날드|써브웨이|풀무원푸드|롯데리아|KFC|맘스터치|버거킹|본죽|죽이야기|한솥|도시락|푸드코트|푸드앤컬처"
 },
 {
  "id": "food_cafe",
  "name": "식비-카페·간식·편의점",
  "major": "변동비",
  "keywords": "로스터리|카페|커피|베이커리|제빵소|파티세리|빵|꽈배기|아마스빈|매머드|메가엠지씨|컴포즈|스타벅스|테라로사|파리바게뜨|배스킨|GS25|CU|씨유|세븐일레븐|미츠비|아티제|보나비아|스프링가든|쿠키|도넛|케이크|디저트|할리스|투썸|이디야|빽다방|폴바셋|커피빈|블루보틀|제과|과자|공차|오가다|망고식스|떡방|브레드|설빙|던킨|크리스피"
 },
 {
  "id": "car_charge",
  "name": "자동차-충전비",
  "major": "변동비",
  "keywords": "충전|볼트업|채비|파워큐브|이지차저|차저|에버온|차지비|환경부|일렉링크|자동차환경협회"
 },
 {
  "id": "car_run",
  "name": "자동차-주유·통행료·주차",
  "major": "변동비",
  "keywords": "주유소|도로|하이웨이|주차|이도밸류|타이어|카센터|정비|세차|오토오아시스|스피드메이트|블루핸즈|주차장"
 },
 {
  "id": "transit",
  "name": "교통-대중교통·택시",
  "major": "변동비",
  "keywords": "택시|철도|버스|티머니|카카오모빌리티|코레일|SRT|에스알|고속버스|시외버스"
 },
 {
  "id": "shopping",
  "name": "생활용품·쇼핑",
  "major": "변동비",
  "keywords": "쿠팡|11번가|네이버페이$|다이소|올리브영|이케아|무인양품|더현대|현대백화점|롯데몰|신세계|유원티앤지|뷰티원|다이아몬드|가우플랜|KIS|쌤소나이트|에이치앤앰|H&M|유니클로|자라|ZARA|마리오쇼핑|알리바바|ALIBABA|ALIEXPRESS|알리익스프레스|테무|TEMU|무신사|지그재그|에이블리|29CM|오늘의집|경동나비엔|앳홈|헤리티지|비앤앤|그린리본|에이폴|아울렛|백화점|면세"
 },
 {
  "id": "medical",
  "name": "의료·약국",
  "major": "변동비",
  "keywords": "병원|의원|약국|의료기|치과|소아과|내과|외과|안과|피부과|이비인후과|한의원|의료|메디|클리닉"
 },
 {
  "id": "kids",
  "name": "육아·교육",
  "major": "변동비",
  "keywords": "식판|어린이집|유치원|학원|월드패밀리|잉글리쉬|키즈|아동|유아|학습지|튼튼영어|눈높이|구몬|장난감|토이"
 },
 {
  "id": "leisure",
  "name": "여가·문화",
  "major": "변동비",
  "keywords": "서울랜드|시네마|교보문고|도서공연|노래|오락실|문화비|컬처닷컴|서적|문고|책방|몬스터파크|문화예술|공연|티켓|국가유산|박물관|미술관|키즈카페|수영|헬스|필라테스|요가|볼링|골프|아트센터|놀이터|전시|동물원|아쿠아리움"
 },
 {
  "id": "travel",
  "name": "여행",
  "major": "변동비",
  "keywords": "제주항공|드림투어|에스엠지티|항공|호텔|HOTEL|아고다|AGODA|BOOKING|부킹|에어비앤비|AIRBNB|대한항공|아시아나|진에어|티웨이|에어부산|제주국제자유도시|여기어때|야놀자|리조트|펜션"
 },
 {
  "id": "tax",
  "name": "세금·공과금",
  "major": "변동비",
  "keywords": "지자체세입금|정부24|세외수입|세금납부|유성구|경찰청"
 },
 {
  "id": "dues",
  "name": "회비·기부",
  "major": "변동비",
  "keywords": "학회"
 },
 {
  "id": "pay_unknown",
  "name": "간편결제(상세없음)",
  "major": "변동비",
  "keywords": "카카오페이|지역화폐"
 },
 {
  "id": "card_unknown",
  "name": "카드결제(상세없음)",
  "major": "변동비",
  "keywords": "^삼성카드$"
 },
 {
  "id": "beauty",
  "name": "미용",
  "major": "변동비",
  "keywords": "헤어|미용|네일|바버|맨즈룸|왁싱|피부관리|에스테틱"
 },
 {
  "id": "etc",
  "name": "기타",
  "major": "변동비",
  "keywords": ""
 },
 {
  "id": "car_buy",
  "name": "차량구매",
  "major": "일회성",
  "keywords": "아주오토|볼보|테슬라"
 },
 {
  "id": "once_big",
  "name": "일회성 큰 지출",
  "major": "일회성",
  "keywords": ""
 },
 {
  "id": "tax_big",
  "name": "세금(대형·일회성)",
  "major": "일회성",
  "keywords": ""
 }
];

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
    accounts: [], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), transactions: [],
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
  d.monthly ||= {};
  d.otherAssets ||= [];
  // 한 번만 있는 큰 지출(가전·수리 등)을 모으는 카테고리. 예전 데이터에도 넣어준다
  if (d.categories.length && !d.categories.some((c) => c.id === 'once_big')) {
    d.categories.push({ id: 'once_big', name: '일회성 큰 지출', major: '일회성', keywords: '' });
  }
  // 예전 자료에서 같은 날 같은 거래 여러 건(예: 연금저축 10만원 ×4)이 같은 id를 받은 경우가 있다.
  // 기기마다 같은 결과가 나오도록 두 번째부터 순서대로 _2, _3을 붙인다.
  const ids = new Set();
  d.transactions.forEach((t) => {
    t.type ||= 'expense';
    let id = t.id;
    for (let n = 2; ids.has(id); n++) id = `${t.id}_${n}`;
    t.id = id;
    ids.add(id);
  });
}

export function today() { return new Date().toISOString().slice(0, 10); }

export function latestMonth() {
  const ms = state.data.transactions.map((t) => t.date.slice(0, 7)).sort();
  return ms.length ? ms[ms.length - 1] : today().slice(0, 7);
}

/* ---------- 저장 ---------- */
let autoSaveTimer = null;

/** 고친 내용을 저장한다. stamp를 주면 저장 시각을 그 값으로 둔다 (합치기만 한 경우) */
export function touch({ stamp } = {}) {
  state.dirty = true;
  state.data.updatedAt = stamp || new Date().toISOString().slice(0, 19);
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
  // 사용자가 직접 고른 파일은 그 파일의 설정·분류를 따른다 (드라이브 자동 동기화는 시각으로 판단)
  return applyIncoming(incoming, { mode, preferIncoming: true });
}

/** 거래 하나를 고쳤다고 표시한다. 합칠 때 거래마다 더 최근에 고친 쪽을 따른다 */
export function markEdited(t) {
  t.mt = new Date().toISOString().slice(0, 19);
}

/** 설정 목록(카테고리·계좌)을 id로 합친다. 한쪽에만 있는 것은 살리고, 같은 것은 더 최근 파일 것을 쓰되
 *  카테고리 키워드와 계좌의 카드번호는 양쪽 것을 모두 남긴다 (한 기기에서 더한 것이 사라지지 않게) */
function mergeList(mineList = [], theirList = [], newer, field) {
  const out = mineList.map((x) => ({ ...x }));
  const byId = new Map(out.map((x) => [x.id, x]));
  theirList.forEach((x) => {
    const cur = byId.get(x.id);
    if (!cur) { out.push({ ...x }); return; }
    let both;
    if (field === 'keywords') {
      const a = cur.keywords || '';
      const b = x.keywords || '';
      // 괄호가 있는 정규식은 '|'로 나누면 깨지므로 합치지 않는다
      both = /[()]/.test(a + b) ? (newer ? b : a)
        : [...new Set([...a.split('|'), ...b.split('|')].filter(Boolean))].join('|');
    } else {
      both = [...new Set([...(cur.match || []), ...(x.match || [])])];
    }
    if (newer) Object.assign(cur, x);
    cur[field] = both;
  });
  return out;
}

/** 다른 기기/드라이브에서 온 데이터를 지금 데이터와 합친다 */
export function applyIncoming(incoming, { mode = 'merge', preferIncoming = false } = {}) {
  if (!incoming || !incoming.transactions) throw new Error('가계부 데이터가 아닙니다.');

  if (mode === 'replace' || !state.data?.transactions?.length) {
    state.data = incoming;
    normalize(state.data);
    touch();
    return { mode: 'replace', total: incoming.transactions.length, added: 0, updated: 0 };
  }

  // 합치기: 양쪽에만 있는 거래를 모두 살린다
  const mine = state.data;
  normalize(incoming);                 // 겹친 id를 이 기기와 같은 규칙으로 정리
  const newer = preferIncoming || (incoming.updatedAt || '') > (mine.updatedAt || '');
  let added = 0;
  let updated = 0;
  const used = new Set();
  const take = (same, t) => {
    used.add(same);
    // 같은 거래라면 더 최근에 고친 쪽의 분류·메모를 따른다. 고친 시각이 양쪽 다 없으면 더 최근 파일 쪽.
    const theirs = t.mt || '';
    const ours = same.mt || '';
    const useTheirs = (theirs || ours) ? theirs > ours : newer;
    if (!useTheirs) return;
    if (same.categoryId !== t.categoryId || same.type !== t.type
      || !!same.excluded !== !!t.excluded || (same.memo || '') !== (t.memo || '')) {
      Object.assign(same, { categoryId: t.categoryId, type: t.type, excluded: t.excluded, memo: t.memo });
      if (t.mt) same.mt = t.mt;
      updated += 1;
    }
  };
  const byId = new Map(mine.transactions.map((t) => [t.id, t]));
  const noId = [];
  incoming.transactions.forEach((t) => {
    const same = byId.get(t.id);
    if (!same) noId.push(t);
    else if (!used.has(same)) take(same, t);
  });
  // id가 다르면 날짜·계정·가맹점·금액으로 짝짓는다. 같은 날 같은 거래가 여러 건일 수 있어(놀이기구 표 3장 등) 건수까지 맞춘다.
  const pool = new Map();
  mine.transactions.forEach((t) => {
    if (used.has(t)) return;
    const k = dedupKey(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(t);
  });
  noId.forEach((t) => {
    const same = pool.get(dedupKey(t))?.shift();
    if (same) { take(same, t); return; }
    mine.transactions.push(t);
    added += 1;
  });
  mine.transactions.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  // 피드백도 합친다. '반영됨'은 한쪽이라도 표시했으면 반영된 것으로 본다.
  const fbById = new Map((mine.feedback || []).map((f) => [f.id, f]));
  (incoming.feedback || []).forEach((f) => {
    const cur = fbById.get(f.id);
    if (!cur) { mine.feedback.unshift(f); fbById.set(f.id, f); return; }
    if (f.status === 'done' && cur.status !== 'done') Object.assign(cur, { status: 'done', note: f.note || cur.note });
  });
  mine.feedback.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 월말 정리 기록은 달·항목별로 합친다 (한쪽이라도 끝냈으면 끝낸 것으로)
  if (incoming.monthly) {
    mine.monthly ||= {};
    Object.entries(incoming.monthly).forEach(([mo, items]) => {
      mine.monthly[mo] ||= {};
      Object.entries(items).forEach(([id, st]) => {
        const cur = mine.monthly[mo][id];
        if (!cur || (st.done && !cur.done) || (st.at || '') > (cur.at || '')) mine.monthly[mo][id] = st;
      });
    });
  }

  // 카테고리·계좌는 id로 합친다 (새로 생긴 것, 더한 키워드·카드번호는 어느 쪽이든 살린다)
  mine.categories = mergeList(mine.categories, incoming.categories, newer, 'keywords');
  mine.accounts = mergeList(mine.accounts, incoming.accounts, newer, 'match');
  // 나머지 설정(사용자·대출·자산·투자)은 더 최근에 저장된 파일 것을 쓴다
  if (newer) {
    ['users', 'loans', 'otherAssets', 'budgets', 'checklist'].forEach((k) => {
      if (incoming[k]) mine[k] = incoming[k];
    });
    if (incoming.investment) mine.investment = incoming.investment;
  }
  normalize(mine);
  // 합치기만 한 것은 '고친 것'이 아니다. 저장 시각을 지금으로 올리면 이 기기가 늘 더 최신으로 보여
  // 다른 기기에서 고친 설정이 무시되므로, 두 쪽 중 늦은 시각을 쓴다.
  touch({ stamp: [mine.updatedAt || '', incoming.updatedAt || ''].sort().pop() });
  return { mode: 'merge', total: mine.transactions.length, added, updated, newer };
}

/* ---------- 거래 추가/수정 ---------- */
export function dedupKey(t) {
  return [t.date, t.accountId || '', (t.merchant || '').replace(/\s+/g, ''), t.amount].join('|');
}

export function existingKeys() {
  return new Set(state.data.transactions.map(dedupKey));
}

/** checked: reconcile로 이미 건수까지 중복을 가려낸 목록 — 같은 날 같은 거래가 여러 건이어도 모두 넣는다 */
export function addTransactions(list, { checked = false } = {}) {
  const seen = checked ? null : existingKeys();
  const added = [];
  const dup = [];
  list.forEach((t) => {
    if (seen) {
      const k = dedupKey(t);
      if (seen.has(k)) { dup.push(t); return; }
      seen.add(k);
    }
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
