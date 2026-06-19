/**
 * 디자인 토큰 + 레이아웃 상수 (순수 표현).
 * 아이덴티티: "던전 슬레이트" 바탕에 가치/보상은 골드, 위험/죽음은 엠버, 텍스트는 양피지.
 * 시그니처: 액자형 슬랩 패널 + 골드 헤어라인, 카드처럼 박힌 돌 타일.
 */
export const VIEW = { width: 1280, height: 720 };

export const TILE = 40;
export const BOARD_ORIGIN = { x: 40, y: 72 };

export const BP_CELL = 44;
export const BP_ORIGIN = { x: 524, y: 300 };

/** 보드 프레임 + 오른쪽 단일 플레이어 패널(자원 상단 + 탭 콘텐츠). */
export const LAYOUT = {
  boardFrame: { x: 28, y: 60, w: 456, h: 536 },
  playerPanel: { x: 508, y: 60, w: 520, h: 536 },
};

export const COLORS = {
  bg: 0x0f1118, // 깊은 슬레이트
  bgInk: 0x0a0b11, // 더 어두운 잉크(비네팅/그림자)
  panel: 0x191d29, // 슬랩
  panelEdge: 0x313a4e, // 패널 외곽선
  gold: 0xe7b65a, // 액센트: 가치·보상·경제·성장·확정 행동
  goldText: '#e7b65a',
  goldDim: 0x7e6433,
  ember: 0xe0563a, // 위험·죽음
  text: '#ece4d2', // 양피지(주 텍스트/숫자)
  textDim: '#8b93a6',
  textFaint: '#586074',

  // 보드 타일
  hidden: 0x273040, // 솟은 돌(미지) — 클릭 대상
  hiddenHover: 0x3a4761, // 횃불빛 호버
  border: 0x3a4458,
  numbered: 0x13161f, // 파낸(정리된) 칸 — 움푹
  numberedBorder: 0x222a39,
  numberText: '#aeb6c8', // 주변 몹 수 — 차가운 회양피지(단일 색)

  // 자원 바
  hp: 0xe0586a, // HP(로즈-엠버)
  hpTrack: 0x2a1c22,
  vitality: 0xe7b65a, // 성장(골드)
  vitTrack: 0x2a2616,

  // 가방
  bpActive: 0x1f2533,
  bpInactive: 0x10131d,
  bpProtruding: 0x3a2433,

  // 픽업
  gemFill: 0x103247,
  gemEdge: 0x4fd0e6, // 보석 — 유일한 차가운 시그니처 팝
  lifeFill: 0x3a1822,
  lifeEdge: 0xff6b8a,
  treasureFill: 0x33290f,
  treasureEdge: 0xe7b65a,
  rerollFill: 0x231b38, // 상점 새로고침 두루마리(보라 마법)
  rerollEdge: 0xb98cff,

  // 상태
  monsterTile: 0x2a2230, // 살아있는 몹 타일 바탕(따뜻한 어둠)
  corpseTile: 0x14110e, // 처치된 몹
  danger: 0xe0563a,
};

/** 양피지 톤의 단일 숫자색을 쓰므로 크기 대비만으로 강약. 큰 수일수록 살짝 진하게. */
export function numberColor(n: number): string {
  if (n <= 0) return COLORS.textFaint;
  if (n <= 6) return COLORS.numberText;
  if (n <= 12) return '#cdb78a'; // 중간 — 옅은 골드 기운
  return '#e7b65a'; // 높은 합 — 골드
}

export const FONT = '"Do Hyeon", "Malgun Gothic", "Segoe UI", sans-serif';
