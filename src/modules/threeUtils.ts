import * as THREE from "three";

function disposeMaterial(mat: THREE.Material) {
  // 释放材质引用的纹理（常见做法：遍历材质字段，找出 Texture 并 dispose）
  for (const key of Object.keys(mat)) {
    const v = (mat as any)[key];
    if (v && typeof v === "object" && v.isTexture) {
      v.dispose();
    }
  }
  mat.dispose();
}

export function disposeGroupDeep(
  group: THREE.Object3D,
  renderer?: THREE.WebGLRenderer,
  opts?: { disposeTextures?: boolean }
) {
  const disposeTextures = opts?.disposeTextures ?? false;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  group.traverse((obj) => {
    const anyObj = obj as any;

    const g = anyObj.geometry as THREE.BufferGeometry | undefined;
    if (g) geometries.add(g);

    const m = anyObj.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) {
      m.forEach((mm) => materials.add(mm));
    } else if (m) {
      materials.add(m);
    }
  });

  if (disposeTextures) {
    for (const m of materials) {
      for (const k of Object.keys(m)) {
        const v = (m as any)[k];
        if (v?.isTexture && v.userData?.__disposeWithOwner === true) {
          textures.add(v);
        }
      }
    }
  }

  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
  textures.forEach((t) => t.dispose());

  group.clear();
  (renderer as any)?.renderLists?.dispose?.();
}