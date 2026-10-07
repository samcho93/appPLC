# 🔌 appPLC — PLC 래더 편집 · 현장 설비 시뮬레이터 (웹앱)

스마트폰 · 태블릿 · PC 브라우저에서 바로 쓰는 **PLC 래더 편집기 + 시뮬레이터**입니다.
래더를 그리고 RUN 하면 아래 조작판의 **버튼 · 램프 · 실린더 · 모터 · 컨베이어 · 탱크 · 센서**가 실제처럼 움직입니다.
강좌 사이트 [studyPLC](https://github.com/samcho93/studyPLC) (MELSEC) · [studyPLCLS](https://github.com/samcho93/studyPLCLS) (LS XGK) 의
PLC 에디터에서 **강좌를 빼고**, 같은 엔진 · 하드웨어 구성을 그대로 가져와 작은 화면에 맞게 다시 만들었습니다.

- 🌐 실행: <https://samcho93.github.io/appPLC/> (저장소 Settings → Pages → `main` / root)
- 📱 홈 화면에 추가하면 앱처럼 전체 화면 · 오프라인으로 실행됩니다 (PWA)

## 지원 기종 (강좌 사이트와 같음)

| | 미쓰비시 MELSEC Q | LS ELECTRIC XGK |
|---|---|---|
| 기본 구성 | Q61P · **Q03UDECPU** · Q35B | XGP-ACF2 · **XGK-CPUE** · XGB-M06A |
| 슬롯 0 · 1 | QX41 입력 32점 `X0~X1F` · QY41P 출력 32점 `Y20~Y3F` | XGI-D24A `P00000~P0001F` · XGQ-TR4A `P00020~P0003F` |
| 슬롯 2 · 3 | Q64AD (A/D 4채널) · Q62DAN (D/A 2채널) | XGF-AV8A (A/D 8채널) · XGF-DV4A (D/A 4채널) |
| 슬롯 4 | QJ71C24N 시리얼 2채널 | XGL-C22A Cnet 2채널 |
| 고를 수 있는 CPU | Q00UJ · Q02U · Q03UD(E/V) · Q04/06/13UDEH | XGK-CPUE/S/A/H/U · CPUSN/HN/UN |
| 베이스 · 모듈 | Q33B~Q312B · 입출력 16/32/64점 · Q68ADV/ADI · Q64DAN · Q68DAVN · QJ71C24N-R2/R4 | XGB-M04A~M12A · 전원 4종 · 8/16/32/64점 · AC · SSR · XGF-AC8A/AD8A/AD4S · DC4A/DV8A · C42A/CH2A |
| 표기 · 단축키 | GX Works2 (`LD X0` · `OUT T0 K30` · F5/F6/F7/F8/F9 · F4 변환) | XG5000 (`LOAD P00000` · `TON T0000 30` · F3/F4/F9/F10/F5/F6 · Ctrl+Enter 적용) |

위의 **🟥 MELSEC Q / 🟩 XGK** 를 눌러 기종을 바꿉니다 (주소 `?v=melsec` · `?v=xgk`).
모듈 탭에서 CPU · 베이스 · 슬롯 모듈을 추가 · 삭제 · 이동 · 교체하고, ⚙ 로 스캔 타임 · 입력 응답 시간 · A/D · D/A 범위 · 평균 처리 · 통신 속도 등을 설정합니다.

## 화면

```
┌ 🟥 MELSEC Q  제목      📄 📚 💾 📂 ⋯ ┐  ← 아이콘 메뉴
│ 🪜래더 📝리스트 🔌설비 🗄모듈 ✔검사 🔍모니터 │
│ ✎ ✔  ↶ ↷  ┤├ ┤/├ ┤├↓ … ( ) [ ] — │ 🗑 │  ← 래더 편집 도구 (아이콘, 옆으로 밀기)
│                                        │
│   래더 (가로 스크롤 없이 화면 폭에 맞춤)    │  ← 핀치 · ＋/－ 로 확대, 끌어서 이동
│  － 100% ＋ ⤢                           │
│ ● RUN  ⟲ ⏭ ×1  ERR       스캔 · 시간  🔌 │  ← RUN/STOP · 리셋 · 1스캔 · 속도
│ ═══════════════ (끌어서 높이 조절) ═══════ │
│ [기동] [정지] [램프] [실린더] [컨베이어] … │  ← 현장 설비: 스크롤 없이 모두 보이게 자동 축소
└────────────────────────────────────────┘
```

- 넓은 화면(가로 1000px 이상)에서는 PLC 모니터가 오른쪽에 붙습니다.
- **래더 편집 (터치)**: ✎ → 칸을 탭 → 도구 아이콘(┤├ ┤/├ ( ) [ ] …) → 입력창에 디바이스 · 명령 → ✔ 변환.
  같은 칸을 다시 탭하면 고치기. 오른쪽 칸이 모자라면 열이 자동으로 늘어납니다. 되돌리기 · 복사 · 붙여넣기 지원.
- **모니터**: 통전된 선 · 접점은 초록, 타이머 · 카운터 · 데이터 레지스터 현재값 표시. 접점을 탭하면 강제 ON/OFF.
- **현장 설비**: `PB` 푸시버튼 · `SEL`/`TGL` 스위치 · `EMG` 비상정지 · `LS`/`PROX`/`PHOTO` 센서 · `DSW` 디지털스위치 ·
  `LAMP` · `BUZ` · `SEG7` · `SOL` · `MC` · `CYL` 공압 실린더(편솔/양솔) · `MOTOR` · `CONV` 컨베이어 · `TANK` · `OVEN` ·
  `POT` · `USONIC` · `METER` · `TERM` 시리얼 터미널 · `BCR` 바코드 리더 (설비 탭의 「장비 목록」 참고)
- **예제**: 기본 예제 8개 + **강좌 실습 248개(MELSEC) · 249개(XGK)** 를 챕터별로 · 검색해서 바로 불러옵니다.
- **검사식**: `START=1 -> Y20=1` 처럼 동작을 자동 확인합니다.
- **파일**: 브라우저 저장 · `.plc` 프로젝트 · 명령어 리스트 `.txt` · GX Works2/XG5000 CSV 내보내기 · 공유 링크 (프로젝트가 주소에 담김) — 강좌 사이트 에디터의 `.plc` 파일과 호환됩니다.

## 파일 구성

```
index.html             앱 화면 (기종에 맞는 엔진만 골라서 불러옴)
css/app.css            모바일 우선 스타일 (라이트 / 다크)
js/app.js              앱: 탭 · 모듈 구성 · 예제 · 파일 · 설비 패널 자동 맞춤
js/ladderview.js       래더 화면 (기종 공용): 그리기 · 통전 표시 · 터치 편집 · 핀치 확대
js/melsec/*.js         MELSEC Q 엔진 (studyPLC 에서 가져옴) + vendor.js (표기 · 단축키)
js/xgk/*.js            LS XGK 엔진 (studyPLCLS 에서 가져옴) + vendor.js
js/*/examples.js       강좌 실습 예제 (자동 생성)
sw.js · manifest.webmanifest · icons/   PWA (오프라인 · 홈 화면 설치)
tools/                 harvest-examples.js · test.js · make-icons.js
```

## 개발

```bash
python -m http.server 8765          # http://localhost:8765
node tools/test.js                  # 두 기종 × 모든 예제: 해석 · 검사식 · 래더↔리스트 왕복 변환
node tools/harvest-examples.js ../studyPLC ../studyPLCLS   # 강좌가 바뀌면 예제 다시 모으기
node tools/make-icons.js            # 아이콘 다시 만들기
```

엔진(`core · modules · plant · ladder · sim · plantview · monitor · bridge · samples`)은 강좌 저장소의 `js/plc/` 와 같은 파일입니다.
엔진을 고쳤다면 강좌 쪽에서 복사해 오면 됩니다. 실제 PLC 연동(브리지)은 강좌 저장소의 `bridge/plcbridge.py` 를 PC 에서 실행해 씁니다.
