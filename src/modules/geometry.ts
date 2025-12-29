import { Vector3, type Object3D, type Mesh } from "three";

export type PPCGeometry = {
  vertices: number[][];
  triangles: number[][];
};

function triangleArea(a: number[], b: number[], c: number[]): number {
  const va = new Vector3().fromArray(a);
  const vb = new Vector3().fromArray(b);
  const vc = new Vector3().fromArray(c);
  const ab = new Vector3().subVectors(vb, va);
  const ac = new Vector3().subVectors(vc, va);
  return ab.cross(ac).length() * 0.5;
}

export function collectGeometry(object: Object3D): PPCGeometry {
  const vertices: number[][] = [];
  const triangles: number[][] = [];

  object.traverse((child) => {
    if (!(child as Mesh).isMesh) return;
    const mesh = child as Mesh;
    if (mesh.userData.functional) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const indexAttr = geometry.index;
    const indices: number[] = [];
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        indices.push(i);
      }
    }

    // 不去重顶点，保持硬边
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const vaIdx = vertices.length;
      vertices.push([position.getX(a), position.getY(a), position.getZ(a)]);
      const vbIdx = vertices.length;
      vertices.push([position.getX(b), position.getY(b), position.getZ(b)]);
      const vcIdx = vertices.length;
      vertices.push([position.getX(c), position.getY(c), position.getZ(c)]);
      triangles.push([vaIdx, vbIdx, vcIdx]);
    }
  });
  return { vertices, triangles };
}

export function filterLargestComponent(
  geom: PPCGeometry,
): { vertices: number[][]; triangles: number[][]; mapping: number[] } {
  const { vertices, triangles } = geom;
  if (triangles.length === 0) return { ...geom, mapping: [] };

  // collectGeometry 为硬边模式，每个三角的三个顶点都是独立的。
  // 建连通性时按坐标匹配顶点来判断三角是否相邻。
  const posKeys = vertices.map((v) => `${v[0]},${v[1]},${v[2]}`);
  const keyToTris = new Map<string, number[]>();
  triangles.forEach((tri, idx) => {
    tri.forEach((vIdx) => {
      const key = posKeys[vIdx];
      const list = keyToTris.get(key) ?? [];
      list.push(idx);
      keyToTris.set(key, list);
    });
  });

  const visited = new Array(triangles.length).fill(false);
  let best: { triIdx: number[]; area: number } = { triIdx: [], area: -Infinity };

  for (let i = 0; i < triangles.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = true;
    const comp: number[] = [];
    let area = 0;

    while (queue.length) {
      const tIdx = queue.pop()!;
      comp.push(tIdx);
      const [a, b, c] = triangles[tIdx];
      area += triangleArea(vertices[a], vertices[b], vertices[c]);

      [a, b, c].forEach((vIdx) => {
        const key = posKeys[vIdx];
        (keyToTris.get(key) ?? []).forEach((n) => {
          if (!visited[n]) {
            visited[n] = true;
            queue.push(n);
          }
        });
      });
    }

    if (area > best.area) {
      best = { triIdx: comp, area };
    }
  }

  const newTriangles: number[][] = [];
  const newVertices: number[][] = [];
  const mapping = new Array(triangles.length).fill(-1);
  best.triIdx.forEach((oldIdx, newIdx) => {
    mapping[oldIdx] = newIdx;
  });

  const vertMap = new Map<number, number>();
  best.triIdx.forEach((oldIdx) => {
    const tri = triangles[oldIdx];
    const mappedTri: number[] = [];
    tri.forEach((oldV) => {
      if (!vertMap.has(oldV)) {
        vertMap.set(oldV, newVertices.length);
        newVertices.push(vertices[oldV]);
      }
      mappedTri.push(vertMap.get(oldV)!);
    });
    newTriangles.push(mappedTri);
  });

  return { vertices: newVertices, triangles: newTriangles, mapping };
}
// 几何工具：计算面-边索引、顶点键、邻接关系等基础几何数据，供索引/业务层使用。
