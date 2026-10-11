# Chrome Web Store 업로드 안내 — 1.4.1

스토어 이름·버전·기능은 개발판과 동일한 **CVAT Sidebar Shortcuts 1.4.1**입니다. 0.1.1 준비는 취소됐으며 해당 폴더/ZIP은 사용하지 않습니다. 기존 1.4.1 ZIP의 모든 런타임·아이콘 파일이 현재 개발판과 같은지 다시 확인했습니다. 새 기능 구현이나 개발판 변경은 없습니다.

업로드할 파일:

`../cvat-sidebar-shortcuts-1.4.1-store.zip`

## 사용자가 준비할 것

1. 개발자 계정의 필요한 항목이 완료됐는지 확인합니다. **Non-trader는 사용자가 직접 선택했습니다.** 이 작업에서 로그인, 약관 동의, 결제, 계정 변경을 하지 않았습니다.
2. [개인정보처리방침 초안](PRIVACY-KO.md)의 운영자/문의처를 공개해도 되는 정보로 정하고 공개 URL을 준비합니다. 개인 연락처는 아직 넣거나 공개하지 않았습니다.
3. `extension/icons/icon128.png`는 준비됐습니다. 회사 자료 없는 **440×280 홍보 이미지**와 **1280×800 또는 640×400 스크린샷 최소 1장**을 추가로 준비합니다. [Chrome 이미지 요건](https://developer.chrome.com/docs/webstore/images)
4. [한글 설명/권한 문구](STORE-LISTING-KO.md), 비기밀 심사 테스트 방법과 [Windows 파일럿 체크](PILOT-KO.md)를 확인합니다. 실제 Mac 검증은 미완료입니다.

## 준비 후 업로드·제출 순서

1. [개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서 **Add new item / 새 항목**을 선택하고 위 **1.4.1 ZIP**을 업로드합니다. Package에 이름 **CVAT Sidebar Shortcuts**, 버전 **1.4.1**이 표시되는지 확인합니다.
2. **Store Listing**에 설명과 이미지를 넣습니다. **Privacy**에 단일 목적, activeTab/scripting/storage 권한 이유, 실제 로컬 처리/저장 공개와 개인정보처리방침 URL을 입력합니다. 원격 코드는 사용하지 않습니다.
3. **Distribution → Visibility = Unlisted**와 배포 지역을 선택합니다. Unlisted는 링크를 아는 사람이 설치할 수 있는 방식이며 특정 회사/다섯 명만의 접근 제한이 아닙니다. Unlisted도 정책 심사를 받습니다. [공식 배포 안내](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
4. 테스트 안내와 모든 공개 내용을 확인한 뒤 **Submit for Review**를 선택합니다. 원하면 심사 후 자동 게시를 끄고 직접 게시할 수 있습니다. [공식 업로드·심사 안내](https://developer.chrome.com/docs/webstore/publish)
5. 승인·게시 후 스토어 링크로 설치합니다. 스토어 설치에는 개발자 모드가 필요하지 않습니다. 개발판과 스토어판은 확장 ID/로컬 설정이 별도일 수 있으므로 스토어판에서 설정을 확인하고 같은 CVAT 탭에 두 확장을 동시에 Enable하지 않습니다.

이 작업에서는 업로드, 심사 제출, 게시, 연락처 공개를 하지 않았습니다. 지금 준비된 것은 로컬 패키지와 문구입니다.

## 검증 범위

232개 가상 Chrome 검사가 통과했습니다. 실제 회사 CVAT, 설치된 확장 API, OS 기본 확대/제스처나 Mac 기기에서 입증한 결과가 아닙니다. Mac 관련 검사는 Windows Chrome에서 플랫폼/입력을 모의한 것입니다.

CVAT 사용자 지정 단축키는 자동 탐지하지 않습니다. **CVAT Settings → Shortcuts**에서 겹치지 않는 키를 고릅니다. 처리한 키는 window 캡처 단계에서 반복과 정상 release까지 막지만 입력/IME·그리기 중·지원되지 않는 상태는 기존 CVAT 키 동작으로 통과할 수 있습니다. 먼저 등록된 window 캡처 핸들러가 표시 없이 실행한 동작은 되돌릴 수 없습니다.
