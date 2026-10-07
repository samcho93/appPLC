/* 제조사 설정 — LS ELECTRIC XGK 시리즈 (XG5000 식 표기 · 단축키)
 *  공용 래더 편집기(js/ladderview.js) · 앱(js/app.js) 이 제조사마다 다른 부분을 여기서 읽는다.
 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const slot2 = (m) => String(m.slot).padStart(2, '0');
  PLC.VENDOR = {
    id: 'xgk',
    name: 'XGK',
    maker: 'LS ELECTRIC XGK',
    tool: 'XG5000',
    icon: '🟩',
    ld: 'LOAD',
    inv: { NOT: { sym: '/', label: 'NOT' } },
    cmpRe: /^(D|R)?(=|<>|>=|<=|>|<)\s+(.+)$/,
    valRe: /^(D|R|Z|T|C|U)/i,
    coilOps: { OUT: 1, 'OUT NOT': 1, OUTP: 1, OUTN: 1, SET: 1, RST: 1, FF: 1, MCS: 1 },
    isTimerOp: () => false,
    isTC: (o) => o.kind === 'dev' && (o.dev === 'T' || o.dev === 'C'),
    tcIndex: (o) => o.word,
    isBitOperand: (o) => o.kind === 'dev' && !!PLC.DEV[o.dev] && !!PLC.DEV[o.dev].bit && o.bit != null,
    noValueKinds: ['k', 'r', 'str', 'name'],
    forceDevs: ['P', 'M', 'K', 'L'],
    keys: {
      NO: 'F3', OR: 'c3', NC: 'F4', ORNC: 'c4', P: 'sF1', F: 'sF2', coil: 'F9', app: 'F10', H: 'F5', V: 'F6', delV: 'cF6', convert: 'c↵'
    },
    convertName: '적용',
    keymap(e) {
      const k = e.key, sh = e.shiftKey, ct = e.ctrlKey || e.metaKey;
      if (ct && k === 'Enter') return { act: 'convert' };
      if (k === 'F3') return sh ? { act: 'ask', kind: 'SET' } : { act: 'ask', kind: 'NO' };
      if (k === 'F4') return sh ? { act: 'ask', kind: 'RST' } : { act: 'ask', kind: 'NC' };
      if (k === 'F1' && sh) return { act: 'ask', kind: 'P' };
      if (k === 'F2' && sh) return { act: 'ask', kind: 'F' };
      if (k === 'F5') return { act: 'put', kind: 'H' };
      if (k === 'F6') return { act: 'put', kind: ct ? 'delV' : 'V' };
      if (k === 'F9') return { act: 'out', preset: 'OUT ' };
      if (k === 'F11') return { act: 'out', preset: 'OUT NOT ' };
      if (k === 'F10') return { act: 'out', preset: 'MOV ' };
      if (ct && (k === '3' || k === '4' || k === '5' || k === '6')) return { act: 'ask', kind: { 3: 'OR', 4: 'ORNC', 5: 'ORP', 6: 'ORF' }[k] };
      return null;
    },
    hints: {
      contact: '예: P00000 · M00010 · T0000 · LOADP P00001 · >= D00000 100',
      out: '예: OUT P00020 · SET M00000 · TON T0000 30 · CTU C0000 5',
      app: '예: MOV 100 D00000 · ADD D00000 D00001 D00002 · INC D00000'
    },
    defaultProject: (rack) => `[title]
새 프로그램

[rack]
${rack}

[io]
PB START P00000 label=기동 color=green
PB STOP P00001 nc=1 label=정지 color=red
LAMP RUN P00020 color=green label=운전등

[program]
; 기동 · 정지 자기유지
LOAD P00000
OR P00020
AND P00001
OUT P00020
END

[test]
START=1 -> P00020=1
START=0 -> P00020=1
STOP=1 -> P00020=0
`,
    ioExample: 'PB START P00000 label=기동',
    rackExample: '0 XGI-D24A',
    bufferNote: '특수 모듈의 메모리는 <code>U슬롯.워드</code>(예: <code>U02.00</code>) 로 읽고 씁니다.',
    adNote: (m) => `디지털 값은 <code>U${slot2(m)}.00</code> 부터 채널 순서로 들어옵니다 (분해능 1/16000). 변환 완료는 <code>U${slot2(m)}.08</code>, 범위 초과는 <code>U${slot2(m)}.09</code> 입니다.`,
    daNote: (m) => `디지털 값을 <code>U${slot2(m)}.00</code> 부터 쓰고, <code>U${slot2(m)}.08</code> 의 채널 비트(b0 = CH1)를 1 로 만들어야 아날로그가 나갑니다.`,
    serialNote: '<code>SNDUDATA</code> 의 송신 데이터 수가 이 단위를 따릅니다.',
    outType: (m) => (/RY/.test(m.type) ? '릴레이 (AC · DC 모두 가능)' : /SS/.test(m.type) ? 'SSR (트라이악, AC 전용)' : '트랜지스터 싱크 (NPN)'),
    inType: (m) => (/A[12]/.test(m.type) ? 'AC 입력' : '싱크/소스 겸용'),
    cpuRows: (spec) => [['프로그램 용량', `${spec.steps.toLocaleString()} 스텝`], ['LOAD 명령 처리 속도', `${spec.lds} µs/스텝`], ['최대 입출력', `${spec.pts.toLocaleString()} 점`], ['프로그램 포트', spec.port], ['최대 증설', `${spec.exp} 단`]],
    cpuLabel: (k, v) => `${v.model} — ${v.steps / 1000}k 스텝 · ${v.pts.toLocaleString()}점`,
    defaultRackText: 'XGK-CPUE · XGI-D24A · XGQ-TR4A · XGF-AV8A · XGF-DV4A · XGL-C22A',
    csvName: 'XG5000 리스트 (.csv)',
    bridge: {
      title: '실제 XGK PLC 연동',
      note: '이더넷 내장 CPU(XGK-CPUSN/HN/UN) 또는 <b>XGL-EFMT</b> 모듈에 <b>XGT 전용 프로토콜 · TCP</b>(기본 포트 2004)를 설정합니다.'
    },
    helpKeys: [
      ['F3', '평상시 열린 접점 (a 접점) — 디바이스 입력 (예: P00000)'],
      ['F4', '평상시 닫힌 접점 (b 접점)'],
      ['Shift+F1 / Shift+F2', '양 변환 검출 접점 / 음 변환 검출 접점'],
      ['Ctrl+3 / Ctrl+4', 'OR a 접점 / OR b 접점 — 위 행과 세로선으로 이어집니다'],
      ['F5 / F6', '가로선 / 세로선 (Ctrl+F6 세로선 지우기)'],
      ['F9 / F11', '코일 / 역 코일 (예: OUT P00020)'],
      ['Shift+F3 / Shift+F4', '셋(SET) 코일 / 리셋(RST) 코일'],
      ['F10', '펑션 · 펑션 블록 (예: MOV 100 D00000, TON T0000 20)'],
      ['Ctrl+Enter', '적용 — 회로를 명령어 리스트로 바꾸고 바로 실행합니다']
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
