/* PLC 에디터 예제 프로그램 */
(function (root) {
  'use strict';
  const PLC = root.PLC = root.PLC || {};
  const P = (title, desc, io, program, test, extra) => ({
    title, desc,
    project: PLC.buildProject(Object.assign({ title, io, program, test }, extra || {}))
  });

  PLC.SAMPLES = [
    P('자기유지 (기동 · 정지)', '가장 기본이 되는 ON/OFF 유지 회로',
      `PB START P00000 label=기동 color=green
PB STOP P00001 nc=1 label=정지 color=red
LAMP RUN P00020 color=green label=운전등`,
      `; 기동 버튼으로 켜고, 정지 버튼(b접점)으로 끈다
LOAD P00000
OR P00020
AND P00001
OUT P00020
END`,
      `START=1 -> P00020=1
START=0 -> P00020=1
STOP=1 -> P00020=0`),

    P('타이머 플리커 (깜빡임)', '타이머 두 개로 1초 점멸',
      `SEL SW1 P00000 label=운전 스위치
LAMP LP1 P00020 color=yellow label=점멸등`,
      `; T0000 · T0001 이 서로를 켜고 끄며 1초씩 점멸한다
LOAD P00000
AND NOT T0001
TON T0000 10
LOAD T0000
TON T0001 10
LOAD T0000
AND NOT T0001
OUT P00020
END`,
      `SW1=1 t=1.2 -> P00020=1
t=1.1 -> P00020=0`),

    P('1 버튼 ON/OFF (플립플롭)', '버튼 하나를 누를 때마다 켜짐 ↔ 꺼짐',
      `PB PB1 P00000 label=전환 버튼
LAMP LP1 P00020 color=blue label=램프`,
      `; 상승 펄스로 한 번만 반전시킨다
LOADP P00000
FF P00020
END`,
      `PB1=1 scan=2 -> P00020=1
PB1=0 -> P00020=1
PB1=1 scan=2 -> P00020=0`),

    P('실린더 왕복 (편솔)', '전진끝에서 1초 쉬었다가 후진하는 1회 왕복',
      `PB START P00000 label=기동
PB STOP P00001 nc=1 label=정지
CYL CYL1 sol=P00021 ext=P00004 ret=P00005 time=1 label=실린더
LAMP RUN P00020 color=green label=전진 중`,
      `; 기동하면 전진, 전진끝(P00004)에서 1초 뒤 후진
LOAD P00000
OR P00021
AND NOT T0000
AND P00001
OUT P00021

LOAD P00004
TON T0000 10

LOAD P00021
OUT P00020
END`,
      `START=1 scan=2 -> P00021=1
START=0 t=1.3 -> CYL1=ext P00021=1
t=1.0 -> P00021=0
t=1.5 -> CYL1=ret`),

    P('컨베이어 제품 계수', '광전 센서로 제품을 세고 10개마다 정지',
      `SEL RUN1 P00000 label=운전
CONV CV1 run=P00024 sens=P00010@0.9 len=2 label=컨베이어
LAMP DONE P00022 color=yellow label=완료등
PB RST1 P00002 label=리셋`,
      `; 광전 센서 상승 에지마다 카운트
LOAD P00000
AND NOT C0000
OUT P00024

LOADP P00010
CTU C0000 10

LOAD C0000
OUT P00022

LOAD P00002
RST C0000
END`,
      `RUN1=1 CV1=1 t=2.2 -> CN0000=1
RST1=1 -> CN0000=0`),

    P('A/D → D/A 아날로그 연동', '포텐셔미터 값을 읽어 모터 속도와 미터로 출력',
      `POT VR1 ad=1 val=50 label=속도 설정
METER MTR1 da=1 scale=0-100 label=속도계
MOTOR MOT1 fwd=P00022 da=1 label=DC 모터
SEL RUN1 P00000 label=운전`,
      `; A/D CH1 디지털값(0~16000) 을 그대로 D/A CH1 로 보낸다
LOAD F00099
MOV U02.00 D00000
MOV D00000 U03.00

; D/A CH1 출력 허가 · 모터 운전
LOAD F00099
OUT M00050
LOAD P00000
OUT P00022

; 채널 출력 허가 비트를 모듈로 내보낸다 (b0 = CH1, b1 = CH2)
LOAD F00099
MOV M0005 U03.08
END`,
      `t=0.5 -> D00000=8000 DA1=5
VR1=100 t=0.3 -> DA1=10
RUN1=1 t=1 -> MOT1>2500`),

    P('시리얼 통신 (무수순)', 'XGL-C22A 으로 터미널에 글자를 보내고 받기',
      `TERM PC1 port=CH1 label=PC 터미널
PB SEND P00000 label=송신`,
      `; 송신: 제어 데이터 (CH1 · 7바이트) + "HELLO"
LOAD F00099
MOV 1 D00100
MOV 7 D00102
$MOV "HELLO" D00110

LOADP P00000
SNDUDATA 4 D00100 D00110 D00102 M00010

; 수신: 읽기 요구(P00063) 가 오면 받아서 D00130 에 저장
LOAD P00063
MOV 1 D00120
MOV 16 D00123
RCVUDATA 4 D00120 D00130 D00123 M00020
MOV U04.00 D00122
END`,
      `SEND=1 t=0.3 -> PC1~HELLO
PC1="ABC" t=0.3 -> D00122=5`),

    P('물탱크 수위 제어', '플로트 스위치와 A/D 수위로 급수 · 배수 제어',
      `TANK TK1 in=P00025 out=P00026 hi=P00012 lo=P00013 ad=3 level=10 fill=25 drain=20 label=물탱크
SEL AUTO P00000 label=자동
LAMP HI P00020 color=red label=만수위
PB DRAIN P00001 label=배수`,
      `; 하한 이하면 급수, 상한이면 급수 정지 (자기유지)
LOAD P00000
AND NOT P00013
OR P00025
AND NOT P00012
AND P00000
OUT P00025

LOAD P00012
OUT P00020

LOAD P00001
OUT P00026
END`,
      `AUTO=1 t=0.5 -> P00025=1 TK1>10
t=3 -> P00012=1 P00025=0 P00020=1
DRAIN=1 t=2 -> P00026=1 TK1<80`)
  ];
})(typeof window !== 'undefined' ? window : globalThis);
