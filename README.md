# CVAT Sidebar Shortcuts

현재 버전: **2.1.4** · Chrome Manifest V3 확장프로그램

CVAT의 AI·새 마스크 도구 단축키, 라벨 선택 오버레이, 브러쉬 크기 조절, Space 화면 이동과 한글 가이드를 제공합니다.

## 작업 위치와 배포 파일

- 로컬 작업 폴더: `C:\git\cvat_shortcut`
- 확장 소스: [`extension/`](extension/)
- 배포 ZIP: [cvat-sidebar-shortcuts-2.1.4-ko.zip](releases/2.1.4/cvat-sidebar-shortcuts-2.1.4-ko.zip)
- [2.1.4 패치노트](releases/2.1.4/release-notes-2.1.4.txt)
- [적용 가이드](extension/guide.html)

2.1.4는 2.1.3의 버전 표기만 변경한 배포본입니다. 라벨 선택창의 위치·크기를 실제 보이는 화면에 맞추고, 화면 확대·창 크기 변경 및 저장된 화면 밖 위치를 보정합니다. N을 확장 도구 단축키로 중복 지정할 때의 완료 동작 변경은 포함하지 않았습니다.

## 로컬 설치

1. Chrome에서 `chrome://extensions`를 열고 개발자 모드를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**에서 `C:\git\cvat_shortcut\extension`을 선택합니다.
3. CVAT 작업을 저장하고 페이지를 새로고침합니다.
4. 확장 팝업에서 **이 CVAT 탭에서 사용**을 누릅니다.
5. 라벨 선택창이 보이지 않으면 **라벨 선택창 사용 → 라벨 선택창 복구**를 누릅니다.

이전 폴더에서 압축해제 방식으로 설치했다면 폴더 이동 후 로드 경로를 확인하세요. 다른 경로로 다시 로드하면 확장 ID와 로컬 설정이 달라질 수 있으므로 기존 단축키 설정을 먼저 확인해 두세요. 웹스토어 설치본의 설치 경로는 이 작업 폴더와 별개입니다.

## 테스트와 패키징

Node.js와 Chrome이 필요합니다. Windows 기본 Chrome 경로를 사용하며, 다른 설치 경로는 `CVAT_TEST_CHROME` 환경 변수로 지정합니다.

```powershell
node tests/run-tests.mjs
node tests/test-label-logic.cjs
node tests/run-world-tests.mjs
python tools/package-extension.py
```

패키징은 `extension/manifest.json`의 버전으로 `releases/<버전>/`에 ZIP과 파일 해시를 생성합니다. Python 표준 라이브러리만 사용합니다. 이전 `tools/build-artifacts.mjs`와 `prepare-first-release.mjs`는 초기 배포용 기록이므로 현재 버전 패키징에는 사용하지 않습니다.

검사는 예시 CVAT 화면·모의 Chrome API와 별도 Chrome 프로필을 사용합니다. 기존 브라우저 프로필이나 회사 CVAT 데이터에 접근하지 않습니다. 실제 배포 CVAT 설치본의 호환성 검증과는 구분합니다. `tests/.browser-profiles/`는 Git에서 제외합니다.

## 이전 개발 기록

아래 및 `store/`, `INSTALLATION-STATUS.md`, `releases/0.1.1/`에는 이전 버전의 개발·배포 준비 기록이 포함되어 있습니다. 현재 소스와 배포본은 위의 2.1.4 경로를 사용하세요.

## 2.1.2 · 라벨 선택창 복구 (2026-10-11)

‘라벨 선택창 복구’는 최소화·위치·크기·투명도를 기본값으로 되돌리고 숨김 스타일을 초기화합니다. 복구 응답에서 라벨창의 연결 여부, 화면 범위, 실제 클릭 가능한 표시 상태를 확인합니다. 구버전 코드가 남은 탭에는 RELOAD 안내를, 표시 실패에는 OFF/HIDDEN/COVERED 등 고정된 확인 코드를 표시합니다. 라벨·단축키 설정은 복구 대상으로 삼지 않습니다.

요소 전체화면에서는 전체화면 요소 밖의 UI가 z-index와 관계없이 가려졌습니다. 실제 Chrome requestFullscreen으로 문제를 재현했으며, 이제 라벨창을 전체화면 요소 안으로 옮기고 해제할 때 원래 문서 루트로 되돌립니다. 전체화면 진입·해제, 숨김 스타일 복구, 팝업의 표시 실패 안내를 검사했습니다. 이는 재현된 코드 문제의 수정이며 사용자 CVAT에서 발생한 원인은 아직 확정하지 않았습니다.

