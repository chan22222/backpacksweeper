/**
 * 백팩스위퍼 코어 타입 정의 — Phaser 비의존(순수 TS).
 * 기획서 §10.3 기준. 이 모듈은 Jest/Vitest로 직접 검증되는 "게임의 진실"이다.
 *
 * 헌법(기획서 §9.1) 강제 포인트:
 *  - BackpackItem 에는 hp/heal/revive/absorb 같은 "생존(트랙 A)" 필드를 정의하지 않는다.
 *    → 가방이 생존에 개입하는 코드는 컴파일 타임에 타입 에러가 된다.
 */

export type Vec2 = { x: number; y: number };

/** 도감 레벨 집합(기획서 §2.5). 데미지 = 골드/점수 = 트랙 A Vitality. */
export type LevelValue = number;

/** 몬스터 배치 규칙(추리 단서의 원천). */
export type PlacementRule =
  | 'scatter' // 무작위 산포
  | 'pair' // 가로/세로 인접 쌍 (가고일)
  | 'center-revealed' // 중앙 고정 + 처음부터 공개 (드래곤)
  | 'column-anchor' // 자신이 속한 열을 다른 몬스터가 바라봄 (쥐왕)
  | 'faces-anchor' // 특정 앵커의 열을 바라봄 (쥐 → 쥐왕)
  | 'swarm' // 무리 군집 (박쥐)
  | 'surround-anchor' // 위성 몹에게 둘러싸이는 중심 (소환술사)
  | 'surround-satellite' // 특정 앵커를 둘러쌈 (슬라임 → 소환술사)
  | 'lonely' // 인접에 몹이 없는 외딴 자리 (가저)
  | 'edge' // 보드 가장자리(벽) (망령)
  | 'deep'; // 중앙 구역 깊은 곳 (리치)

export interface MonsterDef {
  id: string;
  name: string;
  level: LevelValue; // 고정 레벨 = 데미지 = 트랙 A Vitality 회수
  color: number; // 렌더 색상
  glyph: string; // 타일에 표시할 문자
  placement: PlacementRule;
  /** faces-anchor/surround-satellite 가 참조하는 앵커 몹 id. */
  anchor?: string;
  /** 이 종을 한 보드에 몇 마리 배치할지(가중/예산). pair 는 쌍 단위로 해석. */
  budget: number;
  /** 이 몬스터가 인접 숫자(adjacencySum)에 기여하는가. 드래곤은 공개되어 있으므로 기여하되 known 처리. */
  contributesToSum: boolean;
  notes?: string;
}

export type CellContent = 'empty' | 'monster';

/** 보드 위 특수 픽업 종류. */
export type PickupType = 'gem' | 'life' | 'treasure' | 'reroll';

export interface Cell {
  pos: Vec2;
  content: CellContent;
  monsterId?: string; // content === 'monster' 일 때
  /** 인접 8칸 몬스터 레벨의 총합(기획서 §2.1 — 핵심 규칙). empty 칸에만 의미. */
  adjacencySum: number;
  revealed: boolean;
  /** 플레이어가 우클릭으로 단 숫자 메모(추리용). */
  note?: number;
  /** 특수 픽업 칸: 보석(정찰) / 라이프(HP 회복) / 보물상자(경험치). */
  pickup?: PickupType;
  /** 픽업을 이미 사용했는가. */
  pickupUsed?: boolean;
  /** 몬스터가 처치되었는가(공개되었으나 살아있는 몬스터와 구분). */
  dead?: boolean;
  /** 처치된 몬스터의 경험치/보상을 수확했는가(2번째 클릭). */
  collected?: boolean;
  /** 이 몬스터를 클릭하다 플레이어가 사망했는가(킬러 표시용). */
  killer?: boolean;
  /** 처음부터 공개되는 칸(드래곤). */
  preRevealed: boolean;
  /** 구역 인덱스(0..zoneCount-1). 풀 캠프 트리거용. */
  zone: number;
  /** 쥐 등의 방향 단서 렌더용(열 인덱스). */
  facesColumn?: number;
}

