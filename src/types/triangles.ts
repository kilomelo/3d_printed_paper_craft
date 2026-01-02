export type Point2D = [number, number];
export type Triangle2D = [Point2D, Point2D, Point2D];

export type TriangleWithEdgeInfo = {
  tri: Triangle2D;
  faceId: number;
  edges: { isOuter: boolean; angle: number }[];
};
