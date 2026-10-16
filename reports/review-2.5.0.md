# 2.5.0 필수 라벨 검수 검증 보고서

## 결과

총 **670개 통과, 0개 실패**. 로컬 구현·패키징 결과이며 회사에 설치된 CVAT와의 실사용 검증 또는 웹스토어 게시를 뜻하지 않습니다.

| 검사 | 통과 |
|---|---:|
| 기존 Chrome 합성 회귀 검사 | 478 |
| 기존 연결 상태 로직·서비스 워커 | 45 |
| 라벨 로직 | 12 |
| 실제 Chrome MAIN/ISOLATED 실행 영역 | 17 |
| 실제 Chrome 확장 연결 상태 기능 | 19 |
| 배포·패키징 단위 검사 | 39 |
| 새 검수 로직·API 오류 처리 | 45 |
| 새 검수 실제 Chrome 확장 통합 | 15 |

별도 임시 Chrome 프로필과 localhost 예시 Job을 사용했습니다. 실제 확장 통합 검사는 테스트 복사본에 localhost 호스트 접근만 미리 허용했습니다. 회사 이미지·라벨링·개인 브라우저 프로필은 읽지 않았습니다. Chrome 권한 허용 창과 실제 CVAT React 구현은 통합 검증에 포함하지 않았습니다. 실행 영역과 Chrome API는 실제 환경이고, CVAT Redux·프레임 입력은 모의 화면입니다.

## 구현

- 검수 탭을 사용자가 열 때 Job·라벨 목록을 조회하고, 검사 버튼에서 프레임 메타데이터와 저장된 주석을 읽습니다. 서버 origin과 Job 경로를 매 요청 및 응답 후 확인합니다.
- 고정된 같은 origin의 GET만 사용합니다. 리디렉션을 따르지 않으며 라벨 페이지네이션의 외부 `next` 주소도 사용하지 않습니다. HTTP 오류·HTML 로그인 응답·불완전 형식은 실패로 표시합니다.
- API 응답의 Shape·Track 존재 구간으로 검사합니다. `Outside`, 삭제 프레임, step 및 원본 프레임 오프셋을 반영하고 CVAT 화면 번호를 보존합니다. 숨김·필터·잠금은 객체 존재를 지우지 않습니다.
- `A/B/C/D` 100프레임 예시에서 D가 없는 45번만 정확히 찾는 단위 검사와, B=12·D=45 및 삭제 88번이 있는 실제 확장 통합 검사를 통과했습니다.
- 라벨별 누락과 중복을 제외한 누락 프레임 수, 라벨 필터, 30개 단위 목록, 이전·다음 이동, 텍스트 복사·CSV 저장을 제공합니다. CSV의 수식 시작 문자와 따옴표를 처리합니다.
- 프레임 이동은 CVAT의 기본 입력 이벤트 경로를 사용합니다. 이동 완료를 실제 상태에서 확인하며 그리기·재생·로딩·저장 중에는 차단합니다. API로 주석을 쓰거나 Redux 변경 액션을 보내지 않습니다.
- 검사 중 팝업 종료 및 재열기를 포함해 마지막 결과와 Job별 선택 유지가 확인되었습니다. 선택 변경 시 지난 결과를 무효화하고, 오류 뒤에 이전 성공을 새 결과로 표시하지 않습니다.
- 로컬 보관은 필수 라벨 ID와 결과의 이름·색·누락 프레임·검사 시각 등 요약에 한정합니다. 원본 좌표·마스크·속성·이미지는 보관하거나 외부로 전송하지 않습니다.

## 적용과 한계

Chrome 확장 관리에서 로컬 `C:\git\cvat_shortcut\extension`을 새로고침하고 **검수 → 필수 라벨 선택 → CVAT 저장 → 저장 확인 체크 → 전체 프레임 검사** 순서로 사용합니다. 수정·저장 후에는 다시 검사해야 합니다. 검사 결과는 저장된 데이터의 한 시점이며 변경 내용을 실시간으로 추적하지 않습니다.

Tag, Skeleton Track, 모양·경계·손잡이 같은 세부 누락과 객체 수 검수는 지원하지 않습니다. 프레임마다 최소 한 객체의 존재만 판단합니다. 별도 수동 예외 지정은 없습니다. 내부 프레임 연결을 지원하지 않는 CVAT에서는 누락 번호를 직접 입력해 이동할 수 있습니다.

최대 20만 프레임, 200개 선택 라벨, 1천만 프레임-라벨 조합, 응답 64MB, 저장 결과 2MB, CSV 누락 20만 행으로 제한합니다. 데이터가 크거나 지원되지 않는 형식이면 성공으로 처리하지 않습니다. 검사 중 CVAT 새로고침·Job 이동이 있었다면 다시 실행해야 합니다.

## 산출물과 근거

- `extension/review-core.js`: 순수 존재·범위·번호 계산
- `extension/review-api.js`: 같은 서버 GET 조회 및 결과 보관
- `extension/review-native.js`: 상태 확인과 기존 프레임 입력
- `extension/review-popup.js`: 검수 UI와 Job별 선택
- `tests/test-review.cjs`: 45개 로직·API 검사
- `tests/review-extension-results.json`: 실제 Chrome 통합 15개 결과
- `tests/review-popup-preview.png`, `tests/review-results-preview.png`: 예시 라벨을 사용한 실제 확장 팝업 캡처
- `releases/2.5.0/build-audit.json`: 최종 33개 런타임 파일 및 ZIP 해시

공식 자료에서 Job·annotation·metadata 조회 API와 프레임 번호 변환, Track 존재 구간, 프레임 입력 경로를 확인했습니다. 설치된 사내 CVAT의 동일 동작을 증명하는 자료는 아닙니다.

- [CVAT Jobs API](https://docs.cvat.ai/docs/api_sdk/sdk/reference/apis/jobs-api/)
- [프레임 번호와 메타데이터](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/frames.ts)
- [Track 상태](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/annotations-objects/track.ts)
- [프레임 이동 UI](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/top-bar/player-navigation.tsx)
