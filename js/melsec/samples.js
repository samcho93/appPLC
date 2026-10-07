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
      `PB START X0 label=기동 color=green
PB STOP X1 nc=1 label=정지 color=red
LAMP RUN Y20 color=green label=운전등`,
      `; 기동 버튼으로 켜고, 정지 버튼(b접점)으로 끈다
LD X0
OR Y20
AND X1
OUT Y20
END`,
      `START=1 -> Y20=1
START=0 -> Y20=1
STOP=1 -> Y20=0`),

    P('타이머 플리커 (깜빡임)', '타이머 두 개로 1초 점멸',
      `SEL SW1 X0 label=운전 스위치
LAMP L1 Y20 color=yellow label=점멸등`,
      `; T0 · T1 이 서로를 켜고 끄며 1초씩 점멸한다
LD X0
ANI T1
OUT T0 K10
LD T0
OUT T1 K10
LD T0
ANI T1
OUT Y20
END`,
      `SW1=1 t=1.2 -> Y20=1
t=1.1 -> Y20=0`),

    P('1 버튼 ON/OFF (플립플롭)', '버튼 하나를 누를 때마다 켜짐 ↔ 꺼짐',
      `PB PB1 X0 label=전환 버튼
LAMP L1 Y20 color=blue label=램프`,
      `; 상승 펄스로 한 번만 반전시킨다
LDP X0
FF Y20
END`,
      `PB1=1 scan=2 -> Y20=1
PB1=0 -> Y20=1
PB1=1 scan=2 -> Y20=0`),

    P('실린더 왕복 (편솔)', '전진끝에서 1초 쉬었다가 후진하는 1회 왕복',
      `PB START X0 label=기동
PB STOP X1 nc=1 label=정지
CYL CYL1 sol=Y21 ext=X4 ret=X5 time=1 label=실린더
LAMP RUN Y20 color=green label=전진 중`,
      `; 기동하면 전진, 전진끝(X4)에서 1초 뒤 후진
LD X0
OR Y21
ANI T0
AND X1
OUT Y21

LD X4
OUT T0 K10

LD Y21
OUT Y20
END`,
      `START=1 scan=2 -> Y21=1
START=0 t=1.3 -> CYL1=ext Y21=1
t=1.0 -> Y21=0
t=1.5 -> CYL1=ret`),

    P('컨베이어 제품 계수', '광전 센서로 제품을 세고 10개마다 정지',
      `SEL RUN1 X0 label=운전
CONV CV1 run=Y24 sens=X10@0.9 len=2 label=컨베이어
LAMP DONE Y22 color=yellow label=완료등
PB RST1 X2 label=리셋`,
      `; 광전 센서 상승 에지마다 카운트
LD X0
ANI C0
OUT Y24

LDP X10
OUT C0 K10

LD C0
OUT Y22

LD X2
RST C0
END`,
      `RUN1=1 CV1=1 t=2.2 -> CN0=1
RST1=1 -> CN0=0`),

    P('A/D → D/A 아날로그 연동', '포텐셔미터 값을 읽어 모터 속도와 미터로 출력',
      `POT VR1 ad=1 val=50 label=속도 설정
METER MT1 da=1 scale=0-100 label=속도계
MOTOR M1 fwd=Y22 da=1 label=DC 모터
SEL RUN1 X0 label=운전`,
      `; A/D CH1 디지털값(0~4000) 을 그대로 D/A CH1 로 보낸다
LD SM400
MOV U4\\G11 D0
MOV D0 U5\\G1

; D/A CH1 출력 허가 · 모터 운전
LD SM400
OUT Y51
LD X0
OUT Y22
END`,
      `t=0.5 -> D0=2000 DA1=5
VR1=100 t=0.3 -> DA1=10
RUN1=1 t=1 -> M1>2500`),

    P('시리얼 통신 (무수순)', 'QJ71C24N 으로 터미널에 글자를 보내고 받기',
      `TERM PC1 port=CH1 label=PC 터미널
PB SEND X0 label=송신`,
      `; 송신: 제어 데이터 (CH1 · 7바이트) + "HELLO"
LD SM400
MOV K1 D100
MOV K7 D102
$MOV "HELLO" D110

LDP X0
G.OUTPUT U6 D100 D110 M10

; 수신: 읽기 요구(X63) 가 오면 받아서 D130 에 저장
LD X63
MOV K1 D120
MOV K16 D123
G.INPUT U6 D120 D130 M20
END`,
      `SEND=1 t=0.3 -> PC1~HELLO
PC1="ABC" t=0.3 -> D122=5`),

    P('물탱크 수위 제어', '플로트 스위치와 A/D 수위로 급수 · 배수 제어',
      `TANK TK1 in=Y25 out=Y26 hi=X12 lo=X13 ad=3 level=10 fill=25 drain=20 label=물탱크
SEL AUTO X0 label=자동
LAMP HI Y20 color=red label=만수위
PB DRAIN X1 label=배수`,
      `; 하한 이하면 급수, 상한이면 급수 정지 (자기유지)
LD X0
ANI X13
OR Y25
ANI X12
AND X0
OUT Y25

LD X12
OUT Y20

LD X1
OUT Y26
END`,
      `AUTO=1 t=0.5 -> Y25=1 TK1>10
t=3 -> X12=1 Y25=0 Y20=1
DRAIN=1 t=2 -> Y26=1 TK1<80`)
  ];
})(typeof window !== 'undefined' ? window : globalThis);
