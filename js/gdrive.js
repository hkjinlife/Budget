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
function emitDrive(status) {
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

/** 로그인 도구를 미리 불러둔다. 버튼을 눌렀을 때 창이 바로 떠야 브라우저가 막지 않는다(특히 아이폰) */
export function preload() {
  if (isConfigured()) ensureTokenClient().catch(() => { /* 오프라인이면 나중에 */ });
}

/** 저장된 접근 권한이 아직 살아 있는지 (구글은 브라우저 앱에 1시간짜리 권한만 준다) */
export function hasValidToken() {
  if (drive.token && Date.now() < drive.tokenExpiry) return true;
  try {
    const saved = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
    if (saved && Date.now() < saved.e) { drive.token = saved.t; drive.tokenExpiry = saved.e; return true; }
  } catch { /* 무시 */ }
  return false;
}

export function needsLogin() {
  return !!drive.fileId && !hasValidToken();
}

/** 로그인해서 접근 토큰을 받는다. 반드시 버튼을 누른 직후에 불러야 한다(아니면 브라우저가 창을 막는다) */
export async function connect() {
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
      try { localStorage.setItem('budget.gdrive.granted', '1'); } catch { /* 무시 */ }
      emitDrive('구글 연결됨');
      res(drive.token);
    };
    client.error_callback = (err) => rej(new Error(err?.type === 'popup_closed'
      ? '로그인 창이 닫혔습니다.' : '로그인 창을 열지 못했습니다. 다시 눌러주세요.'));
    try {
      // 한 번 허용한 사람은 동의 화면 없이 창이 잠깐 떴다가 바로 닫힌다
      client.requestAccessToken({ prompt: '' });
    } catch (e) { rej(e); }
  });
}

export class NeedLogin extends Error {
  constructor() { super('구글 연결이 필요합니다.'); this.name = 'NeedLogin'; }
}

async function token({ interactive = true } = {}) {
  if (hasValidToken()) return drive.token;
  if (!interactive) throw new NeedLogin();
  return connect();
}

export function signOut() {
  drive.token = null;
  drive.tokenExpiry = 0;
  try { localStorage.removeItem(LS_TOKEN); } catch { /* 무시 */ }
  emitDrive('연결 끊음');
}

/* ---------- 파일 고르기 / 만들기 ---------- */
// 구글 클라우드 프로젝트 번호 (클라이언트 ID 앞부분). 권한이 drive.file(앱이 만들거나 고른 파일만)이라,
// 파일 고르기 창에 이 번호를 알려줘야 드라이브 웹에서 직접 올린 파일도 앱이 읽을 수 있다.
const appId = () => String(CONFIG.googleClientId || '').split('-')[0];

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
      .setAppId(appId())
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

/** 드라이브의 폴더를 고른다 (새 파일을 어디에 둘지). 취소하면 null */
export async function pickFolder() {
  const tk = await token();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((res) => gapi.load('picker', res));
  return new Promise((res) => {
    const folders = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(tk)
      .setDeveloperKey(CONFIG.googleApiKey)
      .setAppId(appId())
      .setLocale('ko')
      .addView(folders)
      .setTitle('가계부 파일을 둘 폴더 고르기')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const f = data.docs[0];
          res({ id: f.id, name: f.name });
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
  emitDrive(`파일 연결됨: ${name}`);
}

export function restoreFile() {
  try {
    const f = JSON.parse(localStorage.getItem(LS_FILE) || 'null');
    if (f) { drive.fileId = f.id; drive.fileName = f.name; return true; }
  } catch { /* 무시 */ }
  return false;
}

/** 드라이브에 새 파일을 만든다 (처음 시작할 때). folderId가 있으면 그 폴더 안에 만든다 */
export async function createFile(name = '가계부_데이터.json', folderId = null) {
  const tk = await token();
  const upload = async (parents) => {
    const meta = { name, mimeType: 'application/json', ...(parents ? { parents } : {}) };
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    body.append('file', new Blob([JSON.stringify(state.data, null, 1)], { type: 'application/json' }));
    return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,parents', {
      method: 'POST', headers: { Authorization: `Bearer ${tk}` }, body,
    });
  };
  let r = await upload(folderId ? [folderId] : null);
  let movedToRoot = false;
  if (!r.ok && folderId) {          // 폴더에 쓸 권한이 없으면 내 드라이브 맨 위에 만든다
    r = await upload(null);
    movedToRoot = true;
  }
  if (!r.ok) throw new Error(`파일을 만들지 못했습니다 (${r.status})`);
  const f = await r.json();
  setFile(f.id, f.name);
  drive.lastModified = f.modifiedTime;
  return { ...f, movedToRoot };
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
export async function pull({ merge, interactive = true }) {
  if (!drive.fileId) throw new Error('먼저 파일을 고르세요.');
  const tk0 = await token({ interactive });
  drive.busy = true; emitDrive('불러오는 중…');
  try {
    const tk = tk0;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${drive.fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${tk}` },
    });
    if (r.status === 404) throw new Error('앱이 이 파일을 열 권한이 없습니다 (404). 설정 → 드라이브 파일 고르기로 파일을 다시 골라주세요.');
    if (!r.ok) throw new Error(`파일을 읽지 못했습니다 (${r.status})`);
    const incoming = await r.json();
    const info = await meta();
    drive.lastModified = info.modifiedTime;
    const result = merge(incoming);
    emitDrive(`불러옴 (${new Date(info.modifiedTime).toLocaleString('ko-KR')})`);
    return result;
  } finally {
    drive.busy = false; emitDrive();
  }
}

/** 지금 데이터를 드라이브에 쓴다. 그 사이 다른 기기가 고쳤으면 먼저 합친다 */
export async function push({ merge, force = false, interactive = true } = {}) {
  if (!drive.fileId) throw new Error('먼저 파일을 고르세요.');
  const tk = await token({ interactive });
  drive.busy = true; emitDrive('저장 중…');
  try {
    if (!force && drive.lastModified) {
      const info = await meta();
      if (info.modifiedTime !== drive.lastModified) {
        emitDrive('다른 기기의 변경을 먼저 합치는 중…');
        await pull({ merge, interactive: false });
      }
    }
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${drive.fileId}?uploadType=media&fields=modifiedTime`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(state.data, null, 1),
    });
    if (!r.ok) throw new Error(`저장하지 못했습니다 (${r.status})`);
    const info = await r.json();
    drive.lastModified = info.modifiedTime;
    state.dirty = false;
    emitDrive(`드라이브에 저장됨 (${new Date(info.modifiedTime).toLocaleTimeString('ko-KR')})`);
    return info;
  } finally {
    drive.busy = false; emitDrive();
  }
}

export function isReady() {
  return isConfigured() && !!drive.fileId && !!drive.token && Date.now() < drive.tokenExpiry;
}
