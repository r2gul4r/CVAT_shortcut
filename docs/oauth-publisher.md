# CVAT GitHub Actions Publisher

CVAT Sidebar Shortcuts의 개발자가 자신의 Chrome 웹스토어 등록정보를 관리하는 배포 도구입니다. [프로젝트와 소스 코드](https://github.com/r2gul4r/CVAT_shortcut), [자동 배포 설정](automatic-release.md)을 확인할 수 있습니다.

이 OAuth 앱은 개발자의 GitHub Actions 배포 인증에 사용합니다. 확장프로그램을 설치한 일반 사용자는 이 앱에 로그인하거나 Google 계정 권한을 제공할 필요가 없습니다.

- 운영자: GitHub 사용자 [r2gul4r](https://github.com/r2gul4r)
- 문의: [프로젝트 Issues](https://github.com/r2gul4r/CVAT_shortcut/issues). 공개 게시물이므로 인증정보나 비공개 작업 데이터는 올리지 마세요.
- [개인정보 처리 안내](#개인정보-처리-안내)
- [이용 안내](#이용-안내)

## 개인정보 처리 안내

### 접근하는 정보와 목적

Google OAuth의 `https://www.googleapis.com/auth/chromewebstore` 권한을 요청합니다. 권한을 승인한 개발자가 관리할 수 있는 Chrome 웹스토어 항목에 접근할 수 있는 권한이며, 이 프로젝트의 배포 작업은 설정된 CVAT Sidebar Shortcuts 항목의 상태 조회, 확장 ZIP 업로드, 심사 제출에 사용합니다.

이 배포 도구는 Gmail, Drive, 연락처, CVAT 작업 이미지와 라벨링 데이터에 접근하기 위한 권한을 요청하지 않습니다. 확장프로그램 내부 기능의 데이터 처리와 이 개발자용 배포 인증은 별개입니다.

### 저장 및 전달

OAuth 클라이언트 ID, 클라이언트 비밀키, 갱신 토큰은 해당 저장소의 GitHub Actions Secrets에 저장합니다. 배포 실행 중 GitHub Actions가 이를 Google OAuth 서버에 전달하여 접근 토큰을 발급받고, Chrome Web Store API에 접근합니다. 초기 승인과 토큰 발급에는 Google OAuth Playground를 사용할 수 있습니다.

배포 ZIP과 필요한 등록 상태 정보는 Google Chrome Web Store에 전달됩니다. 공개 소스, 릴리스 ZIP, 릴리스 노트 및 배포 결과는 GitHub 저장소와 Actions에 게시될 수 있습니다. 인증값은 공개 코드, 릴리스 파일 또는 로그에 포함하지 않도록 처리합니다. 비공개 OAuth 인증정보를 광고, 판매 또는 CVAT 작업 분석에 사용하지 않습니다.

### 보관 및 인증 해제

인증정보는 자동 배포를 위해 GitHub Secrets에 보관하며 교체하거나 삭제할 수 있습니다. 개발자는 Google 계정의 [외부 앱 연결 관리](https://myaccount.google.com/connections)에서 이 앱의 접근 권한을 취소할 수 있습니다. GitHub 저장소 설정의 Secrets에서도 배포 인증정보를 삭제할 수 있습니다. 권한 취소 또는 인증정보 삭제 후에는 새로 인증하기 전까지 자동 배포가 동작하지 않습니다.

Google 및 GitHub의 서비스 자체 기록과 보관에는 각 서비스의 정책이 적용됩니다. 공개 릴리스 파일을 삭제하더라도 다른 사람이 이미 내려받은 사본까지 회수할 수는 없습니다.

## 이용 안내

자신에게 관리 권한이 있는 웹스토어 항목의 배포에만 사용하세요. OAuth 승인은 개발자 본인 계정에서 수행하고, 인증값을 저장소 코드나 공개 게시물에 입력하지 마세요. GitHub Actions의 제출 성공은 Google의 심사 승인이나 웹스토어 공개 완료를 의미하지 않습니다. 실제 공개 여부는 웹스토어 등록 상태에서 확인해야 합니다.
