// 앱 시작점: 데이터 불러오기 → 화면 그리기 → 탭·편집·저장 버튼 연결
import { state, boot, onChange, save, saveUI } from './store.js';
import { render, renderUserSwitch, toast } from './views.js';

const saveState = document.getElementById('saveState');
const editBtn = document.getElementById('editBtn');

function paintSaveState() {
  if (state.dirty) {
    saveState.textContent = '저장 안 됨';
    saveState.className = 'save-state dirty';
  } else {
    saveState.textContent = state.fileHandle ? '공유 폴더 파일에 저장됨' : '브라우저에 임시 저장됨';
    saveState.className = 'save-state saved';
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
  renderUserSwitch();
  render();
  paintSaveState();
  paintEditBtn();

  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    state.ui.view = b.dataset.view;
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
    try { toast(await save()); } catch (e) { toast(e.message); }
  };

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

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
