# 2.13.0 스켈레톤 location 일괄 변경

## 사용법

1. `C:\git\cvat_shortcut\extension`을 Chrome 확장 관리에서 다시 로드합니다. CVAT 작업을 저장하고 새로고침한 뒤 확장을 켭니다.
2. **화면 → 스켈레톤 location 일괄 변경**에서 `tag` 또는 `sticker`를 고릅니다.
3. **변경 대상 검사**로 현재 Job 전체의 변경 개수·이미 같은 값·제외 사유를 확인합니다.
4. **Job 전체에 적용** 후 CVAT에서 결과를 확인하고 저장합니다. 되돌리기는 객체별로 적용되며 CVAT 자동 저장 설정은 유지됩니다.

## 구현과 범위

- 현재 Job 라벨에서 이름이 location인 radio/select 속성과 실제 ID·선택값을 읽습니다. 라벨마다 ID가 달라도 처리하고 실제 값의 대소문자를 보존합니다. 임의 속성이나 새 선택값을 생성하지 않습니다.
- 현재 사용 흐름인 스켈레톤 Shape 부모의 location만 변경합니다. 현재 프레임뿐 아니라 Job의 모든 대상 프레임을 조회하며, 숨김/필터·그룹 여부는 대상을 제한하지 않습니다. 관절 location, 다른 부모 속성, 좌표·라벨·그룹·박스는 유지합니다.
- 이미 같은 값은 저장 호출을 생략합니다. 잠금/부분 관절 잠금·보호 객체, 삭제 프레임, 해당 속성/선택값이 없는 라벨은 제외하고 사유를 표시합니다. Track은 이번 기능 범위에서 제외하며 UI에 개수를 표시합니다.
- 주석 메모리의 export/get 및 프레임 메타데이터를 읽습니다. 검사 후 전체 데이터·잠금·속성 정의를 재확인하고 native ObjectState.attributes setter에 해당 ID 하나만 전달한 뒤 ObjectState.save()로 로컬 주석을 갱신합니다. CVAT의 기본 undo 이력을 사용합니다.
- 적용 후 모든 조회 객체의 값과 전체 export를 비교해 location 외 변경을 검사합니다. native 속성 편집으로 대상 source가 manual로 바뀌는 것은 허용합니다. 미저장 객체도 clientID로 처리합니다.
- Job·프레임 전환, 단회 토큰, 5분 만료, 동시 작업, 화면 갱신 지원 여부와 부분 실패를 처리합니다. 최대 2,000개 대상 프레임/20,000개 스켈레톤 Shape, 결과 목록은 첫 100건 표시입니다.
- 별도 서버 저장 호출·이미지 조회·외부 전송·새 권한은 추가하지 않았습니다. 저장은 CVAT의 사용자 저장/자동 저장 설정을 따릅니다.

## 검증

- DOM 회귀: 572 통과 / 0 실패
- location 실제 MV3: 8 통과 / 0 실패
- 화면 도구 실제 MV3: 14 통과 / 0 실패
- 그룹 실제 MV3: 8 통과 / 0 실패
- 문맥 만료: 1 통과 / 0 실패
- location 논리·서비스: 34 통과 / 0 실패
- 그룹 논리 회귀: 55 통과 / 0 실패
- 릴리스 자동화: 39 통과 / 0 실패
- 합계: 731 통과 / 0 실패

단위 검사는 라벨별 속성 ID/대소문자, Job 전체 범위, 기본 속성 merge, 다른 데이터 보존, native undo, 미저장 ID, 잠금·삭제·Track 제외, 변경된 검사 결과 차단, 중복 적용·동시 실행·부분 실패·HTTP 토큰 생성을 검사했습니다.

실제 MV3 검사는 생산 확장을 별도 Chrome 프로필에 로드해 tag/sticker 선택·검사·적용을 신뢰된 마우스 클릭으로 확인했습니다. 이후 객체 좌표·그룹·다른 속성·박스 보존, 값 되돌려 적용, 오래된 잠금 상태와 Job 전환도 검사했습니다. Strict Trusted Types 및 확장 문맥 만료 검사를 통과했습니다.

회사 CVAT의 실제 작업과 서버 저장 후 다시 열기 결과는 아직 검증하지 않았습니다. 위 검증은 합성 CVAT 계약 및 임시 Chrome 프로필에 한정됩니다.

[실제 확장 UI의 합성 예시 캡처](../tests/location-preview.png)

## 파일과 배포

- `extension/location-native.js`, `extension/location-panel.js`
- 공유 native 연결: `extension/group-native.js`; 표시/주입: `extension/view-tools.js`, `extension/popup.js`
- ZIP: `releases/2.13.0/cvat-sidebar-shortcuts-2.13.0-ko.zip` (43개 런타임 파일을 소스와 바이트 단위로 대조)
- GitHub CI에 location 단위·실제 MV3 검사를 추가했습니다. 이번 작업에서 푸시나 웹스토어 제출은 실행하지 않았습니다.

## 확인한 공식 소스

- [ObjectState 속성 setter와 save](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/object-state.ts)
- [Skeleton Shape의 부모·관절 저장 분리](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/annotations-objects/skeleton-shape.ts)
- [Track 속성의 mutable 처리](https://github.com/cvat-ai/cvat/blob/develop/cvat-core/src/annotations-objects/track.ts)
