[简体中文](README.md) | [English](README.en.md)

# 3D Printed Paper Craft (3D 打印纸艺)

Convert low-poly 3D models into **papercraft-style structural models that can be 3D-printed directly**, with a **Group / Unfold Editing** workflow to help you split, export, and assemble your model.

- Live site: https://3dppc.kilomelo.com  
- Demo video (Youtube): https://www.youtube.com/watch?v=u5yg60-LQUk  

---

## Features

- **Import models**: OBJ / FBX / STL / 3DPPC
- **3D viewport controls**: rotate / zoom / pan
- **Group editing** (core concept)
  - Create / delete / rename groups
  - Add/remove triangles to/from a group
  - Rotate groups, set color, show/hide
  - Unfold preview for a group
- **Export**
  - Export unfolded group model as **STEP**
  - Export unfolded group model as **STL**
  - Export **seam-edge clip STL** (for connecting/fixing parts)
  - Export project as **3DPPC** (project-specific format)

---

## Quick Start

1. Open the live site: https://3dppc.kilomelo.com
2. Click **Select a model file** and import your model (OBJ/FBX/STL/3DPPC)
3. Enter **Group editing**:
   - Create a Group
   - Add triangles to the Group (split the model into manageable parts)
4. Adjust project settings if needed (e.g., scale, layer height, connection layers, tab parameters, clip gap, etc.)
5. Preview the group model to confirm the split and connection layout
6. Export what you need (STEP / STL / clip STL), then proceed with 3D printing

> For detailed operations, please refer to the demo video: https://www.youtube.com/watch?v=u5yg60-LQUk

---

## Project Settings (Parameters)

The app provides a set of print/assembly-related parameters (e.g., scale, layer height, number of connection layers, extra body layers, tab width/thickness, clip fit gap, etc.).  
If you’re new, it’s recommended to keep the defaults first to complete one full pipeline of **Import → Group → Export → Print**, then fine-tune based on your print results.

---

## Tech Stack & Dependencies

This project is a pure frontend web app:

- Build tool: Vite
- Language: TypeScript
- 3D rendering: Three.js
- CAD / geometry modeling: Replicad + OpenCascade (WASM)

Dependency versions:

- `replicad` `^0.20.5`
- `replicad-opencascadejs` `^0.20.2`
- `three` `^0.160.0`
- `typescript` `^5.3.3`
- `vite` `^5.0.8`

---

## Local Development

If you only want to use the tool, the live site is recommended. For local running or development:

### Requirements
- Node.js (recommended >= 18)

### Install & Run
```bash
npm install
npm run dev
```

## License

This project is released under the **GPL-3.0** license. See [LICENSE](LICENSE)。
If you distribute a modified version or a derivative work (including commercial distribution), please comply with GPL-3.0 terms, such as keeping copyright notices, providing source code, and licensing the derivative under GPL-3.0.

## Support / Donations

If you find this project helpful, consider supporting it with any amount to help cover hosting and ongoing development — thank you!

<a class="link-btn" href="https://paypal.me/chenwaytrue" target="_blank" rel="noreferrer">PayPal.me</a>
