export type Point2 = [number, number];
export type Path2 = Point2[];
export type Paths2 = Path2[];

export type FillRule = "evenOdd" | "nonZero" | "positive" | "negative";
export type JoinType = "miter" | "round" | "square";
export type EndType = "polygon" | "joined" | "butt" | "square" | "round";

export type OffsetOptions = {
  joinType?: JoinType;
  endType?: EndType;
  miterLimit?: number;
  arcTolerance?: number;
};

export type ClipOptions = {
  fillRule?: FillRule;
};

export interface ClipperLike {
  union(subject: Paths2, clip?: Paths2, options?: ClipOptions): Paths2;
  intersection(subject: Paths2, clip: Paths2, options?: ClipOptions): Paths2;
  difference(subject: Paths2, clip: Paths2, options?: ClipOptions): Paths2;
  xor(subject: Paths2, clip: Paths2, options?: ClipOptions): Paths2;

  offset(paths: Paths2, delta: number, options?: OffsetOptions): Paths2;

  simplify(paths: Paths2, options?: ClipOptions): Paths2;
  clean(paths: Paths2, distance?: number): Paths2;
}