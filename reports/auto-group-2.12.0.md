# 2.12.0 박스·스켈레톤 자동 그룹화

## 사용법

1. Chrome 확장 관리에서 `C:\git\cvat_shortcut\extension`을 다시 로드합니다. CVAT 작업을 저장한 뒤 페이지를 새로고침하고 확장을 켭니다.
2. 오버레이 **화면 → 박스·스켈레톤 자동 그룹화**에서 **현재 프레임** 또는 **현재 Job 전체**를 선택합니다.
3. **그룹 대상 검사**로 박스 ID·스켈레톤 ID와 제외 사유를 확인합니다.
4. **매칭된 대상 그룹화**로 박스별 그룹을 만듭니다. CVAT에서 결과를 확인하고 저장합니다. 되돌리기는 그룹별로 적용됩니다.

## 판정과 적용

- 회전 박스 중심을 기준으로 각 관절을 역회전하여 원본 사각형 내부인지 검사합니다. 화면 회전·확대·이동과 독립적입니다. 경계선 위의 점은 포함합니다.
- 모든 관절이 하나의 박스에 포함될 때만 매칭합니다. 여러 스켈레톤이 같은 박스에 있으면 한 그룹에 포함하고, 빈 박스는 변경하지 않습니다.
- 여러 박스에 동시에 포함되면 추측하지 않습니다. 기존 그룹·잠금·보호 객체·Track 또는 Outside/손상된 관절은 제외합니다. 박스에 매칭된 스켈레톤 중 하나라도 기존 그룹·잠금·보호 상태이면 해당 박스의 매칭 전체를 제외합니다.
- 숨김/필터는 포함 판정을 바꾸지 않습니다. native `annotations.get(frame, false, [])`로 읽으며, `frames.get(frame).deleted`로 삭제 프레임을 제외합니다. 이미지의 `data()`를 호출하지 않습니다.
- Job 전체는 주석이 있는 대상 프레임만 검사합니다. 최대 2,000개 프레임·5,000개 그룹, 목록은 첫 100건 표시이며 적용 범위는 요약에 나온 매칭 전체입니다.
- 검사 결과는 Job·프레임·단회 토큰·5분 만료에 묶입니다. 적용 직전 전체 주석 스냅샷 및 native 좌표·잠금·그룹을 다시 확인합니다. 검사 후 내용이 바뀌면 적용하지 않습니다.
- native `job.annotations.group(members, false)`로 새 그룹과 CVAT 되돌리기 이력을 만듭니다. 적용 후 대상/비대상 상태와 전체 주석 모양·라벨을 비교합니다. UI 갱신 실패는 적용 전에 감지합니다. 중간 오류는 일부 적용 가능성을 명시합니다.
- 기존 미저장 Shape도 현재 CVAT 메모리 상태로 검사할 수 있습니다. 별도 annotation save나 REST 쓰기를 호출하지 않으며 CVAT 자동 저장 설정은 그대로 적용됩니다. 추가 권한은 없습니다.

## 검사 결과

| 검사 | 통과 | 실패 |
|---|---:|---:|
| DOM 회귀 | 563 | 0 |
| 그룹화 실제 MV3 | 8 | 0 |
| 화면 도구 실제 MV3 | 12 | 0 |
| 도구 단축키 실제 MV3 | 7 | 0 |
| 문맥 만료·다시 로드 | 1 | 0 |
| 그룹 논리·서비스 | 55 | 0 |
| 릴리스 자동화 | 39 | 0 |
| 합계 | 685 | 0 |

그룹 전용 검사는 회전/경계/중심만 내부인 오판 방지, 빈 박스 보존, 1:N 매칭, 겹침·잠금·기존 그룹·Track·삭제 프레임 제외, 현재/전체 범위, 미저장 객체, native undo, live group getter, 재실행, 오래된 결과/동시 실행/부분 실패를 포함합니다.

실제 MV3 검사는 생산 확장을 별도 Chrome 프로필에 로드하고 신뢰된 마우스 클릭으로 검사·적용·중복 방지·잠금 변경 차단·Job 전체 그룹화·Job 이동을 확인했습니다. localhost 테스트에만 사이트 권한을 미리 부여했습니다. Strict Trusted Types 페이지에서 다시 로드 정리도 통과했습니다.

## 검증 범위와 배포

합성 CVAT 객체/스토어 계약과 별도 Chrome 검증입니다. 회사 CVAT에서 실제 그룹 생성 → 저장 → 다시 열기 결과는 아직 확인하지 않았습니다. 실제 데이터로 처음 사용할 때 작은 현재 프레임에서 빈 박스와 기존 그룹이 유지되는지 확인해야 합니다.

[실제 확장 UI의 합성 예시 캡처](../tests/group-preview.png)

- 소스 연결: `extension/group-native.js`, `extension/group-panel.js`, `extension/view-tools.js`, `extension/popup.js`
- ZIP: `releases/2.12.0/cvat-sidebar-shortcuts-2.12.0-ko.zip` (런타임 41개 파일 소스 대조)
- GitHub 푸시·웹스토어 제출은 이번 작업에서 수행하지 않았습니다. GitHub 워크플로에는 그룹 단위·MV3 검사를 추가했습니다.

## 확인한 공식 소스

- [Job native group 연결](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/session-implementation.ts)
- [그룹 번호 할당과 되돌리기 이력](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/annotations-collection.ts)
- [ObjectState 그룹의 live ID](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/annotations-objects/annotation-common.ts)
- [프레임 metadata와 image data 분리](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/frames.ts)
