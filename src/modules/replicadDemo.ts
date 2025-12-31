import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from "three";
import { Sketcher, setOC, type ShapeMesh } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import initOC from "replicad-opencascadejs/src/replicad_single.js";
import ocWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";

type Point2D = [number, number];

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

const createTriangleProfile = (height: number): PlanarProfile => ({
  outer: [
    [0, 0],
    [40, 0],
    [0, 40],
  ],
  height,
});

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

export async function buildDemoGeometry() {
  const demoProfile = createTriangleProfile(10);
  return buildReplicadExtrude(demoProfile, { tolerance: 0.2, angularTolerance: 0.1 });
}

export async function buildDemoStepBlob() {
  await ensureReplicadOC();
  const profile = createTriangleProfile(10);
  const outerSketch = sketchLoop(profile.outer);
  const solid = outerSketch.extrude(profile.height);
  const blob = solid.blobSTEP();
  return blob;
}