/** ★ 트랙 분리의 코드 표현(기획서 §3) — 가방은 trackA 에 절대 닿지 못한다. */
export interface PaymentResult {
  monsterId: string;
  monsterLevel: number;
  hpCost: number; // 차감 HP (가방 개입 불가)
  trackA_vitality: number; // = hpCost (1:1, 빌드 무관, 결정론적)
  trackB_gold: number; // 가방 증폭 후 골드(보상)
  lethal: boolean; // 이 지불이 사망을 유발하는가 (HP 부족)
}

/** 테트로미노 형태. cells 는 (0,0) 기준 상대 좌표 목록. */
export interface GridShape {
  cells: Vec2[];
}

export type ItemCategory = 'weapon' | 'defense' | 'relic' | 'special';

/**
 * 시너지 축(기획서 §4.4) — 단 2개 + 격리.
 *  line: 같은 행/열 정렬 (덧셈)
 *  void: 인접 빈칸 수 비례 (선형)
 *  isolation: 돌출 슬롯 단독 격리 (저주 역전)
 *  none: 시너지 없음
 */
export type SynergyAxis = 'line' | 'void' | 'isolation' | 'none';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  shape: GridShape;
  synergyAxis: SynergyAxis;
  /** line 축일 때 정렬을 세는 방향. */
  lineDir?: 'row' | 'col';
  glyph: string;
  color: number;
  desc: string;

  // --- 트랙 B(보상) 효과: 가방이 증폭하는 유일한 대상 ---
  /** 처치 시 골드 환율 가산(같은 열 적용 등 axis 에 따름). */
  goldRateBonus?: number;
  /** 처치 시 지불 Lv당 점수 가산(클릭 횟수 아님 — 기획서 §5.7). */
  scorePerLvBonus?: number;
  /** 처치 Lv 비례 골드 가산(+값×L). 강칸 정확 처치 보상. */
  goldLvScale?: number;
  /** 인접 빈칸 1개당 점수 가산(void 축). */
  scorePerVoidBonus?: number;
  /** 돌출 슬롯 단독 격리 시 전체 점수 가산율(저주 역전). */
  isolationScoreBonus?: number;

  // --- 방어구(실수 방지) 효과: 위험 흡수 아님 ---
  /** 감당 불가 클릭 1회 무효화(판당 1회). HP 보호 아님 — 입력 취소. */
  misclickGuard?: boolean;

  // --- 특수 효과 ---
  /** 캠프 조형 시 신규 칸 +N. */
  sculptBonus?: number;

  /** 시작 기본 보유 아이템인가(드롭/상점 풀 제외). */
  starter?: boolean;
  /** 가방 내 이동 불가(저주). */
  fixed?: boolean;
}

/** 가방에 배치된 아이템 1개. */
export interface PlacedItem {
  itemId: string;
  /** 가방 격자상의 앵커 좌표. */
  origin: Vec2;
  /** 회전(0/90/180/270). 캠프에서만 변경. */
  rotation: 0 | 1 | 2 | 3;
}

export interface BackpackCell {
  pos: Vec2;
  active: boolean; // 활성 칸인가
  protruding: boolean; // 돌출 격리 슬롯인가
}

export interface BackpackState {
  width: number;
  height: number;
  cells: BackpackCell[]; // width*height
  items: PlacedItem[];
}

export type GamePhase = 'playing' | 'mini-camp' | 'full-camp' | 'won' | 'lost';

export interface GameState {
  // 보드
  board: Cell[]; // width*height
  width: number;
  height: number;
  zoneCount: number;
  clearedZones: boolean[];

  // 자원
  hp: number;
  maxHp: number;
  level: number;
  vitality: number; // 트랙 A 누적
  vitalityForLevel: number; // 현재 레벨에서 누적된 vitality
  gold: number; // 트랙 B(보상)

  // 쥐어짜기 보너스용(기획서 §7.2 — HP 비율 아님, 누적 소모량)
  hpSpentThisLevel: number;

  // 가방
  backpack: BackpackState;

  // 진행
  phase: GamePhase;
  /** 레벨업으로 적립된, 아직 배치하지 않은 신규 활성 칸 수. */
  pendingSculptCells: number;
  /** 방어구 misclickGuard 잔여 횟수. */
  misclickGuards: number;
  turn: number;
  log: string[];
}
