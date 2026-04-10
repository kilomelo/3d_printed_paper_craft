## v1.2.1.4 | 2026-04-10
- Added: A texture sampling mode setting with Smooth, Pixel Stable, and Pixel Crisp options.
- Added: An Anti-Slip Clip setting for clip seams, with multiple retention strength levels.
- Added: A Claw Density setting for interlocking seams to adjust the number of claws on seam edges.
- Improved: Replaced several continuous numeric settings with sliders and refined related wording and default texts in the settings UI.

## v1.2.1.0 | 2026-04-03
- Added: A reorder operation for unfolded groups, allowing face connections to be adjusted directly in the 2D view.
- Added: 3MF export for unfolded groups.
- Added: One-click export for all unfolded groups.
- Improved: The print layer height setting now uses fixed presets.
- Fixed: Abnormal polyline rendering in the unfolded group preview.

## v1.2.0.0 | 2026-03-29
- Added: Texture import, generation, preview, and a texture editing mode.
- Added: A multi-color tool with support for Lumina-Layers.
- Added: A new sample project: Dull Horse.
- Improved: The interaction flow and UI for exporting unfolded groups.
- Fixed: An issue where loading a .3dppc file could create an extra unfolded group.
- Fixed: An issue where unfolded groups containing no triangles could still enter the export process in some cases.

## v1.1.0.5 | 2026-03-17
- Improved: In seam edit mode, only edges facing the camera can be picked.
- Improved: Refined the display and wording of menu bar buttons.
- Improved: Removed some unnecessary state transition logs.

## v1.1.0.3 | 2026-03-16
- Added: Auto-adjust the scale setting when opening OBJ/FBX/STL models.
- Added: A MakerWorld link button for the sample project.
- Fixed: Toolbar state was not reset when opening a model.

## v1.1.0.0 | 2026-03-12
- Added: A new clipless seam-joining workflow and related settings.
- Added: Export any number of connected coplanar triangles as polygons, plus a coplanarity threshold setting.
- Added: A new sample project and the entry UI on the home page.
- Added: Changelog UI on the home page.
- Fixed: A geometry calculation issue that could create a small bump at one end of a fold, blocking the bend.

## v1.0.1.1 | 2026-02-26
- Fixed: False-positive self-intersection triangle detection in some cases.
- Fixed: Dashed line density in the 2D preview not adapting to model size.

## v1.0.0.3 | 2026-02-17
- Fixed: The 2D preview placeholder not updating with editing state changes.
- Fixed: Delete button logic not responding immediately after creating a group.
- Fixed: The About page not being closable at very small resolutions.

## v1.0.0.0 | 2026-02-17
- Official release.