## 2.1.1 · N 연동 실패 수정 (2026-10-09)

CVAT Workspace.STANDARD의 실제 값은 대소문자를 구분하는 `Standard`입니다. 2.1.0은 이를 `standard`로 검사해서 기본 작업 공간에서도 N 시작을 차단했습니다. 테스트 화면도 잘못된 값을 사용했습니다. 공개 CVAT enum에 맞게 테스트 화면을 먼저 수정해 N 관련 21개 실패를 재현한 뒤, 연결 판별을 수정했습니다. 2D 기본 작업 공간에서 선택 라벨로 N을 시작하고 기존 도구·모델·설정을 유지합니다.

N 연결을 확인하지 못하면 안내에 고정된 확인 코드(STORE, WORKSPACE, BRIDGE 등)를 표시합니다. 이 코드는 실패 단계만 나타내며 작업 ID·라벨 값·이미지·객체·예외 내용은 포함하지 않습니다. 기존 V/B 경로와 그리는 중의 N 완료 동작은 유지합니다. 업데이트 후 확장을 새로고침하고 CVAT 작업을 저장한 뒤 페이지도 새로고침하여 ‘이 CVAT 탭에서 사용’을 다시 눌러야 합니다.

검증: 실제 `Standard` 값과 공개 Mousetrap을 사용하는 Chrome 합성 회귀, Node 라벨 로직, 별도 Chrome MAIN/ISOLATED 실행 환경 검사를 수행합니다. 상세 결과는 배포 패키지의 별도 validation-2.1.1.json에 있습니다. 실제 사용자 CVAT 설치본의 실행 결과는 아직 확인되지 않았습니다.

## 2.1.0 · N 이전 도구와 선택 라벨 연동 (2026-10-09)

오버레이·팝업·라벨 단축키로 선택한 다음 객체 라벨을 AI·새 마스크 단축키뿐 아니라 CVAT의 기본 N 이전 도구 호출에도 적용합니다. 새 객체를 시작하기 직전에 라벨 ID만 갱신하고 이전 도구, 객체 종류, AI 모델, 점 개수와 그리기 옵션을 보존합니다. 그리는 중이나 기존 객체 편집 중 N은 CVAT의 완료·종료 동작과 현재 라벨을 유지합니다. Shift+N과 확장프로그램에 직접 지정한 N 단축키도 기존 우선순위를 유지합니다.

팝업에서 명시적으로 활성화한 탭에만 native-repeat.js를 MAIN world로 먼저 주입하고 common.js/overlay.js/content.js를 ISOLATED world로 주입합니다. 동기 DOM 요청/응답으로 현재 선택 이름만 전달합니다. 공개 CVAT 코드의 REMEMBER_OBJECT reducer는 이전 drawing 설정을 초기화하므로 전체 기억된 설정을 보존한 payload와 updateCurrentControl:false를 사용합니다. 원래 N 키 이벤트가 CVAT로 전달되며 키 재전송, Esc, 도구 시작 API 호출은 추가하지 않습니다.

이 연결은 공식 확장 API가 아닌 React Redux Provider의 내부 구조를 사용합니다. 현재 작업 ID, 2D standard workspace, idle canvas, N 매핑, 라벨 이름·ID·도형 호환성을 확인합니다. 준비 중이거나 구조를 확인하지 못하면 새로운 N 호출을 차단하고 안내하며 기존 AI·새 마스크 단축키는 유지합니다. drawing/edit 종료 경로는 연결을 사용할 수 없어도 그대로 통과합니다. 이미 저장된 객체 데이터·이미지·픽셀을 읽거나 전송하지 않으며 Chrome 권한도 그대로입니다.

검증: Chrome 합성 회귀 411개, Node 라벨 로직 12개, 실제 Chrome MAIN/ISOLATED 실행 환경 전달 5개로 총 428개 통과. 합성 CVAT DOM/React/Redux와 공개 Mousetrap의 N/V/B 입력 계약을 확인했습니다. 실제 배포 CVAT 설치본의 호환성 및 웹스토어 제출은 검증 범위에 포함되지 않습니다.

## 2.0.0 · 이동 가능한 라벨 선택 오버레이 (2026-10-09)

