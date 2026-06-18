/** 렌더링 상수 + 색상 팔레트. 게임 로직 아님(순수 표현). */
export const VIEW = { width: 1280, height: 720 };

export const TILE = 42;
export const BOARD_ORIGIN = { x: 36, y: 60 };

export const BP_CELL = 46;
export const BP_ORIGIN = { x: 560, y: 372 };

export const COLORS = {
  bg: 0x0b0b12,
  panel: 0x14161f,
  hidden: 0x2a2f3a,
  hiddenHover: 0x39414f,
  revealed: 0x12151d,
  border: 0x3a4150,
  borderRevealed: 0x222732,
  flag: 0xf4a261,
  text: '#e8eaf0',
  textDim: '#8a90a0',
  hp: 0xe63946,
  vitality: 0x52b788,
  gold: 0xf4c430,
  score: 0x6cb6ff,
  guard: 0x9aa7ff,
  bpActive: 0x1c2230,
  bpInactive: 0x0e1016,
  bpProtruding: 0x3a2030,
  danger: 0xe63946,
  // 숫자(주변 몹 수) 타일 — 비활성처럼 흐리게 + 단일 숫자색
  numbered: 0x14161d,
  numberedBorder: 0x20242e,
  numberText: '#9aa3b8',
};

/** 인접 합 숫자의 표시 색상(크기에 따라). */
export function numberColor(n: number): string {
  if (n <= 0) return '#3a4150';
  if (n <= 2) return '#9fd6ff';
  if (n <= 5) return '#8fe3a6';
  if (n <= 9) return '#ffd166';
  if (n <= 14) return '#ff9f5a';
  return '#ff5a5a';
}

export const FONT = 'Malgun Gothic, "Segoe UI", sans-serif';
