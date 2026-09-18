// 앱 시작점: 데이터 불러오기 → 화면 그리기 → 탭·편집·저장 버튼 연결
import { state, boot, onChange, save, saveUI, applyIncoming } from './store.js';
import { render, renderUserSwitch, toast } from './views.js';
import * as gd from './gdrive.js';

const saveState = document.getElementById('saveState');
const editBtn = document.getElementById('editBtn');

function paintSaveState() {
  if (gd.drive.busy) {
    saveState.textContent = gd.drive.status;
    saveState.className = 'save-state';
    return;
  }
  if (state.dirty) {
    saveState.textContent = '저장 안 됨';
    saveState.className = 'save-state dirty';
  } else if (gd.drive.fileId) {
    saveState.textContent = '구글 드라이브에 저장됨';
    saveState.className = 'save-state saved';
  } else {
    saveState.textContent = state.fileHandle ? '공유 폴더 파일에 저장됨' : '브라우저에 임시 저장됨';
    saveState.className = 'save-state saved';
  }
}

/* ---------- 구글 드라이브 자동 동기화 ---------- */
const mergeIncoming = (incoming) => applyIncoming(incoming, { mode: 'merge' });
let pushTimer = null;

function scheduleDrivePush() {
  if (!gd.drive.fileId || state.ui.autoSync === false) return;
  if (gd.needsLogin()) { paintSyncBtn(); return; }      // 로그인이 풀렸으면 버튼만 보여주고 기다린다
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    gd.push({ merge: mergeIncoming, interactive: false })
      .then(render)
      .catch((e) => { if (e.name === 'NeedLogin') paintSyncBtn(); else toast(`드라이브 저장 실패: ${e.message}`); });
  }, 3000);
}

/** 구글 권한이 풀렸을 때만 위쪽에 '동기화' 버튼을 보여준다 */
const syncBtn = document.getElementById('syncBtn');
function paintSyncBtn() {
  if (!syncBtn) return;
  const need = gd.isConfigured() && gd.needsLogin();
  syncBtn.hidden = !need;
  syncBtn.textContent = state.dirty ? '↻ 동기화 (저장할 것 있음)' : '↻ 동기화';
}

async function syncNow() {
  // 버튼을 누른 직후라 로그인 창이 막히지 않는다. 한 번 허용했으면 창이 잠깐 떴다 닫힌다.
  const r = await gd.pull({ merge: mergeIncoming, interactive: true });
  if (state.dirty) await gd.push({ merge: mergeIncoming, interactive: true });
  state.dirty = false;
  paintSyncBtn();
  render();
  toast(r?.added ? `동기화했습니다. 새 거래 ${r.added}건` : '동기화했습니다.');
}

async function driveStart() {
  gd.preload();
  if (!gd.isConfigured() || !gd.restoreFile()) return;
  if (gd.needsLogin()) {        // 1시간이 지나 권한이 풀림 → 자동으로 창을 띄우지 않고 버튼만 보여준다
    paintSyncBtn();
    return;
  }
  try {
    const r = await gd.pull({ merge: mergeIncoming, interactive: false });
    if (r?.added) toast(`드라이브에서 새 거래 ${r.added}건을 받았습니다.`);
    state.dirty = false;
    render();
  } catch (e) {
    paintSyncBtn();
  }
}

function paintEditBtn() {
  const on = !!state.ui.edit;
  editBtn.textContent = on ? '편집 끝내기' : '편집';
  editBtn.classList.toggle('btn-primary', on);
  editBtn.classList.toggle('btn-quiet', !on);
  editBtn.setAttribute('aria-pressed', String(on));
}

async function start() {
  if (typeof Chart === 'undefined') {
    await new Promise((res) => {
      const t = setInterval(() => { if (typeof Chart !== 'undefined') { clearInterval(t); res(); } }, 50);
      setTimeout(() => { clearInterval(t); res(); }, 4000);
    });
  }
  await boot();
  state.ui.edit = false;          // 열 때는 항상 보기 모드
  onChange(paintSaveState);
  onChange(() => { if (state.dirty) scheduleDrivePush(); });
  gd.onDriveChange(paintSaveState);
  gd.onDriveChange(paintSyncBtn);
  onChange(paintSyncBtn);
  if (syncBtn) syncBtn.onclick = () => syncNow().catch((e) => toast(e.message));
  renderUserSwitch();
  render();
  paintSaveState();
  paintEditBtn();

  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    state.ui.view = b.dataset.view;
    state.ui.fromDash = false;
    saveUI();
    render();
  });

  editBtn.onclick = () => {
    state.ui.edit = !state.ui.edit;
    paintEditBtn();
    render();
    if (state.ui.edit) toast('편집 모드입니다. 내역을 고칠 수 있습니다.');
  };

  document.getElementById('saveBtn').onclick = async () => {
    try {
      if (gd.drive.fileId) {
        clearTimeout(pushTimer);
        await gd.push({ merge: mergeIncoming, interactive: true });
        paintSyncBtn();
        toast('구글 드라이브에 저장했습니다.');
        render();
        return;
      }
      toast(await save());
    } catch (e) { toast(e.message); }
  };

  // 앱으로 돌아올 때 드라이브의 최신 내용을 받아온다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && gd.drive.fileId && !state.dirty
        && state.ui.autoSync !== false) {
      if (gd.needsLogin()) { paintSyncBtn(); return; }
      gd.pull({ merge: mergeIncoming, interactive: false }).then((r) => { if (r?.added) render(); })
        .catch(() => paintSyncBtn());
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

  driveStart();

  // 오프라인에서도 열리도록 앱 파일을 캐시에 넣어둔다 (http/https일 때만 동작)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.__SEED__) {
    navigator.serviceWorker.register('sw.js')
      .catch((err) => console.warn('오프라인 캐시 등록 실패 — 앱 동작에는 지장 없음:', err.message));
  }
}

start().catch((e) => {
  document.getElementById('app').innerHTML =
    `<div class="card"><h2>시작하지 못했습니다</h2><p class="neg">${e.message}</p>
     <p class="muted">설정 → 파일 가져오기로 데이터 파일을 직접 열어보세요.</p></div>`;
  console.error(e);
});
