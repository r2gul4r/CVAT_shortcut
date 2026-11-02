# 2.14.0 이미지 미리 받기

## 사용법

1. `C:\git\cvat_shortcut\extension`을 Chrome 확장 관리에서 다시 로드합니다. CVAT 작업을 저장한 뒤 페이지를 새로고침하고 확장을 켭니다.
2. 오버레이 **화면 → 이미지 미리 받기**에서 한도를 선택하고 **이 Job 이미지 미리 받기**를 누릅니다.
3. 준비한 프레임 수·압축 캐시 사용량·재사용 횟수를 확인합니다. 라벨 선택/검수 등 다른 오버레이 탭으로 바꿔도 계속 받습니다.
4. **중지**는 추가 다운로드만 멈추며 이미 받은 캐시는 유지합니다. 다시 시작하면 남은 묶음을 받습니다. **캐시 비우기**는 미리 받기를 중지하고 확장 캐시를 비웁니다. CVAT 자체 디코딩 캐시는 별도입니다.

## 구현

- MAIN world에서 현재 Job의 `frames.chunk`에만 래퍼를 설치합니다. CVAT 기본 `frames.get`의 청크 콜백이 `this.frames.chunk(...)`를 호출하므로 정상 프레임 이동도 캐시를 사용합니다. 일반 fetch/XHR 또는 다른 Job의 API를 바꾸지 않습니다.
- `frames.frameNumbers()`와 `dataChunkSize`로 실제 묶음 수를 계산합니다. 현재 프레임부터 앞으로 받은 뒤 앞부분을 채웁니다. 프레임 번호를 바꾸거나 주석을 조회/수정/저장하지 않습니다.
- 압축 이미지 묶음만 보관합니다. 주변 프레임 압축 해제는 CVAT 기본 prefetch/decoder를 유지하며, 백그라운드에서 `.data()`를 호출해 현재 화면의 디코딩 요청과 경쟁하지 않습니다.
- 백그라운드 요청은 하나씩 보내며 요청 사이에 150ms를 둡니다. 다음 요청을 보내기 전 현재 프레임 요청·저장·재생을 확인해 대기합니다. 이미 진행 중인 native 요청은 취소하지 않으며 중지 후 완료될 수 있습니다.
- 기본 512 MiB, 선택 256/512/1024 MiB입니다. 압축 캐시 한도이며 CVAT 디코딩/GPU 메모리와 진행 중인 네트워크 응답·복사본은 별도입니다. 한도를 넘는 묶음은 보관하지 않고 백그라운드를 중지합니다. 전경 요청은 오래 사용하지 않은 묶음을 정리하며 한도 안에서 보관합니다.
- 같은 묶음의 동시 요청은 다운로드를 공유합니다. 캐시 원본을 decoder에 넘기지 않고 복사본을 돌려줘 transferable ArrayBuffer detach로 캐시가 파괴되는 문제를 방지합니다.
- Job 인스턴스·경로 변경, 페이지 종료, 확장 비활성/컨텍스트 만료 시 캐시를 비우고 native 함수를 복원합니다. 확장 생존 확인이 10초 이상 끊겨도 정리합니다. Chrome의 백그라운드 탭 제한으로 미리 받기가 정리될 수 있으며 돌아와 다시 시작할 수 있습니다.
- 일반 annotation Job을 지원합니다. 확인할 수 없는 API, 비정상 프레임 목록 및 ground_truth Job은 실행하지 않습니다. 항목은 보관 시점부터 30분 뒤 만료됩니다. 서버에서 원본 이미지를 교체했다면 캐시를 수동으로 비워야 합니다. 원본 교체에 대한 별도 metadata 감시는 이번 범위에 포함하지 않았습니다.
- 이미지 바이트는 DOM 브리지를 통과하지 않습니다. 현재 CVAT의 기존 인증/요청 경로로만 읽고, 디스크 저장·외부 전송·새 권한 요청은 없습니다.

## 검증

- 캐시 서비스 단위: 21 통과 / 0 실패.
- 실제 MV3와 로컬 합성 서버: 12 통과 / 0 실패. 10프레임/5청크를 받아둔 뒤 native 소비자가 두 번 요청해도 다운로드가 5회로 유지됨을 확인했습니다. 두 호출 모두 반환 버퍼를 transfer/detach했습니다.
- 기존 DOM 회귀: 572 통과 / 0 실패.
- 실제 확장 reload 문맥 종료: 1 통과 / 0 실패. 추가로 새 MV3 검사에서도 활성 캐시의 native 래퍼 해제를 검증했습니다.
- 릴리스 자동화 단위: 39 통과 / 0 실패.
- 합계 645 통과 / 0 실패. 릴리스 안내·생성 뷰 일치 및 `git diff --check` 통과. ZIP 45개 런타임 파일을 소스와 바이트 단위로 대조했습니다.

회사 CVAT 버전에서의 실제 이미지 디코딩·응답 속도·장시간 메모리는 아직 검증하지 않았습니다. 합성 테스트의 다운로드 감소를 회사 환경의 속도 개선 수치로 해석하면 안 됩니다. 주석 표시 비용이나 이미지 압축 해제 시간은 남을 수 있습니다.

## 참조와 파일

- 공식 [session 구현](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/session-implementation.ts)의 `Job.prototype.frames.get` 청크 콜백 및 `frames.chunk` 구현.
- 공식 [session](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/session.ts)의 인스턴스 frames API 바인딩.
- 공식 [frames](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/frames.ts)의 `getJobFrameNumbers`, `FrameData.data`, 기본 prefetch와 디코딩 캐시 제한.
- `extension/prefetch-native.js`, `extension/prefetch-panel.js`; 주입 `popup.js`, 라이프사이클 `view-tools.js`.
- UI 캡처: `tests/prefetch-preview.png` (실제 확장, 합성 CVAT 예시).
- ZIP: `releases/2.14.0/cvat-sidebar-shortcuts-2.14.0-ko.zip`.
- 이번 작업에서는 GitHub 푸시/웹스토어 제출을 하지 않았습니다.
