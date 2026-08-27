# Editor guide

The editor works on one `.svlevel.json` project containing its levels, layer definitions, tilesets, enums, entity types, and auto-tile rules.

## Layout

![Editor overview](img/overview.png)

- The toolbar contains tools, view controls, project dialogs, and save actions.
- The left column contains Layers, Levels, and History.
- The center canvas shows every level in world space.
- The right column contains the palette and Properties inspector.

## Toolbar

![Toolbar](img/toolbar.png)

The main tools are Select, Brush, Rectangle, Bucket fill, Eraser, Pick, Place entity, and Pan. Their shortcuts are listed at the end of this guide.

Undo and Redo sit beside three view controls: frame the current level, show the grid, and dim inactive layers. A Tiles layer also shows brush controls for horizontal flip, vertical flip, and random tile selection.

The middle group opens the Rules, Enums, Tags, Collision, Flip, Locale, Entities, and Tileset dialogs. Import and Export work without a dev server.

The right side shows zoom and status. Play appears when the host provides `onPlay`; it uses the in-memory project without saving first. Save writes through the configured project store.

## Canvas

![Auto-tiling on the canvas](img/canvas-autotile.png)

- Left-drag uses the selected tool; right-drag erases.
- Shift-drag with the Brush paints a rectangle.
- Middle-drag, Space-drag, or the Pan tool moves the view.
- The wheel pans. Ctrl/Cmd+wheel zooms around the pointer.
- Delete or Backspace removes selected entities.

Painting affects the active layer of the current level. A Tiles brush keeps the shape and flip state of the palette selection. Painting an IdGrid immediately recomputes any AutoLayers that use it.

### Levels

![Level handles](img/canvas-levels.png)

Click a level to make it current. Its edge handles can resize it, move it, or create a same-sized level beside it. All three actions snap to the grid. You can also enter the level position in Properties.

## Left column

![Left panels](img/panels-left.png)

### Layers

![Layers panel](img/panel-layers.png)

Layer definitions apply to every level:

- `IdGrid` stores ids used by auto-tiling and is not rendered.
- `Tiles` stores tiles painted from a tileset.
- `AutoLayer` generates tiles from an IdGrid and a rule group.
- `Entities` stores placed entity instances.

Click a row to activate it. The eye toggles visibility, the sliders button opens AutoLayer rules, and the arrows change draw order. The top row is drawn last.

### Levels

![Levels panel](img/panel-levels.png)

The panel lists each level and its pixel size. The plus button adds a 256 × 144 level to the right of the project. At least one level must remain.

### History

![History panel](img/panel-history.png)

Each row is one edit. Select a row to return to that point, or use Undo and Redo one step at a time. A continuous paint drag counts as one edit.

## Right column

![Right panels](img/panels-right.png)

The top panel changes with the active layer: tiles for Tiles and AutoLayer, rule groups for IdGrid, and entity types for Entities. Properties stays visible below it.

### Tileset

![Tileset palette](img/panel-tileset.png)

Drag over the palette to select one or more tiles. The selection keeps its rectangular shape when painted. If the layer has no tileset, assign one in Properties.

### Rule groups

![Rule groups panel](img/panel-rulegroups.png)

Select a group, then paint its id on the IdGrid. The sliders button opens its rules; the plus button creates a group. Disabled groups remain in the grid but generate no tiles.

### Entities

![Entity palette](img/panel-entities.png)

Select a type to switch to Place entity. Types are grouped by category and show their gizmo colour and field count. Use Edit types to change their definitions.

### Properties

![Entity properties](img/panel-entity-props.png)

Properties shows settings for the current level, layer, and selected entity. Level settings include size, world position, and background colour. Layer settings include opacity and type-specific sources. Entity settings include position, optional size, and its declared fields.

### Dialogue

![Dialogue editor](img/panel-dialogue.png)

A `Dialogue` field uses a line editor with speaker, text, ordering, and removal controls. Named speakers also get a name field. The script is stored as JSON in the entity field.

## Dialogs

### Rules

![Auto-layer rules](img/dlg-rules.png)

Rules are evaluated from top to bottom. Each rule matches a 1×1, 3×3, 5×5, or 7×7 pattern around the current cell. Pattern cells can require a value, forbid it, match any filled cell, require an empty cell, or match anything. You can also define how cells outside the level are treated.

When a rule matches, it places one of its tiles using seeded randomness. The remaining options control when and where it applies:

- Chance skips some matches.
- Break stops later rules from running on the same cell.
- Flip X/Y adds mirrored pattern variants.
- Modulo X/Y limits the rule to repeating rows or columns.
- Checker alternates matches in a checkerboard pattern.
- Perlin produces larger patches of variation.

Put specific rules above general ones. Rule groups can also be saved and reused as presets.

### Enums

![Enums](img/dlg-enums.png)

Enums are named lists used by entity fields and tileset tags. Each value has an id and colour. Renaming a value preserves references; deleting it does not.

### Tags

![Tileset tags](img/dlg-tags.png)

Choose a tileset and enum, then paint enum values onto tiles. The runtime exposes these tags with each tile collider.

### Collision

![Tile colliders](img/dlg-collision.png)

Paint a full-cell box collider, a shape traced from opaque pixels, or erase an existing collider. Sensors report overlaps without applying contact forces.

The lower section defines collision layers and their interaction matrix. Projects support up to 16 layers, and `DEFAULT` is always present. At load time, adjacent box colliders with the same settings are merged.

### Flip

![Tile random flip and warp](img/dlg-flip.png)

Set per-tile chances for horizontal or vertical flips. Warp offsets pixels by a few texels to break up visible grids. Both effects are deterministic for a given seed; changing the seed reshuffles the result.

### Locale

![Localization](img/dlg-locale.png)

The table has one row per source string and one column per locale. Scan project collects placed entity fields marked `i18n`. Unused rows are kept and marked rather than deleted.

### Entities

![Entity types](img/dlg-entity-types.png)

Entity types define their id, name, category, size, gizmo, resize behavior, and tooltip. Fields have a type and default value; enum fields select an enum, while `i18n` String and MultiLines fields are included in localization scans.

### Tileset import

![Import tileset](img/dlg-tileset-import.png)

Choose an image from the static directory or upload one through the dev-server plugin. Set its id, tile size, spacing, and padding, then check the preview before importing it.

## Shortcuts

| Key | Action |
| --- | --- |
| V, S | Select |
| B | Brush |
| E | Eraser |
| R | Rectangle |
| G | Bucket fill |
| I | Pick |
| A | Place entity |
| F | Frame the current level |
| X | Flip brush X |
| T | Toggle random brush |
| Space (hold) | Pan |
| Delete, Backspace | Delete selected entities |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y | Redo |
| Ctrl/Cmd+S | Save |
| P, F5 | Play |
| Esc | Close the open dialog |