닫기/최소화: ×는 cvatLabelOverlayEnabled=false를 저장하여 팝업 스위치와 동기화합니다. −는 launcher 상태로 최소화하며 버튼 드래그와 클릭 복원을 구분합니다. 기존 collapsed 상태는 launcher로 이관합니다. 작은 버튼은 방향키 이동도 지원합니다.

크기 조절: 네 변과 네 모서리에서 포인터 드래그 및 방향키 조절. 반대편 가장자리를 고정한 채 크기를 조절하며 방향에 따라 커서를 표시합니다. 너비·높이는 기존 오버레이 설정에 저장되며 이전 설정은 248×480으로 시작합니다. 일반 최소 크기는 220×320이며 화면 밖으로 넘지 않도록 제한합니다. CSS Grid가 너비에 따라 열 수를 정하고 라벨 목록만 스크롤합니다. 확대/축소, 입력 차단, 중단/숨김 후 복원, 잘못된 크기 값을 검증했습니다.

팝업의 라벨 선택창 사용 옵션은 별도 cvatLabelOverlayEnabled 키로 저장합니다. 끄면 런처까지 숨기며 단축키는 계속 동작합니다. 위치/투명도 설정은 유지합니다. 리뷰에서 확인한 슬라이더 마우스 조절 후 포커스 잔류, 보조키 해제 차단, 비활성화/중단 후 입력 차단 잔류를 수정하고 회귀 검사에 추가했습니다.

overlay.js를 content.js 앞에 주입합니다. Shadow DOM으로 스타일과 UI를 분리하고, window capture에서 오버레이의 포인터/클릭/휠을 처리하여 캔버스 입력을 차단합니다. CVAT에서 시작한 스트로크의 해제 이벤트는 원래 document 핸들러로 전달합니다. 제목 드래그 및 방향키 이동, 접기, 작은 런처로 숨기기, 팝업에서 재표시를 지원합니다. 위치/표시 상태는 별도 cvatLabelOverlayV1 키에 저장해 기본 라벨이나 도구 전환을 취소하지 않습니다.

선택은 기존 다음 객체 기본 라벨 저장 경로를 공유합니다. 현재 작업 클래스 목록만 읽고, 실제 이미지와 주석은 읽지 않습니다. 목록/선택/단축키 상태를 500ms마다 비교하고 변경된 경우만 목록을 갱신합니다. 일시정지 시 창과 갱신 타이머를 제거하며, 지원되지 않는 주소에서는 표시하지 않습니다. 기존 권한은 유지됩니다.

투명도: 창 맨 아래 슬라이더에서 0~70%를 5% 단위로 조절하고 cvatLabelOverlayV1.transparency에 저장합니다. 기본 0%이며 잘못된 저장 값은 범위를 제한합니다. 마우스와 키보드 입력이 캔버스/라벨 단축키에 전달되지 않습니다.

검증: 합성 Chrome 374개 + Node 로직 12개. 실제 데모에서 슬라이더 클릭/드래그/방향키 및 새로고침 후 값 복원을 확인했습니다. 로컬 데모에서 실제 브라우저 클릭·드래그·접기·복원·단축키 및 위치 복원을 확인했습니다. 데모는 common.js/overlay.js를 그대로 포함하고 CVAT 연결만 예시 구현을 사용합니다. 실제 회사 CVAT 설치본 검증·스토어 제출은 수행하지 않았습니다.

## 1.9.0 · 라벨 선택 단축키와 CVAT 우선 처리 (2026-10-09)

라벨별 키 지정/변경/해제를 추가했습니다. 라벨 선택은 다음 AI·새 마스크 객체의 기본 라벨만 저장하며 기존 CVAT 객체나 그리기 세션을 변경하지 않습니다. 선택한 이름과 키만 로컬에 저장하고 작업별 라벨 목록·색상은 저장하지 않습니다. 설정은 Chrome 프로필의 탭들이 공유하며, 실행 시 현재 작업의 전체 클래스 목록에서 정확한 이름과 중복 여부를 다시 확인합니다.

등록된 키는 지원되는 작업 화면의 window capture 단계에서 먼저 소유합니다. 준비/쿨다운/마우스 누름/라벨 누락 때문에 실행하지 못해도 CVAT로 넘어가지 않으며 keypress, 반복, keyup도 차단합니다. 글자 입력·IME·대화상자·일시정지는 예외입니다. Space pan도 기존 스트로크 중에는 Space를 예약하면서 스트로크를 유지합니다. Chrome/OS 단축키, 또는 확장보다 먼저 실행된 동일 window capture 리스너의 효과를 취소할 수 있다는 보장은 하지 않습니다.

