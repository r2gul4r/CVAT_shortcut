# 2.5.1 검수 HTTP 406 수정 검증

검수 조회의 `Accept: application/json`이 CVAT의 전용 응답 형식 `application/vnd.cvat+json`을 허용하지 않았습니다. 공식 CVATAPIRenderer와 같은 응답 형식 조건을 적용한 테스트에서 기존 코드의 `CVAT 조회 실패 (HTTP 406).`를 재현했습니다. 사용자의 실제 서버 요청은 직접 확인하지 않았습니다.

`Accept`를 `application/vnd.cvat+json, application/json;q=0.9`로 수정했습니다. Job·라벨·프레임 메타데이터·주석 조회 모두 공통 함수로 적용되며, 일반 JSON 서버도 지원합니다. 추가 요청이나 자동 재시도는 없습니다. 권한과 저장 데이터 범위는 기존과 같습니다.

## 검증 결과

- 수정 전 새 회귀 검사: 48개 중 47개 통과, CVAT 전용 JSON 협상 검사만 HTTP 406으로 실패.
- 수정 후 로직·API 검사: 48/48 통과. 전용 JSON 및 일반 JSON 응답에서 전체 조회 완료, 실패 시 성공 결과를 만들지 않는 동작을 확인했습니다.
- 실제 Chrome MV3 확장 통합 검사: 17/17 통과. 같은 로컬 서버가 기존 헤더에는 406을 반환하고, 수정한 확장에서는 라벨 목록·검사·프레임 이동·결과 유지가 동작했습니다.
- 릴리스·패키징 검사: 39/39 통과.
- 이번 수정 관련 검사 합계: **104 통과, 0 실패**. 기존 2.5.0의 전체 670개 검사를 이번에 모두 재실행한 것은 아닙니다.

테스트는 별도 Chrome 프로필과 합성 CVAT 화면/데이터를 사용했습니다. 사내 이미지·주석 및 개인 브라우저에는 접근하지 않았으며, 설치된 사내 CVAT에서 최종 확인은 필요합니다. 2.5.0의 기존 모의 서버는 응답 형식 협상을 검사하지 않아 이 문제를 놓쳤고, 이번에 그 조건을 추가했습니다.

## 적용

로컬 확장 폴더는 `C:\git\cvat_shortcut\extension`입니다. Chrome 확장 관리에서 이 확장을 새로고침한 다음 팝업 버전 **2.5.1**을 확인하고 **검수** 탭에서 라벨 목록을 다시 불러오세요. 전체 프레임 검사는 CVAT에서 작업을 저장한 뒤 실행합니다.

패키지: `releases/2.5.1/cvat-sidebar-shortcuts-2.5.1-ko.zip`. 33개 런타임 파일과 SHA-256은 같은 폴더의 `build-audit.json`에 기록합니다. 이 수정본은 로컬 빌드이며 GitHub 푸시 또는 스토어 제출은 이번 작업에서 실행하지 않았습니다.

근거: [CVAT의 JSON renderer](https://github.com/cvat-ai/cvat/blob/develop/cvat/apps/engine/renderers.py), `tests/test-review.cjs`, `tests/run-review-extension.mjs`, `tests/review-extension-results.json`.
