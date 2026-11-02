# 2.11.0 라벨 숨김·화면 정렬 검증

## 사용법

1. CVAT 작업을 저장하고 Chrome 확장 관리에서 `C:\git\cvat_shortcut\extension`을 다시 로드합니다. CVAT 페이지도 새로고침하고 확장을 켭니다.
2. **라벨 선택 → 눈 버튼**으로 해당 라벨을 숨깁니다. 새 객체의 라벨 선택은 바뀌지 않습니다.
3. **화면 → 격자 표시**를 켜고 선 간격·선명도·색상을 고릅니다.
4. **−1° / +1°**, 또는 정수 각도 입력 후 **적용**으로 바코드를 수평선에 맞춥니다. 스켈레톤 단축키로 시작합니다.
5. **0° 복귀**, **숨김 모두 해제**로 복구합니다. 각도는 현재 프레임만, 숨김·격자는 현재 Job에 적용됩니다.

## 구현과 범위

- 숨길 라벨 ID와 격자 설정은 서버 주소·Job 경로별 Chrome 로컬 저장소에 보관합니다. 다른 Job으로 이동할 때 새 설정을 읽습니다.
- 현재 표시된 객체의 hidden 상태를 적용하고 프레임 이동·신규 객체·라벨 변경 때 다시 반영합니다. Job 전체 데이터를 미리 다운로드하지 않습니다.
- 확장이 변경한 hidden 값을 기억해 해제 시 복원합니다. 기존 수동 숨김과 스켈레톤 일부 관절의 숨김은 보존합니다. Shape·Track을 표시할 때 적용하며 Tag는 제외합니다.
- CVAT 기본 `rotate`는 90도로 반올림하고 기본 zoom/fit 계산도 직각 회전을 가정합니다. 지원되는 CanvasModel 인스턴스에서 geometry와 native notify를 사용하고 임의 각도용 zoom/fit 계산을 함께 적용합니다. 그림의 CSS만 독립적으로 돌리지 않습니다.
- 프레임 각도는 CVAT의 현재 세션 `frameAngles`에 반영합니다. `rotateAll:false`로 다른 프레임은 바꾸지 않습니다. 원본 이미지·기존 객체 points·속성·라벨은 변경하지 않으며 annotation save나 HTTP 쓰기를 호출하지 않습니다.
- 각도 변경은 idle 상태에서만 허용합니다. 스켈레톤·벡터 좌표는 CVAT의 SVG 좌표 변환을 사용합니다. 브러쉬·마스크 편집·AI 상호작용은 0도로 복귀한 뒤 시작합니다.
- 격자는 canvas wrapper 안의 pointer-events:none 요소이며 화면 축에 고정됩니다. 원본 이미지 회전·확대와 독립적인 화면 픽셀 간격을 유지합니다.
- 일시정지·확장 문맥 만료·Job 변경 때 표시 상태와 임시 메서드를 복구합니다. 진행 중인 그리기가 있으면 idle 이후 복구합니다. 백그라운드 탭 복귀 시 연결 갱신 대기 시간을 둡니다.
- 화면 UI와 눈 아이콘은 DOM API로 생성하며 Trusted Types 정책을 우회하지 않습니다. 새 권한은 없습니다.

## 검사 결과

| 검사 | 통과 | 실패 |
|---|---:|---:|
| dom | 552 | 0 |
| display_mv3 | 9 | 0 |
| shapes_mv3 | 7 | 0 |
| review_mv3 | 45 | 0 |
| bulk_mv3 | 15 | 0 |
| execution_worlds | 17 | 0 |
| label_logic | 12 | 0 |
| context_reload | 4 | 0 |
| health_review_bulk_logic | 164 | 0 |
| release | 39 | 0 |
| 합계 | 864 | 0 |

새 기능 DOM 검사 32개는 전체 DOM 수에 포함됩니다. 별도 실제 MV3 검사 9개에서는 생산 확장 복사본을 임시 Chrome에 로드하고 실제 팝업 활성화·마우스 클릭·저장·주입·Job 이동·일시정지를 확인했습니다. 회전 입력 거부와 렌더링 예외의 롤백, 기존 90도 버튼과의 병행, 적응형 확대, 최소·최대 확대, 부분 관절 숨김 복원도 검사했습니다.

SVG 화면 좌표의 역변환은 1e-7 픽셀 이내에서 확인했습니다. 회전 후 확대 시 기준점의 화면 이동은 브라우저 CSS 위치 반올림을 포함해 0.05 CSS 픽셀 미만을 확인했습니다. 이는 합성 SVG/CanvasModel 계약 검사이며 회사에 설치된 CVAT의 실제 스켈레톤 생성·저장 결과 검증은 아닙니다.

## 실제 적용 전 남은 확인

회사 CVAT의 배포 버전, private CanvasModel 구조, 실제 스켈레톤 템플릿 및 생성 결과는 아직 확인하지 않았습니다. 지원 구조를 확인하지 못하면 화면 탭에서 안내하고 각도 변경을 막습니다. 초기 실사용에서는 바코드 하나로 회전 → 스켈레톤 → 0° 복귀 후 위치를 확인해야 합니다.

[합성 화면의 실제 확장 캡처](../tests/view-tools-preview.png). 회사 작업 화면 캡처가 아닙니다.

## 공식 소스 근거

- [CanvasModel 회전·확대·geometry](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/canvasModel.ts)
- [CanvasView 좌표 변환](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/canvasView.ts)
- [스켈레톤 drawHandler](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/drawHandler.ts)
- [라벨별 숨김 처리](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/containers/annotation-page/standard-workspace/objects-side-bar/label-item.tsx)

로컬 ZIP: `releases/2.11.0/cvat-sidebar-shortcuts-2.11.0-ko.zip`. GitHub 푸시·웹스토어 제출은 이 작업에서 실행하지 않았습니다.