비동기 저장 전에 다음 도구가 새 라벨을 사용할 수 있도록 즉시 선택값을 유지하고, 연속 저장은 순서대로 처리합니다. 라벨만 변경되는 storage 이벤트는 이미 시작된 도구 전환을 취소하지 않습니다. 단축키·기타 설정 변경은 기존 취소 처리를 유지합니다.

검증: 격리 Chrome 합성 검사 326개, Node 로직 12개 통과. 실제 공개 Mousetrap으로 keydown/keypress/keyup 충돌을 재현했습니다. 팝업은 예시 클래스와 모의 Chrome API를 사용하는 로컬 Chrome 화면에서 1/2 지정과 표시를 확인하고 가이드 이미지를 캡처했습니다. 회사 CVAT 화면·이미지·객체에 접근하거나 실제 설치본에 적용하지 않았습니다. 웹스토어 제출도 수행하지 않았습니다.

## 1.8.0 · Space + 왼쪽 드래그 화면 이동 (2026-10-08)

브러쉬를 켠 채 Space를 누르고 왼쪽 드래그하면 CVAT의 기본 가운데 버튼 이동을 호출합니다. Esc나 도구 재선택 없이 이동하며, 마우스와 Space를 놓으면 계속 그릴 수 있습니다. 팝업에서 켜고 끌 수 있고 기본값은 켜짐입니다. 기존 Space 도구 단축키는 우선 유지하며 팝업에서 충돌 안내를 표시합니다.

실제 왼쪽 pointer/mouse 이벤트는 window capture에서 차단하고, CVAT 캔버스 루트에 가운데 버튼 mouse 이벤트를 전달합니다. 이미지에 CSS 이동을 적용하지 않습니다. Space를 먼저 놓으면 native mouseup을 전달하고 기존 왼쪽 누름의 나머지 이벤트를 차단합니다. 입력/IME, 도구상자·대화상자, 기존 드로잉 중 진입, 창 포커스 상실, 취소, 설정 변경, 작업 이동 및 캔버스 제거를 처리합니다. 가이드에 사용 순서와 실제 확장 팝업 이미지가 추가되었습니다.

검증: 격리 Chrome 합성 화면 304개, Node 라벨 로직 12개 통과. Space 이동 관련 32개는 공개 canvasView.ts의 native drag 이벤트 계약을 재현합니다. 회사 CVAT의 실제 이미지·주석 및 설치 확장에는 접근/적용하지 않았고, 배포 CVAT와의 통합 검증은 아직 하지 않았습니다.

## 1.7.3 · 화면으로 따라 하는 적용 가이드 (2026-10-08)

가이드를 업데이트 적용 → 확장 켜기 → 라벨 선택 → 단축키 지정 → 작업 중 사용 순서로 다시 썼습니다. 실제 확장 HTML/CSS/JS를 Chrome에서 실행하고 예시 라벨 및 모의 Chrome API를 사용하는 로컬 시연 상태를 캡처한 이미지 5장을 포함합니다. AI V와 브러쉬 B는 사용자가 지정하는 예시이며 고정 기본값이 아님을 설명합니다. ZIP 설치와 웹스토어 업데이트는 별도 안내합니다. 모든 가이드 이미지가 확장에 포함되어 오프라인에서 볼 수 있습니다. 기능 코드는 1.7.2와 동일합니다.

## 1.7.2 · 도구 창만 열리고 실행되지 않는 오류 수정 (2026-10-08)

CVAT의 팝오버 표시 처리에서 buttons=0인 합성 mousedown을 보냅니다. 기존 마우스 상태 추적이 이를 buttons || 1로 처리해 왼쪽 버튼을 누르는 중으로 기록했고, 1.7.0의 실행 전 확인 조건에 걸려 Interact/Shape를 누르기 전에 중단될 수 있었습니다. 버튼 없는 알림은 무시하고 실제 buttons 값이 있는 누름만 기록하도록 수정했습니다. 이 알림으로 기존 실제 누름 상태를 지우지도 않습니다.

AI/마스크 각각 같은 이벤트를 재현한 검사는 수정 전 실패, 수정 후 통과했습니다. 전체 합성 브라우저 검사 270개 및 Node 로직 검사 12개 통과. 실제 사용자 탭에서는 도구 메뉴와 라벨 선택창 구조 및 B로 창만 열리는 상태를 확인했습니다. 수정 파일을 사용자의 설치본에 적용한 뒤 실제 Interact/Shape 실행까지 검증한 것은 아닙니다.

