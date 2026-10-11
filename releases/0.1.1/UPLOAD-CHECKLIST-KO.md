**SUPERSEDED — 0.1.1 canceled. Do not upload this ZIP. Use CVAT Sidebar Shortcuts 1.4.1: ../../cvat-sidebar-shortcuts-1.4.1-store.zip. See ../../store/UPLOAD-CHECKLIST-KO.md.**

# 첫 스토어 배포 0.1.1 — 내가 할 일

현재는 로컬 준비만 완료했습니다. 로그인, 계정 등록, 약관 동의, 결제, 업로드, 심사 제출, 게시를 진행하지 않았습니다. 개인 연락처도 입력하거나 공개하지 않았습니다.

## 먼저 준비할 것

- [ ] Chrome Web Store 개발자 계정이 이미 등록돼 있는지 확인합니다. 없다면 계정 선택·약관·표시되는 등록 비용을 본인이 확인하고 진행해야 합니다. 계정 상태는 아직 미확인입니다. [공식 등록 안내](https://developer.chrome.com/docs/webstore/register)
- [ ] [PRIVACY-KO.md](store/PRIVACY-KO.md)의 운영자/문의처 자리표시자를 공개해도 되는 실제 정보로 채우고, 공개 개인정보처리방침 URL을 준비합니다. 개인 이메일을 여기서 추측하거나 넣지 않았습니다. [공식 개인정보 항목 안내](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [ ] 아이콘은 `extension/icons/icon128.png`를 사용합니다. **440×280 홍보 이미지 1장**과 **1280×800 또는 640×400 스크린샷 최소 1장**도 준비해야 합니다. 회사 화면·이미지·URL·계정 대신 자작/공개 데모를 사용합니다. 아직 홍보 이미지와 스크린샷은 준비하지 않았습니다. [공식 이미지 요건](https://developer.chrome.com/docs/webstore/images)
- [ ] Windows 개인 테스트와 [충돌 파일럿 체크리스트](store/PILOT-KO.md)를 확인합니다. 실제 Mac 검증은 아직 안 됐으므로 검증 완료라고 표시하지 않습니다. 회사 계정/자료 없이 심사자가 확인할 테스트 방법도 정리합니다.

## 준비가 끝난 뒤 직접 진행하는 업로드 순서

1. [개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서 **Add new item / 새 항목**을 선택합니다. 첫 스토어 항목으로 생성하며, 기존 개발판 1.4.1을 다운그레이드하거나 덮어쓰지 않습니다.
2. 아래 ZIP을 선택하여 업로드합니다. 패키지에 표시되는 버전이 **0.1.1**인지 확인합니다.

   `C:\Users\mrmaj\Documents\Codex\2026-10-02\task\cvat-shortcuts\releases\0.1.1\cvat-sidebar-shortcuts-0.1.1-store.zip`

3. **Store Listing**에 [한글 설명](store/STORE-LISTING-KO.md), 준비한 아이콘/홍보 이미지/스크린샷을 넣습니다.
4. **Privacy**에 단일 목적, activeTab/scripting/storage 사용 이유, 실제 로컬 처리·저장 방식, 개인정보처리방침 URL을 입력합니다. 원격 코드는 사용하지 않습니다. 대시보드의 최신 질문과 공개 문구가 일치하는지 직접 확인합니다.
5. **Distribution → Visibility = Unlisted**를 선택하고 필요한 배포 지역을 확인합니다. Unlisted는 검색에 공개 목록으로 나오지 않지만 **링크를 아는 누구나 설치할 수 있으며**, 특정 회사나 다섯 명에게만 제한되는 방식이 아닙니다. Unlisted도 정책 심사를 거칩니다. [공식 배포 안내](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
6. 비기밀 테스트 안내를 제공하고 모든 입력을 검토한 뒤 **Submit for Review**를 선택합니다. 원하면 심사 완료 후 자동 게시 옵션을 끄고 직접 게시하는 방식을 선택합니다. [공식 업로드·심사 안내](https://developer.chrome.com/docs/webstore/publish)
7. 승인·게시된 뒤 생성된 스토어 링크를 설치할 사람에게 전달합니다. 링크로 Chrome에 설치하면 개발자 모드가 필요하지 않습니다. 새 스토어 설치는 별도 확장 ID이므로 기존 개발판의 로컬 설정을 자동으로 가져오지 않습니다. 단축키/클래스/휠 옵션을 다시 설정하고 같은 CVAT 탭에 두 확장을 동시에 Enable하지 마세요.

## 현재 검증과 한계

기능 코드는 개발판 1.4.1과 동일합니다. 그 코드의 232개 가상 Chrome 검사가 통과한 증거를 재사용하며, 버전만 바꾼 뒤 기능 테스트를 새로 수행한 것으로 표시하지 않습니다. Chrome 확장 API와 CVAT 화면은 모의한 테스트이고 실제 회사 CVAT나 Mac에서 입증한 결과가 아닙니다.

처리한 키는 window 캡처 단계에서 반복과 정상 release까지 막지만, CVAT 사용자 지정 키를 자동 탐지하지 않습니다. **CVAT Settings → Shortcuts**에서 겹치지 않는 키를 선택하세요. 입력/IME·그리기 중·지원되지 않는 화면은 원래 CVAT 키 동작으로 통과할 수 있습니다. 확장보다 먼저 등록된 window 캡처 핸들러가 표시 없이 실행한 동작은 되돌릴 수 없습니다.

기존 개발판의 파일, 버전 1.4.1 및 설정은 건드리지 않았습니다. 이 0.1.1 릴리스 폴더를 기존 개발판 소스 폴더에 복사해서 덮어쓰지 마세요. 이번 ZIP에는 런타임과 일반 생성 아이콘 10개 파일만 포함하며, 회사 데이터/URL, 비밀키, 테스트 파일, 개인 연락처, 이 안내 문서는 포함하지 않습니다.
