/* 제조사 설정 — 미쓰비시 MELSEC Q 시리즈 (GX Works2 식 표기 · 단축키)
 *  공용 래더 편집기(js/ladderview.js) · 앱(js/app.js) 이 제조사마다 다른 부분을 여기서 읽는다.
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  PLC.VENDOR = {
    id: 'melsec',
    name: 'MELSEC Q',
    maker: '미쓰비시 MELSEC',
    tool: 'GX Works2',
    icon: '🟥',
    /** 시작 접점 명령 (비교 접점 · 입력창 표시에 쓴다) */
    ld: 'LD',
    /** 반전 · 에지 요소 (ops 없는 접점) 와 그림 기호 */
    inv: { INV: { sym: '/', label: 'INV' }, MEP: { sym: '↑', label: 'MEP' }, MEF: { sym: '↓', label: 'MEF' } },
    /** 비교 접점 입력: "= D0 K5" · "D= D0 K5" · "E< E1.5 D0" */
    cmpRe: /^(D|E)?(=|<>|>=|<=|>|<)\s+(.+)$/,
    /** 출력 상자 아래에 현재값을 표시할 디바이스 */
    valRe: /^(D|W|R|SD|Z|T|ST|C)/i,
    /** 코일로 그리는 출력 명령 (타이머 · 카운터 OUT 은 상자) */
    coilOps: { OUT: 1, SET: 1, RST: 1, PLS: 1, PLF: 1, FF: 1, MC: 1 },
    isTimerOp: (op, ops) => op === 'OUT' && ops.length > 1 && /^(T|ST|C)/i.test(ops[0]),
    /** 타이머 · 카운터 판정과 번호 */
    isTC: (o) => o.kind === 'dev' && (o.dev === 'T' || o.dev === 'ST' || o.dev === 'C'),
    tcIndex: (o) => o.addr,
    /** 비트 디바이스 (현재값 ON/OFF 로 보여 줄 것) */
    isBitOperand: (o) => o.kind === 'dev' && !!PLC.DEV[o.dev] && !!PLC.DEV[o.dev].bit && o.bit == null,
    /** 값 표시를 하지 않을 피연산자 종류 */
    noValueKinds: ['k', 'e', 'str', 'ptr', 'nest', 'unit'],
    /** 모니터 중 접점을 눌러 강제로 바꿀 수 있는 디바이스 */
    forceDevs: ['X', 'M', 'L', 'Y', 'B'],
    /** 편집 키 (GX Works2) — 도구 모음과 도움말에 표시 */
    keys: {
      NO: 'F5', OR: 'sF5', NC: 'F6', ORNC: 'sF6', P: 'sF7', F: 'sF8', coil: 'F7', app: 'F8', H: 'F9', V: 'sF9', delV: 'F10', convert: 'F4'
    },
    convertName: '변환',
    /** 키 입력 → 편집 동작 */
    keymap(e) {
      const k = e.key, sh = e.shiftKey, ct = e.ctrlKey || e.metaKey;
      if (k === 'F4') return { act: 'convert' };
      if (k === 'F5') return { act: 'ask', kind: sh ? 'OR' : 'NO' };
      if (k === 'F6') return { act: 'ask', kind: sh ? 'ORNC' : 'NC' };
      if (k === 'F7') return sh ? { act: 'ask', kind: 'P' } : { act: 'out', preset: 'OUT ' };
      if (k === 'F8') return sh ? { act: 'ask', kind: 'F' } : { act: 'out', preset: 'MOV ' };
      if (k === 'F9') return { act: 'put', kind: sh ? 'V' : 'H' };
      if (k === 'F10') return { act: 'put', kind: 'delV' };
      if (ct && k === 'Enter') return { act: 'convert' };
      return null;
    },
    /** 입력창 도움말 */
    hints: {
      contact: '예: X0 · M10 · T0 · LDP X1 · >= D0 K100',
      out: '예: OUT Y20 · SET M0 · OUT T0 K30 · RST C0',
      app: '예: MOV K100 D0 · + D0 D1 D2 · INC D0 · BCD D0 K4Y30'
    },
    /** 새 프로그램 */
    defaultProject: (rack) => `[title]
새 프로그램

[rack]
${rack}

[io]
PB START X0 label=기동 color=green
PB STOP X1 nc=1 label=정지 color=red
LAMP RUN Y20 color=green label=운전등

[program]
; 기동 · 정지 자기유지
LD X0
OR Y20
AND X1
OUT Y20
END

[test]
START=1 -> Y20=1
START=0 -> Y20=1
STOP=1 -> Y20=0
`,
    ioExample: 'PB START X0 label=기동',
    rackExample: '0 QX41',
    bufferNote: '인텔리전트 모듈의 버퍼 메모리는 <code>U□\\G□</code> 로 읽고 씁니다.',
    adNote: (m) => `디지털 값은 <code>U${(m.head / 16).toString(16).toUpperCase()}\\G11</code> 부터 채널 순서로 들어옵니다 (분해능 1/4000).`,
    daNote: (m) => `디지털 값을 <code>U${(m.head / 16).toString(16).toUpperCase()}\\G1</code> 부터 쓰고, <code>Y${(m.head + 1).toString(16).toUpperCase()}</code> 부터 채널 출력 허가를 켜야 아날로그가 나갑니다.`,
    serialNote: '<code>G.OUTPUT</code> 의 제어 데이터에 적는 송신 데이터 수가 이 단위를 따릅니다.',
    outType: (m) => (m.type === 'QY10' ? '릴레이 (AC · DC 모두 가능, 수명 제한)' : /8[01]/.test(m.type) ? '트랜지스터 소스 (PNP)' : '트랜지스터 싱크 (NPN)'),
    inType: (m) => (/8[01]$/.test(m.type) ? '소스 (PNP)' : '싱크 (NPN)'),
    cpuRows: (spec) => [['프로그램 용량', `${spec.steps.toLocaleString()} 스텝`], ['LD 명령 처리 속도', `${spec.lds} µs`], ['내장 이더넷', spec.eth ? '있음 (MC 프로토콜)' : '없음']],
    cpuLabel: (k, v) => `${v.model} — ${v.steps / 1000}k 스텝${v.eth ? ' · 이더넷' : ''}`,
    defaultRackText: 'Q03UDE · QX41 · QY41P · Q64AD · Q62DAN · QJ71C24N',
    csvName: 'GX Works2 리스트 (.csv)',
    bridge: {
      title: '실제 MELSEC PLC 연동',
      note: '내장 이더넷 CPU 또는 QJ71E71 에 <b>MC 프로토콜 · 바이너리 · TCP</b> 개방 포트(기본 5007)를 설정합니다.'
    },
    helpKeys: [
      ['F5', 'a 접점 (LD/AND) — 디바이스 입력 (예: X0)'],
      ['Shift+F5', 'a 접점 병렬(OR) — 위 행과 세로선으로 이어집니다'],
      ['F6 / Shift+F6', 'b 접점 / b 접점 병렬'],
      ['Shift+F7 / Shift+F8', '상승 펄스 접점 / 하강 펄스 접점'],
      ['F7', '코일 (예: OUT Y20, SET M0, OUT T0 K20)'],
      ['F8', '응용 명령 (예: MOV K100 D0, + D0 D1 D2)'],
      ['F9 / Shift+F9', '가로선 / 세로선'],
      ['F4', '변환 — 회로를 명령어 리스트로 바꾸고 바로 실행합니다']
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