## 1.7.1 · 라벨 선택 UI 통합 (2026-10-08)

라벨 드롭다운과 별도 선택 색상 표시를 제거했습니다. 색상칩과 이름이 함께 있는 단일 목록에서 선택하고, 선택된 행은 강조 테두리와 aria-pressed로 표시합니다. 선택 즉시 저장, 목록 새로고침, 직접 입력 대체 경로 및 Esc 후 도구 전환은 유지합니다. 합성 브라우저 검사 266개 및 로직 검사 12개 통과.

## 1.7.0 · Esc 후 도구 전환 (2026-10-08)

지정된 AI/새 마스크 단축키를 누르면 수정키 없는 Escape keydown/keyup을 먼저 전달하고, 활성 도구와 편집 도구상자가 해제된 것을 확인한 뒤 기존 기본 라벨 선택 및 Interact/Shape 동작을 실행합니다. 같은 도구 단축키를 새로 누른 경우에도 취소 후 다시 시작합니다. 키를 누르고 있는 동안의 자동 반복은 재실행하지 않습니다.

진행 중인 그리기·편집은 직접 Esc를 누른 것처럼 취소될 수 있습니다. 확장이 Finish/Save나 활성 도구 아이콘을 눌러 작업을 완료하지는 않습니다. CVAT가 합성 Escape를 처리하지 않거나 상태가 바뀌지 않으면 1.2초 후 안내하고 멈춥니다. 취소가 끝난 뒤 메뉴·라벨 준비는 별도의 1.2초 범위를 사용합니다. 입력/IME, 대화상자, 마우스 버튼을 누른 상태에서는 시작하지 않습니다. 대기 중 사용자 Esc, 설정·탭·작업·포커스 변경은 전환을 중단합니다.

검증: Chrome 합성 검사 266개 통과. 실제 Mousetrap 1.6.5 취소 바인딩을 포함하지만 Chrome 확장 API와 CVAT 상태 처리는 합성이며 실제 CVAT 버전의 통합 검증은 포함하지 않습니다. 아래 과거 버전의 'active tool/edit blocks activation' 설명은 이 버전에서 위 동작으로 대체되었습니다.

## 1.6.1 · 라벨 대표색 표시 (2026-10-08)

현재 작업의 라벨 색상칩을 읽어 선택한 라벨 옆과 ‘대표색으로 선택’ 목록에 표시합니다. 색상이 있는 항목을 누르면 기존 목록 선택과 같은 확인 절차를 거쳐 이름만 저장합니다. 색을 읽지 못한 경우 임의의 색을 지정하지 않고 색상 정보 없음으로 표시합니다. CVAT 오른쪽 Labels 탭을 열고 목록 새로고침으로 다시 읽을 수 있습니다. 색상도 전체 목록과 함께 일시적으로만 처리하며 저장하거나 전송하지 않습니다.

검증: 합성 Chrome DOM 검사 252개 및 Node 로직 검사 12개 통과. Chrome 확장 API는 대역이며 실제 CVAT와 실제 Mac 기기 검증은 포함하지 않습니다.

## 1.6.0 · 이 탭의 라벨 선택 (2026-10-08)

확장을 켜면 현재 CVAT 작업에 등록된 전체 클래스 목록을 읽습니다. 사용하지 않은 클래스도 표시하며 Overview의 합계 행은 제외합니다. 팝업에서 선택하면 기존 기본 라벨 설정에 이름만 저장합니다. 단축키와 휠 설정은 유지됩니다. 같은 이름이 여러 개면 선택을 막고, 목록을 읽지 못하면 Info → Overview를 연 뒤 목록 새로고침 또는 직접 입력을 사용할 수 있습니다.

목록은 현재 탭에서 그때그때 읽으며 저장하거나 전송하지 않습니다. 선택 직전에 탭 주소와 최신 목록을 다시 확인합니다. 선택한 이름은 기존과 같이 모든 탭의 두 단축키가 공유합니다. 새 작업에서 해당 이름을 사용할 수 없으면 임의의 라벨로 바꾸지 않습니다. 업데이트 후 CVAT 작업을 저장하고 페이지를 새로고침한 뒤 확장을 다시 켜세요.

## 1.5.0 · 한글 UI 및 내장 가이드 (2026-10-07)

