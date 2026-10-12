# GitHub 푸시로 배포하기

연결 대상: [CVAT Sidebar Shortcuts](https://chromewebstore.google.com/detail/cvat-sidebar-shortcuts/mphpnnnfkagcfnehdelfgabmaklmdnmm)

## 한 번만 연결하기

자동화 코드는 준비되어 있습니다. Google 인증을 연결하기 전에는 **GitHub 릴리스·ZIP·패치노트까지만** 자동으로 게시하고, 웹스토어 제출은 건너뜁니다.

1. [Chrome 웹스토어 개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서 게시자 설정을 열고 **Publisher ID**를 확인합니다. 확장 ID와 다른 값입니다.
2. [Google 공식 API 설정 안내](https://developer.chrome.com/docs/webstore/using-api)의 Initial setup 순서대로 Google Cloud 프로젝트에서 Chrome Web Store API를 켜고 OAuth 클라이언트를 만듭니다. 확장 소유자 계정의 2단계 인증도 켜져 있어야 합니다.
3. 같은 안내의 OAuth Playground 절차로 `https://www.googleapis.com/auth/chromewebstore` 권한을 승인하고 **refresh token**을 발급합니다. Playground 설정에서 **Use your own OAuth credentials**를 사용하세요. 기본 Playground 인증정보로 만든 토큰을 장기 배포용으로 쓰지 않습니다. 동의 화면이 Testing 상태인 외부 앱은 토큰이 만료될 수 있으므로 Google 안내에 따라 운영 상태를 확인하세요.
4. [GitHub → Settings → Secrets and variables → Actions](https://github.com/r2gul4r/CVAT_shortcut/settings/secrets/actions)의 **Secrets**에 아래 세 값을 각각 넣습니다. 값은 채팅·소스·README에 적지 마세요.

| Secret 이름 | 값 |
|---|---|
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | 소유자 계정으로 발급한 refresh token |

5. 같은 화면의 **Variables** 탭에 아래 두 값을 넣습니다. 인증값을 모두 넣은 뒤 자동 제출을 켜세요.

| Variable 이름 | 값 |
|---|---|
| `CWS_PUBLISHER_ID` | 1번에서 확인한 Publisher ID |
| `CWS_AUTOPUBLISH` | `true` |

확장 ID `mphpnnnfkagcfnehdelfgabmaklmdnmm`은 제출 스크립트에 고정되어 있습니다. 별도 `key`나 추가 확장 권한은 필요하지 않습니다.

6. [Actions](https://github.com/r2gul4r/CVAT_shortcut/actions)에서 **Check and release extension → Run workflow → main**으로 첫 제출을 실행합니다. 이미 같은 버전의 GitHub 태그가 있다면 **그 태그를 만든 실행의 Re-run all jobs**를 사용하세요. 다른 커밋으로 같은 버전을 덮어쓰지 않습니다.

## 다음 업데이트부터

1. `extension/manifest.json`의 버전을 올리고 팝업·가이드의 현재 버전도 맞춥니다. 예: `2.2.1 → 2.2.2`.
2. `release-notes.json` 맨 위에 같은 버전의 제목과 변경 내용을 적습니다. 날짜 없이 최신순을 유지합니다. README 이력도 갱신합니다.
3. `python tools/release_notes.py`를 실행합니다. 확장 내부 업데이트 내역 페이지가 갱신됩니다.
4. 변경 파일을 커밋하고 **main에 push**합니다.
5. Actions에서 검사 → ZIP → GitHub 릴리스 → 웹스토어 심사 제출 결과를 확인합니다.

버전을 바꾸지 않은 일반 푸시는 검사만 합니다. PR은 검사만 합니다. 테스트가 실패하면 릴리스와 제출이 실행되지 않습니다. Google 심사 중이라는 결과는 사용자에게 배포가 완료되었다는 뜻이 아닙니다. 심사에 승인되면 게시되도록 `DEFAULT_PUBLISH`를 사용합니다.

패키지는 검사한 커밋에서 한 번 만들어 두 배포 단계에 전달합니다. 재실행 시 기존 태그의 커밋·패치노트·파일 해시가 다르면 중단합니다. 이미 공개한 ZIP은 덮어쓰지 않습니다. 빌드 ZIP은 Actions 아티팩트와 GitHub 릴리스에서 받으며, 로컬에서는 `python tools/package-extension.py`로 `releases/<버전>/`에 생성할 수 있습니다.

## 패치노트가 보이는 곳

- **확장 팝업 → 업데이트 내역**: 설치한 버전까지의 내역을 인터넷 없이 표시합니다.
- **GitHub Releases**: 해당 버전 패치노트와 ZIP이 자동 게시됩니다. GitHub 게시가 웹스토어 심사 완료를 의미하지는 않습니다.
- **웹스토어 상세 설명**: 현재 v2 API에는 설명 수정 기능이 없습니다. 아래 문장을 개발자 대시보드 설명에 한 번 붙여 넣으세요.

```text
업데이트 내역은 확장 팝업의 ‘업데이트 내역’에서 확인할 수 있습니다.
최신 배포 및 전체 패치노트: https://github.com/r2gul4r/CVAT_shortcut/releases
```

## 실패하거나 심사 중일 때

- **이미 같은 버전이 심사 중/공개됨**: 중복 제출하지 않고 해당 상태를 기록합니다. STAGED 상태도 자동 게시로 바꾸지 않습니다.
- **다른 버전이 심사 중**: 취소하거나 덮어쓰지 않고 중단합니다. 대시보드에서 기존 심사를 처리한 뒤 원래 실행을 다시 돌립니다.
- **업로드·제출 응답이 끊김**: 대시보드 상태부터 확인하세요. 자동화는 불확실한 쓰기 요청을 즉시 반복하지 않습니다. 같은 ZIP 재업로드를 서버가 거절하는 경우 대시보드 초안을 확인하거나 새 버전을 준비합니다.
- **Google 경고/반려/인증 오류**: Actions 단계와 개발자 대시보드를 확인합니다. 경고를 무시하거나 심사를 건너뛰지 않습니다. 토큰이 취소·만료됐다면 refresh token을 다시 발급해 Secret을 교체합니다.
- **자동 제출을 끄려면**: `CWS_AUTOPUBLISH`를 `false`로 바꾸거나 삭제합니다. GitHub 검사와 릴리스는 유지됩니다.

실제 Google 계정 연결과 첫 심사 제출은 설정 후 확인해야 합니다. 로컬 자동화 검사는 모의 응답으로 실패·재시도·중복 제출 처리를 검증합니다.

공식 근거: [v2 API 설정](https://developer.chrome.com/docs/webstore/using-api), [제출 옵션](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish), [API 리소스](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items), [설명 변경](https://developer.chrome.com/docs/webstore/update/#update-the-listing-metadata).
