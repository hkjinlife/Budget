// 구글 드라이브 연동 설정.
// 아래 두 값은 구글 클라우드 콘솔에서 발급받아 붙여넣는다 (설정 방법은 README의 '구글 드라이브 연동' 참고).
// 둘 다 웹앱에 공개되는 값이라 비밀번호가 아니다. 대신 '내 사이트에서만' 쓰이도록 제한을 걸어둔다.
export const CONFIG = {
  googleClientId: '',   // 예: '1234567890-abcdefg.apps.googleusercontent.com'
  googleApiKey: '',     // 예: 'AIzaSy...'
};

// 설정 화면에서 입력한 값이 있으면 그것을 우선 쓴다 (파일을 고치지 않고 시험해볼 때 편하다)
try {
  const saved = JSON.parse(localStorage.getItem('budget.gdrive.config') || 'null');
  if (saved?.googleClientId) CONFIG.googleClientId = saved.googleClientId;
  if (saved?.googleApiKey) CONFIG.googleApiKey = saved.googleApiKey;
} catch { /* 저장소를 못 쓰는 환경 */ }