- 팝업과 사용자 안내 메시지 한글화. 상단 ‘적용 가이드 · 기능 설명’에서 내장 guide.html을 새 탭으로 엽니다.
- 설치·업데이트·활성화·기능별 사용법·CVAT 기본 휠 버튼 드래그·문제 해결 안내를 제공합니다.
- 기존 설정 키와 권한은 그대로 유지합니다. 한글화 범위는 확장 UI이며 CVAT 자체 UI는 변경하지 않습니다.
- 기존 합성 검사 232개 통과. 실제 CVAT 및 실제 Mac 기기 검증은 포함하지 않습니다.
- 업데이트: 작업 저장 → 기존 확장 폴더 파일 갱신 → Chrome 확장 새로고침 → CVAT 새로고침 → 이 CVAT 탭에서 사용.
# CVAT Sidebar Shortcuts — 1.4.1

A small, dependency-free Chrome Manifest V3 extension with locally configurable tool shortcuts and mask-brush wheel sizing.

- **AI tool → Assign / Change / Clear**: open the AI Tools popup, select and verify the configured default label, then click **Interact** once.
- **New mask (Brush tool) → Assign / Change / Clear**: open Draw new mask, select and verify that default label, then click its mask **Shape** once.
- **Default label for new objects**: enter the exact CVAT label name and click **Save**. The initial value is `obstacle`, matching the label name supplied in the user's UI description; set `object` if that is the actual CVAT label name.
- **Brush size**: choose **Alt + wheel** (default) or **Shift + wheel**, and enable/disable it in the popup. Older saved Ctrl-wheel selections migrate to Alt; other settings stay saved.

Both keyboard shortcuts begin **Unassigned**. The popup records a physical key plus optional Ctrl/Alt/Shift/Meta modifiers. Escape cancels recording. A duplicate between the two keyboard assignments is rejected and the existing assignment stays intact. Settings use `chrome.storage.local`; reopening the popup or restarting Chrome retains them. The storage key is unchanged from 1.0.0, so upgrading preserves your existing shortcuts.

The two new-object shortcuts intentionally select the configured default label before starting. They preserve the AI model, bounding-box toggle, and other options. They do not switch AI tabs, press detector/automatic annotation, draw a stroke, save/continue a mask, finish a drawing, or relabel an existing annotation. **Interact** enters CVAT's normal interactive mode; subsequent user interactions use CVAT's existing model configuration and processing. Missing/hidden/disabled/ambiguous buttons or labels stop activation with local feedback.

The extension waits at most **1.2 seconds**, checking every 50 ms for one visible matching popup and button. It cancels if settings, focus, the route, or tool context change. Repeated keydown, pending activation, and a brief 250 ms cooldown prevent double execution. Active drawing and the shared mask-editing toolbox block AI/Shape activation so a shortcut cannot interrupt or finish your current mask.

## Reload the installed extension

The parent reports that the user installed an earlier version and confirmed both shortcuts opened the menus. The source in the same `extension/` directory is now **1.4.1**. This agent has not opened Chrome UI or company CVAT pages to apply the update.

1. Finish/save your current CVAT work using its normal controls before refreshing the job.
2. Open `chrome://extensions`, find **CVAT Sidebar Shortcuts**, and click its **Reload** icon. Keep the existing installation; do not remove/reinstall it.
3. **Refresh the CVAT job tab** to discard the old content script. Reloading only the extension is insufficient for an already open page.
4. Open the extension popup and click **Enable for this CVAT tab**. Your existing shortcut assignments should still be shown.
5. In the extension popup, confirm **Default label for new objects** (initially `obstacle`), or enter the exact intended name such as `object` and click **Save**. Choose your AI model/options normally in CVAT, then use the assigned key to select the default class and start.
6. In the popup's **Brush size** section, select Alt or Shift. With the Brush or Eraser active, place the pointer over the mask canvas and turn the wheel up/down.

After an ordinary job reload, a browser restart, or a new tab, Enable again; shortcut choices and wheel preferences remain saved. Chrome/Windows-reserved keys may never reach the extension. Choose keys that do not conflict with your CVAT/browser shortcuts.

Any agent-assisted visible Chrome test or desktop capture still requires advance notice and confirmation that confidential images are closed. No company page inspection or desktop capture was used for this update. Developer mode, permissions, and managed browser policy were not changed.

### 빠른 업데이트 / 사용 안내

