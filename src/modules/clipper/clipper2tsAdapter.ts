import {
  difference,
  EndType as CEndType,
  FillRule as CFillRule,
  inflatePaths,
  intersect,
  JoinType as CJoinType,
  union,
  xor,
} from "clipper2-ts";
// 如果你实际安装的是作用域包，把上一行改成：
// } from "@countertype/clipper2-ts";

import type {
  ClipperLike,
  ClipOptions,
  EndType,
  FillRule,
  JoinType,
  OffsetOptions,
  Path2,
  Paths2,
  Point2,
} from "./clipperLike";

type ClipperPoint = { x: number; y: number };

function toClipperPoint(p: Point2): ClipperPoint {
  return { x: p[0], y: p[1] };
}

function fromClipperPoint(p: ClipperPoint): Point2 {
  return [p.x, p.y];
}

function toClipperPaths(paths: Paths2): ClipperPoint[][] {
  return paths.map((path) => path.map(toClipperPoint));
}

function fromClipperPaths(paths: ClipperPoint[][]): Paths2 {
  return paths.map((path) => path.map(fromClipperPoint));
}

function mapFillRule(rule?: FillRule): CFillRule {
  switch (rule ?? "nonZero") {
    case "evenOdd":
      return CFillRule.EvenOdd;
    case "nonZero":
      return CFillRule.NonZero;
    case "positive":
      return CFillRule.Positive;
    case "negative":
      return CFillRule.Negative;
    default:
      return CFillRule.NonZero;
  }
}

function mapJoinType(joinType?: JoinType): CJoinType {
  switch (joinType ?? "miter") {
    case "miter":
      return CJoinType.Miter;
    case "round":
      return CJoinType.Round;
    case "square":
      return CJoinType.Square;
    default:
      return CJoinType.Miter;
  }
}

function mapEndType(endType?: EndType): CEndType {
  switch (endType ?? "polygon") {
    case "polygon":
      return CEndType.Polygon;
    case "joined":
      return CEndType.Joined;
    case "butt":
      return CEndType.Butt;
    case "square":
      return CEndType.Square;
    case "round":
      return CEndType.Round;
    default:
      return CEndType.Polygon;
  }
}

function clonePaths(paths: Paths2): Paths2 {
  return paths.map((path) => path.map((p) => [p[0], p[1]] as Point2));
}

function cleanSinglePath(path: Path2, distance: number): Path2 {
  if (path.length === 0) return [];

  const out: Path2 = [];
  const dist2 = distance * distance;

  const isNear = (a: Point2, b: Point2) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy <= dist2;
  };

  for (const p of path) {
    if (out.length === 0 || !isNear(out[out.length - 1], p)) {
      out.push([p[0], p[1]]);
    }
  }

  // 去掉尾首重复
  if (out.length >= 2 && isNear(out[0], out[out.length - 1])) {
    out.pop();
  }

  return out.length >= 3 ? out : [];
}

export function createClipper2TsAdapter(): ClipperLike {
  return {
    union(subject, clip = [], options) {
      const result = union(
        toClipperPaths(subject),
        toClipperPaths(clip),
        mapFillRule(options?.fillRule),
      );
      return fromClipperPaths(result as ClipperPoint[][]);
    },

    intersection(subject, clip, options) {
      const result = intersect(
        toClipperPaths(subject),
        toClipperPaths(clip),
        mapFillRule(options?.fillRule),
      );
      return fromClipperPaths(result as ClipperPoint[][]);
    },

    difference(subject, clip, options) {
      const result = difference(
        toClipperPaths(subject),
        toClipperPaths(clip),
        mapFillRule(options?.fillRule),
      );
      return fromClipperPaths(result as ClipperPoint[][]);
    },

    xor(subject, clip, options) {
      const result = xor(
        toClipperPaths(subject),
        toClipperPaths(clip),
        mapFillRule(options?.fillRule),
      );
      return fromClipperPaths(result as ClipperPoint[][]);
    },

    offset(paths, delta, options) {
      const opts: Required<OffsetOptions> = {
        joinType: options?.joinType ?? "miter",
        endType: options?.endType ?? "polygon",
        miterLimit: options?.miterLimit ?? 2,
        arcTolerance: options?.arcTolerance ?? 0.25,
      };

      const result = inflatePaths(
        toClipperPaths(paths),
        delta,
        mapJoinType(opts.joinType),
        mapEndType(opts.endType),
        opts.miterLimit,
        opts.arcTolerance,
      );

      return fromClipperPaths(result as ClipperPoint[][]);
    },

    simplify(paths, options) {
      // 这版用 union(paths, [], fillRule) 作为“简化/规整”近似实现。
      // 对多数简单 polygon 工作流足够实用。
      const result = union(
        toClipperPaths(paths),
        [],
        mapFillRule(options?.fillRule),
      );
      return fromClipperPaths(result as ClipperPoint[][]);
    },

    clean(paths, distance = 1e-6) {
      return clonePaths(paths)
        .map((path) => cleanSinglePath(path, distance))
        .filter((path) => path.length >= 3);
    },
  };
}