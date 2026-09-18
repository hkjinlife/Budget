// 구글 드라이브 자동 동기화.
// 앱이 드라이브에 있는 가계부 파일 하나를 직접 읽고 쓴다. 데이터는 사용자의 드라이브에만 있다.
// 권한 범위는 drive.file — "이 앱으로 열거나 만든 파일"만 볼 수 있다. 드라이브 전체를 보지 않는다.
import { state } from './store.js';
import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const LS_TOKEN = 'budget.gdrive.token';
const LS_FILE = 'budget.gdrive.file';

export const drive = {
  token: null,
  tokenExpiry: 0,
  fileId: null,
  fileName: '',
  lastModified: '',      // 드라이브가 알려준 마지막 수정 시각
  status: '연결 안 됨',
  busy: false,
};

const listeners = [];
export function onDriveChange(fn) { listeners.push(fn); }
function emit(status) {
  if (status) drive.status = status;
  listeners.forEach((f) => f());
}

export function isConfigured() {
  return !!(CONFIG.googleClientId && CONFIG.googleApiKey);
}

/* ---------- 구글 라이브러리 불러오기 ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('구글 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    document.head.appendChild(s);
  });
}

/* ---------- 로그인 ---------- */
let tokenClient = null;

async function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  await loadScript('https://accounts.google.com/gsi/client');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.googleClientId,
    scope: SCOPE,
    callback: () => {},        // requestToken에서 갈아끼운다
  });
  return tokenClient;
}

/** 로그인해서 접근 토큰을 받는다. silent=true면 창을 띄우지 않고 조용히 시도한다 */
export async function connect({ silent = false } = {}) {
  if (!isConfigured()) throw new Error('구글 연동 설정이 없습니다. js/config.js를 채워주세요.');
  const client = await ensureTokenClient();
  return new Promise((res, rej) => {
    client.callback = (resp) => {
      if (resp.error) { rej(new Error(resp.error_description || resp.error)); return; }
      drive.token = resp.access_token;
      drive.tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
      try {
        localStorage.setItem(LS_TOKEN, JSON.stringify({ t: drive.token, e: drive.tokenExpiry }));
      } catch { /* 무시 */ }
      emit('구글 연결됨');
      res(drive.token);
    };
    try {
      client.requestAccessToken({ prompt: silent ? '' : 'consent' });
    } catch (e) { rej(e); }
  });
}

async function token() {
  if (drive.token && Date.now() < drive.tokenExpiry) return drive.token;
  try {
    const saved = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
    if (saved && Date.now() < saved.e) { drive.token = saved.t; drive.tokenExpiry = saved.e; return drive.token; }
  } catch { /* 무시 */ }
  return connect({ silent: true });
}

export function signOut() {
  drive.token = null;
  drive.tokenExpiry = 0;
  try { localStorage.removeItem(LS_TOKEN); } catch { /* 무시 */ }
  emit('연결 끊음');
}

/* ---------- 파일 고르기 / 만들기 ---------- */
export async function pickFile() {
  const tk = await token();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((res) => gapi.load('picker', res));
  return new Promise((res) => {
    // 내 드라이브 + 공유받은 파일(아내·가족이 여기서 찾는다)을 탭으로 나눠 보여준다
    const mine = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes('application/json')
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const shared = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes('application/json')
      .setOwnedByMe(false);
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(tk)
      .setDeveloperKey(CONFIG.googleApiKey)
      .setLocale('ko')
      .addView(mine)
      .addView(shared)
      .setTitle('가계부_데이터.json 고르기')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          setFile(doc.id, doc.name);
          res({ id: doc.id, name: doc.name });
        } else if (data.action === google.picker.Action.CANCEL) {
          res(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

function setFile(id, name) {
  drive.fileId = id;
  drive.fileName = name;
  try { localStorage.setItem(LS_FILE, JSON.stringify({ id, name })); } catch { /* 무시 */ }
  emit(`파일 연결됨: ${name}`);
}

export function restoreFile() {
  try {
    const f = JSON.parse(localStorage.getItem(LS_FILE) || 'null');
    if (f) { drive.fileId = f.id; drive.fileName = f.name; return true; }
  } catch { /* 무시 */ }
  return false;
}

/** 드라이브에 새 파일을 만든다 (처음 시작할 때) */
export async function createFile(name = '가계부_데이터.json') {
  const tk = await token();
  const meta = { name, mimeType: 'application/json' };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', new Blob([JSON.stringify(state.data, null, 1)], { type: 'application/json' }));
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime', {
    method: 'POST', headers: { Authorization: `Bearer ${tk}` }, body,
  });
  if (!r.ok) throw new Error(`파일을 만들지 못했습니다 (${r.status})`);
  const f = await r.json();
  setFile(f.id, f.name);
  drive.lastModified = f.modifiedTime;
  return f;
}

/* ---------- 읽기 / 쓰기 ---------- */
async function meta() {
  const tk = await token();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${drive.fileId}?fields=modifiedTime,name`, {
    headers: { Authorization: `Bearer ${tk}` },
  });
  if (!r.ok) throw new Error(`파일 정보를 읽지 못했습니다 (${r.status})`);
  return r.json();
}

/** 드라이브 파일을 읽어 지금 데이터와 합친다 */
export async function pull({ merge }) {
  if (!drive.fileId) throw new Error('먼저 파일을 고르세요.');
  drive.busy = true; emit('불러오는 중…');
  try {
    const tk = await token();
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${drive.fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${tk}` },
    });
    if (!r.ok) throw new Error(`파일을 읽지 못했습니다 (${r.status})`);
    const incoming = await r.json();
    const info = await meta();
    drive.lastModified = info.modifiedTime;
    const result = merge(incoming);
    emit(`불러옴 (${new Date(info.modifiedTime).toLocaleString('ko-KR')})`);
    return result;
  } finally {
    drive.busy = false; emit();
  }
}

/** 지금 데이터를 드라이브에 쓴다. 그 사이 다른 기기가 고쳤으면 먼저 합친다 */
export async function push({ merge, force = false } = {}) {
  if (!drive.fileId) throw new Error('먼저 파일을 고르세요.');
  drive.busy = true; emit('저장 중…');
  try {
    if (!force && drive.lastModified) {
      const info = await meta();
      if (info.modifiedTime !== drive.lastModified) {
        emit('다른 기기의 변경을 먼저 합치는 중…');
        await pull({ merge });
      }
    }
    const tk = await token();
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${drive.fileId}?uploadType=media&fields=modifiedTime`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.data, null, 1),
    });
    if (!r.ok) throw new Error(`저장하지 못했습니다 (${r.status})`);
    const info = await r.json();
    drive.lastModified = info.modifiedTime;
    state.dirty = false;
    emit(`드라이브에 저장됨 (${new Date(info.modifiedTime).toLocaleTimeString('ko-KR')})`);
    return info;
  } finally {
    drive.busy = false; emit();
  }
}

export function isReady() {
  return isConfigured() && !!drive.fileId && !!drive.token && Date.now() < drive.tokenExpiry;
}