CVAT 작업을 정상적으로 저장한 뒤 `chrome://extensions`에서 **CVAT Sidebar Shortcuts** 카드의 새로고침 아이콘을 누르세요. **CVAT 탭도 새로고침**한 다음 팝업에서 **Enable for this CVAT tab**을 누르면 됩니다. 기존 단축키와 휠 설정은 유지됩니다. **Default label for new objects**의 초기값은 `obstacle`입니다. 실제 라벨 이름이 `object`라면 입력하고 **Save**를 누르세요. 두 단축키는 해당 라벨을 정확히 선택·확인한 뒤 **Interact / Shape**를 누릅니다. 모델과 다른 옵션은 유지하며, 기존 마스크의 라벨은 바꾸지 않습니다.

브러쉬 크기는 팝업의 **Brush size**에서 **Alt + wheel** 또는 **Shift + wheel**을 선택하세요. 브러쉬/지우개가 활성화된 상태에서 마스크 캔버스 위에 포인터를 놓고 휠을 올리면 커지고 내리면 작아집니다. 새 마스크와 기존 마스크 편집은 같은 크기 컨트롤을 사용하므로 둘 다 지원합니다.


## Windows and Mac Chrome

On macOS, Alt is shown as Option and Meta as Cmd; Ctrl remains a separate modifier. Binding storage uses physical KeyboardEvent.code and exact modifier bits, so Option-generated letters do not change the key position. Unknown codes and IME/Dead key input are ignored. Likely browser/OS shortcut conflicts show a nonblocking advisory; some reserved shortcuts never reach the popup/page. Cmd release also recovers a binding if its letter keyup was absent. Ctrl/Cmd wheel and pinch stay native and clear partial sizing accumulation. The Mac behavior is simulated here and still needs actual Mac solo testing.

The Store ZIP has manifest.json at its root and contains only runtime files/icons. Extract it to a folder for a fresh local Mac test. Update an existing installation using its current extension folder to preserve identity/settings. See [Korean installation/usage](store/INSTALL-KO.md), [Store listing text](store/STORE-LISTING-KO.md), [privacy draft](store/PRIVACY-KO.md), and [readiness/blockers](store/READINESS.md). No upload or publication has occurred.

## CVAT shortcut conflicts and manual pilot

Version 1.4.1 moves handled keyboard/wheel interception to window capture. It stops an accepted press, its safe held repeats, and its normal nonmodifier release before the reviewed CVAT document-bubble Mousetrap handlers. Modifier releases still pass through so CVAT can clear its modifier state. Failures after a press is accepted do not replay the key to CVAT. Failed extension-owned label selection restores only the focus it took. Input/IME events, unsupported/disabled contexts, and fresh presses while drawing/editing remain unclaimed and can retain CVAT's own behavior.

The extension does not discover CVAT's current or custom bindings. Its duplicate check covers only its two assignments; reserved-key advisories cover likely Chrome/OS conflicts only. Compare your keys with CVAT Settings/Shortcuts and avoid overlap. Earlier same-window capture actions cannot be undone; earlier cancellation is respected. Actual installed CVAT and native OS gesture behavior still need a pilot check. See [public event audit](reference/shortcut-conflicts.md) and the [Korean manual pilot checklist](store/PILOT-KO.md).

## Exact default-label selection

The saved label name is shared by both new-annotation shortcuts. Matching is exact and case-sensitive; `object`, `Object`, and `obstacle` are distinct names. The extension opens only the label selector in the correct tool popup, follows its combobox's `aria-controls` to the owned listbox, and requires exactly one enabled option whose CVAT `data-label` equals the configured name. It verifies the selected label and dropdown closure before starting. It does not guess synonyms, fall back to `person`, or select labels from unrelated dropdowns.

If the name is missing, duplicated, disabled, or cannot be confirmed within the existing 1.2-second activation bound, no tool starts and local feedback explains the failure. Editing an existing mask blocks these new-object shortcuts; its label is left unchanged. Existing hotkeys and wheel preferences survive saving/changing the default label and upgrading from earlier versions.

## Brush-size wheel behavior

CVAT's public `BrushTools` component shares its size state and input between mask **DRAW** and existing-mask **EDIT** modes. The extension changes only this existing numeric DOM input through normal input/change events, letting CVAT update its own brush configuration. It does not call canvas APIs, read pixels, use React internals, synthesize pointer strokes, or toggle editing mode.

