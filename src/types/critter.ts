export type ElementalAffinity = 'fire' | 'water' | 'grass' | 'shadow';

export type CritterPartType =
  | 'body'
  | 'head'
  | 'limbs'
  | 'wings'
  | 'horns'
  | 'eyes'
  | 'mouth'
  | 'tail';

export interface AffinityColors {
  primary: string;
  secondary: string;
  highlight: string;
  dark: string;
  glow: string;
  accent: string;
}

export interface JointPoint {
  x: number;
  y: number;
}

export interface CritterAnimationState {
  bob: number;
  breath: number;
  sway: number;
  flap: number;
}

export interface CritterPart {
  id: string;
  type: CritterPartType;
  name: string;
  variant: string;
  zIndex: number;
  jointAnchor: JointPoint;
  scale?: number;
  rotation?: number;
  draw: (
    ctx: CanvasRenderingContext2D,
    origin: JointPoint,
    scale: number,
    colors: AffinityColors,
    animationFactor: CritterAnimationState
  ) => void;
}

export interface CritterStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export interface CritterDNA {
  id: string;
  speciesName: string;
  affinity: ElementalAffinity;
  bodyVariant: string;
  headVariant: string;
  limbsVariant: string;
  wingsVariant?: string;
  hornsVariant?: string;
  tailVariant?: string;
  eyesVariant: string;
  mouthVariant: string;
  scale: number;
  generation: number;
  stats: CritterStats;
}

export interface CritterManifest {
  dna: CritterDNA;
  parts: CritterPart[];
  colors: AffinityColors;
  sockets: {
    root: JointPoint;
    head: JointPoint;
    leftArm: JointPoint;
    rightArm: JointPoint;
    leftLeg: JointPoint;
    rightLeg: JointPoint;
    leftWing?: JointPoint;
    rightWing?: JointPoint;
    horns?: JointPoint;
    tail?: JointPoint;
  };
}
