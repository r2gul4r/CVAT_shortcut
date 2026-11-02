# 2.10.0 회전 사각형·스켈레톤 단축키 검증

## 구현

- 팝업에 **회전 사각형**, **새 스켈레톤**의 키 지정·변경·해제를 추가했습니다. 새 키는 미지정이며 기존 키·라벨 선택·설정을 유지합니다.
- 회전 사각형: Esc → 사각형 메뉴 → 고정 라벨 유지 → Rotated 선택 확인 → Shape. 2 Points/4 Points를 사용했더라도 단축키 실행 시 Rotated로 전환합니다.
- 스켈레톤: Esc → 스켈레톤 메뉴 → 고정 라벨 유지 → Shape.
- 두 도구는 CVAT에 지정된 고정 라벨을 유지합니다. 라벨 선택창을 열거나 라벨을 바꾸지 않으며, 오버레이에 다른 라벨을 선택했거나 라벨이 비어 있어도 실행합니다. 모든 도구·라벨 단축키 사이의 중복 지정 차단은 유지합니다.
- Shape 버튼은 해당 도구의 팝업 안에서만 찾습니다. 라벨 선택창은 비활성화되어 있거나 없어도 됩니다. Track·다른 도구 Shape는 클릭하지 않습니다.
- Rotated는 CVAT의 `Rotated points` 라디오 값을 확인합니다. 투명한 실제 input의 checked와 React가 반영한 Ant Design wrapper-checked를 모두 확인하고 시작합니다. 비활성·중복·누락·지연·거부 상태에서 다른 방식으로 대체하지 않습니다.
- N으로 사각형·스켈레톤을 다시 불러올 때도 기억된 라벨과 옵션을 그대로 사용합니다. 그리기 중 N 완료 동작을 유지하며 AI·마스크·폴리곤의 오버레이 연동은 유지합니다.
- 팝업의 오래된 표시 버전을 2.10.0으로 맞추고 manifest 버전과 일치하는지 테스트에 추가했습니다.
- 새 권한·이미지 조회·외부 전송을 추가하지 않습니다. 기존 사용자 동작처럼 도구를 시작하며, 확장이 도형을 자동으로 그리거나 저장하지 않습니다.

## 검증 결과

| 검사 | 통과 | 실패 |
|---|---:|---:|
| Chrome DOM 전체 회귀 (새 도구 36, N 연동 42, 팝업 추가 2 포함) | 520 | 0 |
| 설정·라벨 로직 | 12 | 0 |
| Chrome MAIN/ISOLATED 통신 | 17 | 0 |
| 실제 MV3 팝업·키 지정·주입·도구 시작 | 7 | 0 |
| 릴리스·배포 실패 처리 | 39 | 0 |
| 합계 | 595 | 0 |

실제 확장 검사에서는 별도 임시 Chrome 프로필의 합성 CVAT 화면에 생산 확장 소스 복사본을 로드했습니다. 복사본에만 localhost 접근을 허용했고 실제 확장 저장소·popup·ISOLATED world 주입·브라우저 키 이벤트를 검사했습니다. 개인 브라우저나 회사 데이터는 사용하지 않았습니다. 회사 CVAT 배포 버전과 OpenCV 초기화·실제 그리기 결과는 검증하지 않았습니다.

주요 검증: 2/4 Points에서 Rotated 전환, 이미 Rotated인 경우, 라디오 native checked가 먼저 변경되는 지연, 반영 거부·비활성·중복 옵션, 다른 오버레이 라벨·빈 라벨에서도 고정 라벨 유지, 단일 라벨의 비활성 선택창·선택창 없는 메뉴, 라벨 클릭 0회, N 재호출·완료 시 라벨과 옵션 유지, 기존 도구 취소, 입력칸·대화상자 보호, Esc·Job 이동 중단, 팝업 재열기 키 유지, 400px 팝업 정렬.

실제 확장 테스트는 팝업 HTML이 나타난 시점이 아니라 스크립트 초기화와 저장 설정 로딩이 완료된 시점에 키를 확인합니다. 이 테스트를 GitHub release 워크플로에도 추가했습니다.

## 공개 소스 확인

- [CVAT DrawShapePopover](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/draw-shape-popover.tsx): 도구별 Shape 버튼 및 Drawing method 라디오 구조.
- [CVAT CanvasModel](https://github.com/cvat-ai/cvat/blob/develop/cvat-canvas/src/typescript/canvasModel.ts): `RectDrawingMethod.ROTATED_POINTS = 'Rotated points'`.
- [CVAT DrawSkeletonControl](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/components/annotation-page/standard-workspace/controls-side-bar/draw-skeleton-control.tsx): 스켈레톤 도구·팝업 클래스.
- [CVAT DrawShapePopoverContainer](https://github.com/cvat-ai/cvat/blob/develop/cvat-ui/src/containers/annotation-page/standard-workspace/controls-side-bar/draw-shape-popover.tsx): 스켈레톤은 스켈레톤 타입 라벨만 사용하며 Rotated 시작은 CVAT의 OpenCV 초기화를 거칩니다.
- [Ant Design Radio](https://github.com/ant-design/ant-design/blob/master/components/radio/radio.tsx): input과 checked wrapper의 controlled 상태.

공개 develop/master 브랜치를 확인한 것이므로 회사에 설치된 CVAT와 DOM이 다르면 안내 후 중단할 수 있습니다.

## 적용

1. CVAT에서 작업을 저장합니다.
2. Chrome 확장 관리에서 로컬 `C:\git\cvat_shortcut\extension` 확장을 다시 로드합니다.
3. CVAT 페이지를 새로고침하고 확장을 켭니다.
4. **도구 단축키 → 회전 사각형 / 새 스켈레톤 → 지정**에서 원하는 키를 누릅니다.
5. 해당 도구 단축키를 누릅니다. CVAT에 지정된 사각형·스켈레톤 라벨을 그대로 사용하므로 오버레이에서 라벨을 바꿀 필요가 없습니다.

[실제 확장 팝업 캡처](../tests/new-shapes-popup-preview.png). 캡처의 R/K는 테스트에서 지정한 예시이며 기본 지정 키가 아닙니다.

배포 ZIP: `releases/2.10.0/cvat-sidebar-shortcuts-2.10.0-ko.zip`.

이 보고서는 로컬 구현과 검사 결과이며 웹스토어 배포 상태를 나타내지 않습니다.