- Wheel up increases and down decreases by **1 pixel per normalized wheel step**, within **1–500 pixels** and any narrower DOM min/max bounds. CVAT itself has a minimum of 1; the extension's 500-pixel maximum is a conservative wheel-control limit. Manually entered sizes outside this range are left unchanged.
- Fractional trackpad deltas accumulate instead of changing size on every tiny event. Pixel, line, and page wheel modes are normalized; one event is capped at ten size steps.
- Only a visible shared mask toolbox, one active Brush/Eraser, one enabled size input, and a pointer hit inside the mask canvas qualify. Polygon mode, inactive/hidden controls, toolbox scrolling, fields, dialogs, IME, other routes, and other modifiers retain their usual behavior.
- Size changes are blocked while a mouse button is down, so an ongoing painting stroke is not resized.
- **Ctrl + wheel stays native**, including touchpad pinch and Ctrl combined with other modifiers. It is no longer a brush-size option. A saved Ctrl choice is treated as Alt immediately and persisted as Alt when the popup opens, preserving the enabled/disabled setting and other preferences.
- Shift-wheel events reported on the horizontal axis use their dominant direction once: negative motion increases and positive motion decreases the size. Ordinary horizontal scrolling and wheel input outside the active mask canvas remain unchanged.
- Use the checkbox to disable this feature immediately. Your existing CVAT Alt+right-drag size control remains available.

If a customized or older CVAT version lacks these reviewed DOM controls, wheel handling stays inactive. Installed behavior of this update still needs user verification; no confidential CVAT data was used to test it.

## Fresh installation, if needed

Open `chrome://extensions` in a safe window and choose **Load unpacked**, selecting:

`C:\git\cvat_shortcut\extension`

If Developer mode is off, obtain explicit approval before enabling it. Stop if managed policy blocks unpacked extensions; use the organization's approved process and do not bypass browser policy. Unexpected permission/security prompts require approval. This extension needs no all-sites access, file-URL access, or incognito access.

## Permissions and privacy

Only `activeTab`, `scripting`, and `storage` are declared, unchanged from 1.0.0. The explicit Enable button injects only into that tab, in Chrome's isolated world. There are no host permissions, automatic content-script matches, background worker, extension network requests, analytics, external resources, or library dependencies. The popup CSP blocks connections.

The extension checks the job path, sidebar/popup/toolbox classes, typing focus, visibility/disabled states, pointer geometry, the single brush-size numeric input, and label names in the correct popup's selector/listbox. It never reads image pixels, image URLs, canvas contents, annotation text, screenshots, files, credentials, or model responses. It stores shortcut/wheel preferences and the user-configured default label name locally and does not log/send page data. Normal CVAT interactive inference, when you later use that mode, follows CVAT's existing deployment and data-handling configuration.

## Synthetic validation

Run from this folder:

```powershell
node .\tests\run-tests.mjs
```

Node 24 and installed Chrome are sufficient; no npm dependencies are needed. Override `CVAT_TEST_CHROME` only to point at an approved existing Chrome executable if necessary.

The runner serves dummy DOM on `127.0.0.1` and launches separate headless Chrome profiles under `tests/.browser-profiles`, with background networking/sync/extensions disabled and external name resolution blocked. It does not connect to a running browser, read the user's profile, inspect current tabs, capture the desktop, or access a CVAT server. Chrome's browser sandbox remains enabled. This Windows execution sandbox blocks Chrome child processes; the successful runs use approved execution outside that outer sandbox with the same isolated test arguments.

**232 synthetic checks passed, 0 failed** in Windows Chrome **154.0.8037.93**: 134 Windows checks (57 activation, 21 popup, 33 wheel, 23 event-conflict) and 98 Mac metadata/input simulation checks (57 activation, 8 Mac popup, 33 wheel). Static manifest/permission/syntax/network-image API checks also passed. Chrome extension APIs and CVAT controls are mocked. The Mac suites run on Windows with simulated platform metadata/input; they are not actual Mac browser/hardware, installed-extension, or company-CVAT tests.

See [test-results.json](tests/test-results.json), [source-review.md](reference/source-review.md), and [INSTALLATION-STATUS.md](INSTALLATION-STATUS.md). The current ZIP is `cvat-sidebar-shortcuts-1.4.1-store.zip`; older ZIPs retain their earlier behavior.

## Files

- `extension/`: load-unpacked source (five source/UI files plus manifest and four generated generic PNG icons).
- `tests/`: image-free synthetic fixtures, API mocks, runner, and JSON evidence.
- `reference/`: public source review and public brush/canvas source snapshots.

Uninstall through Chrome's normal Remove action if requested. No CVAT server settings or files are modified.
