import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from "three";
import { Sketcher, setOC, type ShapeMesh } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";

type Point2D = [number, number];
export type Triangle2D = [Point2D, Point2D, Point2D];

export type PlanarProfile = {
  outer: Point2D[];
  holes?: Point2D[][];
  height: number;
};

type MeshOptions = {
  tolerance?: number;
  angularTolerance?: number;
};

type OcFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<OpenCascadeInstance>;

let ocReady: Promise<void> | null = null;

async function ensureReplicadOC() {
  if (ocReady) return ocReady;
  ocReady = (async () => {
    const oc = await (initOC as unknown as OcFactory)({
      locateFile: (file) => (file.endsWith(".wasm") ? ocWasmUrl : file),
    });
    setOC(oc);
  })();
  return ocReady;
}

const sketchLoop = (points: Point2D[]) => {
  const sketcher = new Sketcher("XY");
  points.forEach(([x, y], idx) => {
    if (idx === 0) {
      sketcher.movePointerTo([x, y]);
      return;
    }
    sketcher.lineTo([x, y]);
  });
  return sketcher.close();
};

const meshToBufferGeometry = (mesh: ShapeMesh) => {
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(mesh.vertices, 3);
  const normal = new Float32BufferAttribute(mesh.normals, 3);
  const indexArray =
    mesh.vertices.length / 3 > 65535
      ? new Uint32BufferAttribute(mesh.triangles, 1)
      : new Uint16BufferAttribute(mesh.triangles, 1);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setIndex(indexArray);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

export async function buildReplicadExtrude(profile: PlanarProfile, meshOptions?: MeshOptions) {
  await ensureReplicadOC();
  const outerSketch = sketchLoop(profile.outer);
  let solid = outerSketch.extrude(profile.height);
  if (profile.holes?.length) {
    for (const loop of profile.holes) {
      const holeSketch = sketchLoop(loop);
      const holePrism = holeSketch.extrude(profile.height);
      const nextSolid = solid.cut(holePrism);
      solid = nextSolid;
    }
  }
  const mesh = solid.mesh(meshOptions ?? {});
  const geometry = meshToBufferGeometry(mesh);
  return geometry;
}

const buildSolidFromTriangles = async (triangles: Triangle2D[]) => {
  await ensureReplicadOC();
  const solids: any[] = [];
  const seen = new Set<string>();
  const keyOf = (tri: Triangle2D) => tri.flat().map((v) => v.toFixed(5)).join("|");
  triangles.forEach((tri) => {
    const k = keyOf(tri);
    if (seen.has(k)) return;
    seen.add(k);
    const sketch = new Sketcher("XY")
      .movePointerTo(tri[0])
      .lineTo(tri[1])
      .lineTo(tri[2])
      .close();
    const solid = sketch.extrude(10);
    solids.push(solid);
  });
  if (!solids.length) {
    throw new Error("三角形建模失败");
  }
  let fused = solids[0];
  for (let i = 1; i < solids.length; i += 1) {
    fused = fused.fuse(solids[i], { optimisation: "commonFace" });
  }
  return fused;
};

export async function buildGroupStepFromTriangles(triangles: Triangle2D[]) {
  if (!triangles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const fused = await buildSolidFromTriangles(triangles);
  const blob = fused.blobSTEP();
  return blob;
}

export async function buildGroupStlFromTriangles(triangles: Triangle2D[]) {
  if (!triangles.length) {
    throw new Error("没有可用于建模的展开三角形");
  }
  const fused = await buildSolidFromTriangles(triangles);
  return fused.blobSTL({ binary: true, tolerance: 0.2, angularTolerance: 0.1 });
}
