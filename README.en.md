[简体中文](README.md) | [English](README.en.md)

# 3D Printed Paper Craft (3D 打印纸艺)

Convert low-poly 3D models into **papercraft-style structural models that can be 3D-printed directly**, with a **Group / Unfold Editing** workflow to help you split, export, and assemble your model.

- Live site: https://3dppc.kilomelo.com
- Demo video (YouTube): https://www.youtube.com/watch?v=kpObT-4yojI
- Current version: `v1.2.1.4`

---

## Screenshots

### Home

![Home screenshot](screenshot/main_page.png)

### Editor

![Editor screenshot](screenshot/editor.png)

---

## Features

- **Model import**: OBJ / FBX / STL / 3DPPC
- **3D viewport controls**: rotate / zoom / pan
- **Editing modes**
  - View Mode
  - Group Edit
  - Seam Edit
  - Texture Edit
- **Group editing** (core concept)
  - Create / delete / rename groups
  - Add/remove triangles to/from a group
  - Rotate groups, set color, show/hide
  - Unfold preview for a group
- **Texture workflow**
  - Load, auto-generate, clear textures
  - Texture preview and PNG export
  - Configurable color space / flip / generated resolution
- **Export**
  - Export unfolded group model as **STEP** / **STL**
  - Export unfolded group texture as **PNG**
  - Export **seam-edge clip STL** (for connecting/fixing parts)
  - Export project as **3DPPC** (with optional texture embedding)
- **Lumina-Layers tool**
  - Supports Lumina-Layers workflow (texture export + 3MF re-import processing)
- **Home page UX**
  - Quick sample projects
  - Built-in changelog entry

---

## Quick Start

1. Open the live site: https://3dppc.kilomelo.com
2. Click **Select Model** and import your model (OBJ/FBX/STL/3DPPC)
3. Enter **Group Edit**:
   - Create a Group
   - Add triangles to the Group (split the model into manageable parts)
4. Switch modes as needed (Seam / Texture) to adjust joins and textures
5. Tune project settings (scale, layer height, connection layers, tab parameters, texture options, etc.)
6. Preview and export files (STEP / STL / PNG / seam clip STL / 3DPPC), then proceed to printing

> For detailed operations, please refer to the demo video: https://www.youtube.com/watch?v=kpObT-4yojI

---

## Project Settings (Parameters)

The app provides print/assembly/texture-related parameters (for example: scale, layer height, connection layers, extra body layers, tab width/thickness, clip fit gap, texture color space, texture flip, generated texture resolution).  
If you’re new, keep defaults first to run one full pipeline of **Import -> Group -> Preview/Export -> Print**, then fine-tune based on print results.

---

## Changelog

- Chinese full changelog: [`public/changelog.md`](public/changelog.md)
- English full changelog: [`public/changelog_en.md`](public/changelog_en.md)

Recent highlights:
- `v1.2.0.0` (2026-03-29): Added texture import/generation/preview and Texture Edit mode, added a Lumina-Layers workflow tool, and introduced the Dull Horse demo project.
- `v1.1.0.0` (2026-03-12): Added a new Interlock (clipless) seam workflow, and the Orca demo project.

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

This project is released under the **GPL-3.0** license. See [LICENSE](LICENSE).  
If you distribute a modified version or a derivative work (including commercial distribution), comply with GPL-3.0 terms such as preserving copyright notices, providing source code, and licensing derivatives under GPL-3.0.

## Related Projects

- [Lumina-Layers](https://github.com/MOVIBALE/Lumina-Layers/) - Physics-Based Multi-Material FDM Color System

---

## Support / Donations

If you find this project helpful, consider supporting it with any amount to help cover hosting and ongoing development.

<a class="link-btn" href="https://paypal.me/chenwaytrue" target="_blank" rel="noreferrer">PayPal.me</a>
