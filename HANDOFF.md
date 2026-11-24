# Forma Studio — Handoff

> **Read this whole file at the start of every session. Update it at the end of every session that changes anything.**
> **Last verified:** 2026-11-23 against branch `main` at commit `34eda7b` (53 commits, the last on 2026-11-22). Written from an audit of that commit.
> Evidence tags used throughout: **[ran]** reproduced by executing code · **[read]** read in the source, not executed · **[unverified]** not checked.
> The chat history that preceded this file was **not available** to its author, so the roadmap (§6) is *proposed*, not agreed. Decisions the owner must confirm are listed in §9.

## Contents

0. [Start here](#0-start-here)
1. [Snapshot](#1-snapshot)
2. [Rules for AI chats](#2-rules-for-ai-chats)
3. [The runtime patch layer](#3-the-runtime-patch-layer)
4. [How everything works](#4-how-everything-works)
5. [Delivery workflow](#5-delivery-workflow)
6. [Roadmap (proposed)](#6-roadmap-proposed)
7. [Known issues](#7-known-issues)
8. [Research plan vs reality](#8-research-plan-vs-reality)
9. [Open decisions and unverified items](#9-open-decisions-and-unverified-items)
10. [Changelog](#10-changelog)
- [Appendix A. Verification scripts](#appendix-a-verification-scripts)

---

## 0. Start here

**What this is.** Forma Studio ("Character Lab") is a static, local-first, zero-cost browser app: reference images → editable rigged humanoid (22 bones) → procedural and custom motion with layering → animated GLB export. Plain JavaScript ES modules, Three.js 0.180.0 loaded from a CDN, no build step, no backend, no API keys. Images never leave the browser. The owner works **only through the GitHub web UI** and ships changes as incremental ZIP files that a GitHub Action unpacks.

**Seven things that will bite you** (details in the sections named)

1. **What runs is not what is on GitHub.** `sw.js` rewrites `index.html`, `src/main.js` and `src/visual-hull.js` in the browser on every request. The multi-view reconstruction, auto background removal and side-facing slots exist *only* in those runtime patches (§3).
2. **The unpatched app crashes at startup** (`avatar.helper.update is not a function` on Three.js 0.180.0). First visit, hard reload, `file://` and any host without the service worker all run the unpatched code. **[ran]** (KI-02)
3. **Every shipped change must bump `CACHE_NAME` in `sw.js`.** The worker is cache-first; without a bump returning users keep old code indefinitely (§5.2).
4. **ZIP traps.** A ZIP named like a *new* top-level folder it creates has that folder stripped, and one invalid ZIP blocks every later update until someone deletes it by hand. **[ran]** (§5.1)
5. **Honest claims only.** Reconstruction is classical silhouette carving with vertex colours. It is not photogrammetry, not neural, and infers no hidden surfaces (§2, rule 7).
6. **Known broken today:** drag-and-drop of reference images, skeleton/mesh rest-pose mismatch, mirrored L/R naming, preview-vs-export clip differences, unreachable mask editor (§7).
7. **The README is stale.** Trust the code and this file.

**Starter prompt — paste into any new chat**

```text
You are continuing work on Forma Studio. Repo: https://github.com/n0nam3-bot/Forma-Studio (branch main).
1. Get the code: git clone https://github.com/n0nam3-bot/Forma-Studio.git
   (if you cannot clone, fetch https://raw.githubusercontent.com/n0nam3-bot/Forma-Studio/main/HANDOFF.md)
2. Read HANDOFF.md completely and obey section 2 "Rules for AI chats".
   Compare its "Last verified" commit with `git log -1`; if the repo is newer, read the diff first.
3. Reply with: the current state in 8 lines or fewer, the top roadmap item (section 6) and the known issues
   (section 7) it touches, and any decision you need from me (section 9). Change nothing until I answer.
How I work: only through the GitHub web UI, no local git. Give click-by-click steps and deliver changes as an incremental ZIP.
```

**End-of-session prompt**

```text
Before we finish: update HANDOFF.md (Last verified commit, issues opened/closed, roadmap changes, a changelog row
including the new CACHE_NAME) and include it in the ZIP at its root.
```

---

## 1. Snapshot

| Item | Value |
|---|---|
| Product | Forma Studio — Character Lab. UI label **0.9.1** (sidebar footer in `index.html`), independent of every other version number in the repo |
| Repo | https://github.com/n0nam3-bot/Forma-Studio · branch `main` (the only ref on the remote; no tags, no PR refs) · MIT, "Forma Studio contributors", 2026 |
| History | 53 commits, all on 2026-11-22: web-UI commits by `n0nam3-bot` ("Add files via upload", "Create …", "Delete …") alternating with bot commits "Apply uploaded ZIP update" |
| Size | 21 tracked files, ≈4,400 lines. Largest: `src/main.js` (990 lines), `src/visual-hull.js` (794), `sw.js` (353) |
| Stack | Static site. Plain JS ES modules. Three.js **0.180.0** (pinned) via an import map from CDNs. No `package.json`, no bundler, no tests |
| Hosting | Intended: GitHub Pages, "Deploy from a branch", `/ (root)`. **[unverified]** whether Pages is enabled and what the URL is |
| Needs | WebGL 2, import-map support, IndexedDB; service worker (https or localhost) |
| Offline | After one online visit the service worker caches app files and the Three.js modules it fetched |
| Privacy / cost | Only network use is the Three.js CDN. No uploads, accounts, keys, analytics or paid services |
| Owner workflow | GitHub web UI only → assume **no local git or CLI** unless told otherwise |
| Current cache id | `forma-studio-auto-cutout-v8`; query strings `?v=8` (`visual-hull.js`, `reference-cutout.js`) and `?v=4` (`workspace-ui.css/js`) |

---

## 2. Rules for AI chats

1. **Start-of-session protocol.** Clone the repo, read this file, compare "Last verified" with `git log -1` (if newer: `git log --oneline 34eda7b..HEAD` and read the diff), summarise the state in ≤8 lines, ask only for decisions listed in §9 or genuinely missing facts, and **do not change anything until the owner picks a task**.
2. **Ground truth is the code plus the runtime patch layer (§3), not the README.** When asked how something works, read the source. When asked whether something works, say whether you ran it.
3. **Patch-layer discipline (until R-1 is done).** Do not edit `src/main.js`, `src/visual-hull.js`, or any `index.html` string quoted in §3.2 without running `sim_patch.mjs` (Appendix A) afterwards; it must print `all patches apply` and the patched output must pass `node --check`. Prefer doing R-1 itself over adding more patches. Never add new features as runtime patches.
4. **Bump the cache.** Any change to a file the service worker caches requires a new `CACHE_NAME` in `sw.js`, plus a new `?v=` for any patched module you changed (§5.2).
5. **Deliver as incremental ZIPs.** Whole-file replacements at repo-relative paths, no wrapper folder, a unique ZIP name (never the name of a new top-level folder), deletions via `.update-delete.txt`. Never delete `.github/workflows/unpack-upload.yml` or `scripts/process_uploads.py` (the updater refuses anyway). Changing the updater itself (R-5) is risky: a broken updater cannot repair itself through a ZIP, so dry-run it and be ready to fix it by editing the file directly in the GitHub web UI, which is also the only way to change workflow files. Dry-run every ZIP against a fresh clone first (§5.2).
6. **Verify honestly.** An AI sandbox usually has no browser or GPU. Run what can be run (`node --check`, `sim_patch.mjs`, `rig_check.mjs`, the updater dry-run), then state exactly what was and was not tested. Never write "works" or "tested" for browser behaviour you did not observe. Ask the owner for console output or screenshots.
7. **Honesty boundary of the product.** Never claim neural reconstruction, photogrammetry, Gaussian-splat conversion, photo-texture baking, automatic retargeting, IK, auto-rigging of imported meshes, or "game-ready" certification. The reconstruction is a classical silhouette intersection (visual hull) smoothed into a surface with per-vertex colour; concavities and hidden surfaces are not inferred; two views cannot determine a volume.
8. **Product constraints.** Zero cost, local-first, no backend, accounts, keys or analytics; images never leave the browser; no third-party scripts beyond the pinned Three.js CDN without explicit approval. Changing the Three.js version means editing `bootstrap.js` (`THREE_VERSION`, `CDN_BASES`), `sw.js` (`THREE_PREFIXES`) and re-testing loaders and `GLTFExporter`. Any bundled third-party asset needs a licence note in the README.
9. **Stable IDs and strings.** Element IDs are consumed in several places: `bootstrap.js` (fallback mode), `src/main.js`, `workspace-ui.js` and the `sw.js` HTML/JS patches. Rename none without updating all of them.
10. **Code style.** Keep `src/main.js`'s compact style (lines targeted by patches depend on exact text). ES modules, no build tooling unless the owner approves.
11. **Owner communication.** Short. Exact GitHub UI steps. List changed files and what to look for. State risks and what you could not verify.
12. **Update this file** at the end of every session that changes behaviour, issues or roadmap, and ship it in the same ZIP.
13. **Unknown GitHub-side state** (Issues, Pages settings, Actions logs) must be pasted by the owner. Do not guess it. Never ask for tokens or secrets.

---

## 3. The runtime patch layer

This is the single most important architectural fact about the project.

### 3.1 What happens

```text
browser requests  src/main.js  (also index.html and src/visual-hull.js)
   └─ sw.js fetch handler, cache-first  →  raw file from cache or network
        └─ applyClientPatches(): exact-string replacements on the text
             └─ the browser executes the PATCHED code — not what GitHub shows
```

Presumably this exists so features could be shipped as small ZIPs without re-uploading whole files (inference, not documented anywhere).

### 3.2 Patch inventory (as of `34eda7b`; all apply **[ran]**)

| Target | What the patch does | Depends on this exact text |
|---|---|---|
| `index.html` | Injects `workspace-ui.css?v=4` and `workspace-ui.js?v=4` before `</head>`; replaces 4 strings | `Fit proportions from views` → `Reconstruct 3D mesh from views`; `Fit a humanoid from proportions` → `Reconstruct from reference views`; `Builds an editable, rigged character that you refine against the uploaded views.` → closed-visual-hull sentence; the `notice-box` sentence beginning `two images do not contain enough information…` → auto-background-removal text |
| `src/main.js` | Prepends `import './skeleton-helper-compat.js'` (**the fix for KI-02**); imports `installVisualHullWorkflow` / `applyVisualHullToAvatar` (`visual-hull.js?v=8`) and `autoCutoutDataUrl` (`reference-cutout.js?v=8`); adds `visualHullGeometry:null` to `state`; replaces the `side` slot with `sideFacingLeft` + `sideFacingRight`; wraps the **first** `readFileAsDataURL` in `autoCutoutDataUrl`; rewrites **every** `state.references.push({…dataUrl})` to also store `originalDataUrl` and `maskDataUrl`; migrates and re-cuts old projects in `restoreProject`; re-applies the hull to all 5 avatars at the end of `createAllAvatars`; calls `installVisualHullWorkflow(...)` right after `initReferences();` | `const dataUrl=await readFileAsDataURL(file);` · `state.references.push({role:slot.role,label:slot.label,name:file.name,dataUrl});` · `{role:'side',label:'Side',required:true},` · `  initReferences();` · `  exportAvatar=createHumanoid(state.shape,{name:'ExportCharacter',geometryOverride:sharedGeometry});` · `  state.references=Array.isArray(project.references)?project.references:[];` · `const state = {` / `  shape:{...DEFAULT_SHAPE},` |
| `src/visual-hull.js` | Extends `DEFAULT_ANGLES` (`sideFacingLeft` 90°, `sideFacingRight`/`sideOpposite` 270°); decodes `originalDataUrl`; replaces `estimateExtents`; accepts side-facing roles; swaps `createSurfaceGeometry` for a smoothed iso-surface; **replaces `installVisualHullWorkflow` through the end of the file** with a short automatic workflow, which removes the manual mask editor | function signatures and strings in `visual-hull.js` |

### 3.3 Consequences

- **Source ≠ runtime.** GitHub shows files that are not what executes. On-disk `src/main.js` contains none of: visual hull, auto cutout, side-facing slots.
- **The unpatched app crashes at startup.** On-disk `main.js` calls `avatar.helper.update()`; Three.js 0.180.0 has no `SkeletonHelper.update`. The alias exists only in `skeleton-helper-compat.js`, which only the patch imports. `init()` throws inside `createAllAvatars()`, so the render loop never starts and the saved project is not restored. **[ran]** for the missing method and the exact call; the browser symptom is **[read]**.
- **Which visitors get unpatched code:** the very first visit (the worker is registered during `init()`, after `main.js` already loaded), hard reloads (browsers normally bypass the worker), `file://`, any host that blocks service workers, and any failure of the worker itself. **[read]**
- **Silent no-ops.** Patches are `String.replace`; if a target string changes, that patch quietly stops applying. `replace` only hits the first occurrence, `replaceAll` hits all — that mismatch is exactly KI-03.
- **Cache-first.** Updates reach returning users only when the bytes of `sw.js` change (§5.2).
- **Dead code after patching:** the manual mask editor in `visual-hull.js` (`installStyles`, `makeEditorUI`, `drawEditor`, `maskEditorLoad`, `paintCircle`, `makeManualMaskCanvas`) and the original silhouette-fit path in `main.js` (`fitProportionsFromReferences`, `measureReferenceSilhouette`).

### 3.4 Which code is running? (browser console)

```js
navigator.serviceWorker.controller                     // non-null → patched code is running
(await (await fetch('./src/main.js')).text()).includes('installVisualHullWorkflow')   // true → patched
```

DevTools → Application → Service Workers: "Bypass for network" shows the unpatched app; "Unregister" plus Storage → "Clear site data" simulates a first visit.

### 3.5 Exit plan (roadmap R-1)

`sim_patch.mjs` (Appendix A) writes the patched files to `patched/`. Those are a ready-made, behaviour-identical starting point:

1. Commit `patched/main.mjs` → `src/main.js`, `patched/visual-hull.mjs` → `src/visual-hull.js`, `patched/index.html` → `index.html`, and delete every `patch*` function plus `applyClientPatches`, `isoSurfaceFunction`, `newInstallWorkflow` from `sw.js` — **in the same ZIP, with a new `CACHE_NAME`** (an old worker that re-patches new sources is the main transition risk).
2. In a second, separate commit fix KI-02/KI-03 (replace the 4 `helper.update()` calls with `helper.updateMatrixWorld(true)`; one shared `addReferenceFile(slot, file)` for click and drop) and delete the unreachable old `createSurfaceGeometry` body.
3. Smoke test cold (cleared site data) **and** warm (§5.4).

---

## 4. How everything works

### 4.1 File map

| Path | Role |
|---|---|
| `index.html` | All markup: top bar, sidebar, five pages (`build`, `rig`, `animate`, `export`, `help`), toast region, an unused `<dialog id="confirmDialog">`. Loads only `styles.css` and `bootstrap.js`; `workspace-ui.*` arrive via the service worker |
| `bootstrap.js` | Classic script, no imports. Finds a working Three.js CDN, injects the import map, loads `src/main.js`; on failure starts **fallback mode** |
| `src/main.js` | App controller: state, UI wiring, views, avatars, reference upload, original silhouette fit, mesh import, motion UI, project save/load, GLB export, render loop, worker registration |
| `src/model.js` | Parametric humanoid: `createHumanoid`, 22-bone skeleton, implicit-surface body + marching tetrahedra, skinning, `JOINT_LIMITS`, pose helpers |
| `src/motion.js` | 12 procedural clips, 5 overlays, `blendPose`, custom keyframe evaluator, `createBakedClips` |
| `src/persistence.js` | IndexedDB save/load, file → data URL, download helpers |
| `src/reference-cutout.js` | Automatic background removal → `{dataUrl, originalDataUrl, maskDataUrl}` |
| `src/visual-hull.js` | Multi-view silhouette carving, surface extraction, skin binding (+ on-disk manual mask editor, dead after patching) |
| `src/skeleton-helper-compat.js` | Adds `SkeletonHelper.prototype.update()` (needed on r180) |
| `sw.js` | Service worker: precache, cache-first, **runtime source patching** (§3) |
| `workspace-ui.js` / `.css` | Fixed-viewport "compact workspace" layout and header restyle; injected by the worker only |
| `styles.css` | Main stylesheet (dark theme) |
| `scripts/process_uploads.py` | ZIP updater |
| `.github/workflows/unpack-upload.yml` | Runs the updater on pushes touching `upload/*.zip` or manually; commits as `github-actions[bot]` |
| `upload/` | Drop zone for update ZIPs. Contains **both** `README.md` and `README.MD` (case collision, KI-21) |
| `docs/deep-research-report.md` | Original research and phased plan (aspirational, §8) |
| `.update-delete.txt` | **Stale** leftover in the repo root (lists the deleted `forma-studio-fix/*`); inert there |
| `README.md`, `LICENSE` | Public docs (README is stale, KI-19) |

### 4.2 Boot sequence

1. `index.html` loads `styles.css` and `bootstrap.js` (deferred).
2. `bootstrap.js` requires `HTMLScriptElement.supports('importmap')`, then probes four bases in parallel — `cdn.jsdelivr.net`, `unpkg.com`, `fastly.jsdelivr.net`, `gcore.jsdelivr.net`, all `three@0.180.0` — with HEAD requests for `build/three.module.js` and `examples/jsm/controls/OrbitControls.js` (4.5 s timeout; a Cache API hit counts as success). First success wins (`window.FORMA_THREE_CDN`), the import map (`three`, `three/addons/`) is injected, and `<script type="module" src="./src/main.js">` is appended.
3. If anything fails, **fallback mode** starts: reference slots (click-to-choose; PNG/JPG/WebP/AVIF under 20 MB; up to 8), proportion sliders and presets, navigation, project name, Save (IndexedDB) and `.forma` download/open (references and shape only). All 3D actions show "needs the 3D engine" toasts. A runtime exception inside `main.js`'s `init()` does **not** trigger fallback (KI-18).
4. `main.js` `init()`: register `./sw.js` → `checkRuntimeSupport` → wire UI (`initNavigation`, `initShapeControls`, `initRigControls`, `initReferences`, `initMeshImport`, `initCameraControls`, `initMotionUI`, `initTopActions`) → `createPageViews('build')` → `createAllAvatars()` → UI sync → `loadSavedProject()` (auto-restores IndexedDB record `current`) → `requestAnimationFrame(frame)`.

### 4.3 UI map

- **Build** — reference grid `#referenceGrid` (slots carry `data-role`), `#fitReferences` (becomes the Reconstruct button after patching), model source (`fitted` or import via `#meshImport`: GLB/OBJ/PLY), viewport `#buildCanvas`, proportion sliders `#heightRange … #legRange`, presets (balanced/athletic/stylized), `#applyShape`.
- **Rig & pose** — bone list `.bone-row[data-bone]`, rotation sliders `#rotX/#rotY/#rotZ` clamped by `JOINT_LIMITS`, `#rigResetPose`, `#rigCanvas`. Only rotations are editable; there is no joint-position editing.
- **Animate** — `#sourceCanvas` (neutral grey rig, base clip only) vs `#resultCanvas` (character, base + masked additive overlay), one shared timeline (`#timelineRange`, `#playMotion`, `#stopMotion`, `#playSpeed`), motion library `#motionGrid` with filters, overlay controls (`#overlaySelect`, `#maskSelect`, `#blendRange`), `#addKeyframe`, `#saveCustomMotion`.
- **Export** — `#exportCanvas`, `#downloadGlb`, `#downloadProject`, a **static** validation list (KI-16), format panel (GLB direct, FBX via Blender).
- **Help** — static documentation cards. **Top bar** — project name, Open (`.forma`/`.json`), Save, Export GLB.

### 4.4 State and data

`state` in `main.js`: `shape`, `references`, `referenceSlots`, `meshMode` (`fitted` | `imported`), `importedRoot`, `importedAnimations`, `importedFileName`, `importedPointCloud`, `customMotions`, `draftFrames`, `baseMotion`, `overlayMotion`, `overlayMask`, `blendWeight`, `progress`, `playing`, `speed`, `activePage`, `selectedBone`, `showSkeleton`, `projectName`, `exporting` (+ `visualHullGeometry` via patch).

- **Shape** (percent, default 100): height 85–115, shoulders 75–135, chest 70–135, waist 70–135, hips 75–140, arms 80–120, legs 80–120.
- **Reference** object: `{ role, label, name, dataUrl, originalDataUrl?, maskDataUrl?, angleDeg? }`. Roles after patching: `front` (0°), `sideFacingLeft` (90°), `sideFacingRight` (270°), `back` (180°), `threeQuarter` (45°), extra `angle5…angle8` (angle = position in the references array × 45° mod 360, KI-15). Legacy `side`/`sideOpposite` are migrated on restore. Up to 8 slots.
- **`.forma` file** (pretty-printed JSON, also the IndexedDB payload):

```json
{ "format": "forma-project", "version": 1, "projectName": "Untitled character", "savedAt": "2026-11-23T12:00:00.000Z",
  "shape": { "height": 100, "shoulders": 100, "chest": 100, "waist": 100, "hips": 100, "arms": 100, "legs": 100 },
  "references": [ { "role": "front", "label": "Front", "name": "front.png", "dataUrl": "data:image/webp;base64,…",
                    "originalDataUrl": "data:image/jpeg;base64,…", "maskDataUrl": "data:image/png;base64,…", "angleDeg": 0 } ],
  "referenceSlots": [ { "role": "front", "label": "Front", "required": true } ],
  "customMotions": [ { "name": "My motion", "duration": 1.5, "loop": false, "category": "gesture",
                       "frames": [ { "time": 0.0, "pose": { "UpperArm_R": [0, 0, 1.2] } } ] } ],
  "baseMotion": "Idle", "overlayMotion": "", "overlayMask": "arms", "blendWeight": 0.65 }
```

Pose values are Euler XYZ in **radians**; keyframe `time` is normalised 0–1. **Not stored:** the reconstructed mesh, imported GLB/OBJ/PLY, selected bone, draft keyframes, camera (KI-09).

### 4.5 Parametric body, skeleton and skinning (`src/model.js`)

- **Skeleton — 22 bones:** `Hips` (root) → `Spine` → `SpineMid` → `Chest` → `Neck` → `Head`; `Chest` → `Clavicle_L/R` → `UpperArm` → `LowerArm` → `Hand`; `Hips` → `UpperLeg_L/R` → `LowerLeg` → `Foot` → `Toe`. No fingers, jaw or eyes. Offsets scale with the shape sliders. The character faces **+Z**; `_L` bones sit at **−X** (KI-06). Rest pose has horizontal, T-pose-like arm bones (KI-05).
- **Body mesh:** an implicit surface — ellipsoid/limb components (torso, head, face bits, limbs, hands, feet) combined by smooth union (blend radius 0.038·h) — sampled on a grid (spacing 0.039, or 0.052 when the viewport is ≤700 px wide) and extracted with marching tetrahedra. Per-vertex gradient normals, nearest-component colour, cylindrical UVs. Default shape: **44,436 vertices / 14,812 triangles, non-indexed** **[ran]**; generation is synchronous on the main thread (0.8–1.7 s measured in Node) on every Apply, preset, reset and project restore (KI-13).
- **Skinning:** each vertex binds to its 4 nearest bone *segments* (bone → first child bone; leaf bones are points), weight `1/(d+0.035)^2.6`, normalised.
- **Joint limits:** `JOINT_LIMITS[bone] = {x:[min,max], y:[…], z:[…], type}` in degrees; they are editor guardrails, not clinical data. Elbows and knees are hinge-biased (e.g. `LowerArm_L.z ∈ [−155,0]`, `LowerArm_R.z ∈ [0,155]`, `LowerLeg.x ∈ [0,145]`).
- **Avatars:** `createAllAvatars()` makes five (`build`, `rig`, `source` — neutral grey, `result`, `export`) that **share one geometry** (`geometryOverride`).

### 4.6 Reference images → reconstruction (patched runtime)

**On upload** `autoCutoutDataUrl` (`src/reference-cutout.js`) runs a deterministic colour segmentation — no AI:
analysis canvas ≤840 px; if >35 % of the border is transparent the source alpha is trusted; otherwise background = per-channel median of border pixels, tolerance = clamp(2.1 × median edge distance + 34, 38, 86), then a flood fill from the border through background-coloured pixels. If the kept area is <1.5 % or >94 % the original is kept with `maskDataUrl: null` ("needs manual refinement"). Output: `dataUrl` (transparent WebP ≤1800 px), `originalDataUrl` (JPEG, or WebP if the source had alpha), `maskDataUrl` (288×432 PNG preview mask).

**On "Reconstruct 3D character mesh"** → `buildVisualHull`:

1. Requires a `front` view, at least one side view and ≥2 views with ≥2 distinct angles (rounded to 10°). Each view is decoded from `originalDataUrl`, letter-boxed into 288×432, masked (saved mask, else colour threshold 48), bounding box must be ≥8×30 px, ≥180 px and <94 % of the canvas.
2. Extents: `halfX = clamp(frontAspect·1.82·0.5·1.045, 0.13, 0.82)`, `halfZ = clamp(widestSideAspect·1.82·0.5·1.045, 0.10, 0.70)`; aspect = mask box width/height.
3. **Carve** a voxel grid — 104×176×104 on desktop, 52×92×52 when the viewport is ≤720 px or `deviceMemory` ≤4 — over [−halfX,halfX]×[0,1.82]×[−halfZ,halfZ]. A voxel is solid iff its centre projects inside **every** view's mask (orthographic; horizontal = x·cosθ − z·sinθ; the mask box height maps to 1.82 units). Needs ≥500 solid voxels.
4. **Surface** (patched `createIsoSurfaceGeometry`): occupancy as a float field, three separable [1,2,1]/4 blur passes, marching tetrahedra at iso 0.48, welded vertices, outward-oriented triangles, computed normals; **vertex colour** = facing-weighted (cos^3.2) average of sRGB→linear samples from views facing the vertex; planar UVs; metadata in `geometry.userData.formaReconstruction`.
5. **Bind:** `applyVisualHullToAvatar` for all five avatars — clone, 4-nearest-segment weights `1/(d+0.025)^2.4` computed in rest pose, swap `SkinnedMesh.geometry`, `calculateInverses`, `bind`, enable vertex colours. Bones are **not** moved to fit the mesh (KI-14).
6. **Limits:** orthographic assumption, identical pose/scale/full body in every view, concavities stay filled, no texture (vertex colour only), `Back` fixed at 180° and `3/4` fixed at 45° (camera on the same side as "Side (facing left)"). Angle convention: camera at `(sinθ, cosθ)` in XZ; "facing left" = 90°.

### 4.7 Motion (`src/motion.js`)

- 12 clips via a `poseFor(name, t)` switch: Idle (3 s loop), Walk (1.15 s loop), Run (0.78 s loop), Crouch (2 s loop), Jump (1.15 s once), Wave (1.55 s loop), Punch (0.78 s once), Kick (0.92 s once), Sword Slash (1.05 s once), Hit React (0.8 s once), Roll (1.35 s once), Nod (1.2 s loop). Categories `full`/`upper`/`lower`/`gesture` drive the library filters.
- A pose is `{ boneName: [rx, ry, rz] }` in radians, Euler XYZ; `getMotionPose(name, normalisedTime)` wraps looping clips and clamps one-shots. The clips were tuned by eye against the current rig, including its rest-pose mismatch (KI-05).
- **Overlays** (`getOverlayPose`): Wave, Head Nod (alias of Nod), Guard, Point, Breathing. `blendPose(base, overlay, mask, weight)` adds overlay rotations (× weight) to the masked bones, then clamps to `JOINT_LIMITS`. Masks: `arms`, `rightArm`, `leftArm`, `upper` (Spine, SpineMid, Chest, Neck + both arms), `lower`, `head` (Neck, Head), `full`. The source view plays the base only; the result view plays base + overlay.
- **Custom motions:** `#addKeyframe` stores the **Rig-page pose** of `rigAvatar` at the current timeline progress (frames within 0.02 are replaced); ≥2 frames are required; the name comes from `window.prompt`; saved as `{name, duration: 1.5, loop: false, category: 'gesture', frames}`; interpolation is a per-angle linear blend of Euler values (no slerp).
- **Playback:** `requestAnimationFrame` loop, delta clamped to 50 ms, speed 0.5–2×.

### 4.8 Export (`downloadAnimatedGLB`)

Target is `buildAvatar.root` (or the imported root). The skeleton helper is detached during export. Animations = `createBakedClips(buildAvatar, customMotions, {baseName, overlayName, mask, weight})`: all 12 built-ins + custom motions + one extra clip `"<base> + <overlay>"` for the active blend, sampled at **30 fps**, **rotation-only** `<bone>.quaternion` tracks (no translation, no scale, so no root motion). `GLTFExporter.parse(..., {binary:true, animations, onlyVisible:true, trs:true, embedImages:true})`; file name is the slugified project name. Imported meshes export with their own embedded animations only; faceless PLY point clouds are blocked. Built-in clips are **not** clamped to `JOINT_LIMITS` in the bake (KI-07). FBX is intentionally not exported (use Blender).

### 4.9 Persistence

IndexedDB database `forma-studio-local` v1, store `projects`, one record `id: 'current'` → `{ id, updatedAt, project }`. **Save** overwrites it; it is auto-restored on startup ("Restored the last locally saved project"). There is no multi-project library. `.forma` download/open is the portable path. `bootstrap.js` has its own copy of the save code (same DB and key) for fallback mode.

### 4.10 Rendering and view lifecycle

`PAGE_VIEWS`: build → `[build]`, rig → `[rig]`, animate → `[source, result]`, export → `[export]`. `navigate()` **disposes** the previous page's views (renderer disposed, `forceContextLoss`, canvas replaced by a clone) and creates the new page's, to avoid holding many WebGL contexts. WebGL 2 only; mobile-leaning options (no antialias, pixel ratio ≤1 on mobile, ≤1.6 on desktop). The loop renders only the active page's views; Build and Export avatars play a looping Idle. Failure → `showWebGLError` notice with a Retry button.

### 4.11 Service worker caching and offline

`APP_FILES` precache: `./`, `index.html`, `bootstrap.js`, `styles.css`, `workspace-ui.css`, `workspace-ui.js`, `src/main.js`, `src/skeleton-helper-compat.js`, `src/visual-hull.js?v=8`, `src/reference-cutout.js?v=8`, `src/model.js`, `src/motion.js`, `src/persistence.js`. `install` → precache + `skipWaiting`; `activate` → delete every other cache + `clients.claim`; `fetch` (GET only) → same-origin and the four Three.js CDN prefixes are **cache-first** (cache → network → `cache.put`), and same-origin responses pass through `applyClientPatches`. Registered from `init()` as `./sw.js`, http(s) only.

### 4.12 Conventions

- Dark theme tokens in `styles.css` `:root`: `--bg #0b0d12`, `--panel #12161e`, `--accent #c9f36a`, `--blue #86a9ff`, `--warning #ffc46b`, `--danger #f38d8d`, `--radius 15px`. Breakpoints: 1450 / 1150 / 850 / 620 px (`styles.css`); 1150 / 850 / 480 px and `max-height: 700px` (`workspace-ui.css`).
- `workspace-ui.css` makes the shell a fixed `100dvh` app (no page scroll) — but only when the worker injected it.
- Fonts DM Sans, Space Grotesk and DM Mono are referenced but **never loaded** (KI-20).
- Helpers: `$`/`$$` query shortcuts, `toast(message, type, ms)`. Code is compact, with long single lines.

---

## 5. Delivery workflow

### 5.1 The ZIP updater (`scripts/process_uploads.py` + workflow) — verified in a scratch repo **[ran]**

| Topic | Behaviour |
|---|---|
| Trigger | A push touching `upload/*.zip`, or manual `workflow_dispatch`. Only ZIPs **directly** in `upload/` count |
| Layout | Files at repo-relative paths from the ZIP root (`src/main.js`, `index.html`, `HANDOFF.md`) |
| Wrapper stripping | If **every** entry shares one top-level folder and either (a) it normalises to `formastudio`, or (b) it normalises to the ZIP's file name **and that folder does not already exist in the repo**, the folder is removed. So `assets.zip` containing `assets/logo.png` (new folder) puts `logo.png` in the repo **root**. Name ZIPs like `2026-11-23-fix-dnd.zip` |
| Deletions | `.update-delete.txt` at the ZIP root, one repo-relative path per line; blank lines and `#` comments ignored; the manifest is never copied; deletions run **before** writes (a file shipped in the same ZIP wins); targets must be files |
| Protected | Deleting `.github/workflows/unpack-upload.yml` or `scripts/process_uploads.py` is refused |
| Order | ZIPs apply in filename order; later overrides earlier |
| **All-or-nothing** | Every ZIP is validated first. **One invalid ZIP fails the run, applies nothing, and stays in `upload/`, blocking every later run until it is deleted by hand** |
| Safety limits | ≤20 ZIPs, ≤10,000 files, ≤100 MiB per file, ≤500 MiB expanded, compression ratio ≤1000, no symlinks, no absolute or `..` paths, nothing under `.git/` |
| After success | ZIPs removed from `upload/`; bot commits "Apply uploaded ZIP update" and pushes to the same branch (must be the branch Pages serves) |
| Workflow files | The bot uses the default `GITHUB_TOKEN`; GitHub does not let that token modify `.github/workflows/*`, so a ZIP that changes a workflow file will likely fail at the push step — edit workflow files in the web UI. **[unverified]** |
| Plain uploads | Uploading a non-ZIP file (such as `HANDOFF.md`) with "Add file → Upload files" does **not** trigger the workflow |

### 5.2 Release checklist (every change)

1. Change the real source files — not the patch code in `sw.js`.
2. `node --check` every changed JS file.
3. Until R-1 is done: run `sim_patch.mjs`; it must print `all patches apply`; `node --check patched/*.mjs`.
4. **Bump `CACHE_NAME`** in `sw.js`; also the `?v=` of any patched module you changed (in `APP_FILES` and the patch strings).
5. If user-visible, update the version label in `index.html` (sidebar footer).
6. Update README and Help text if any behaviour claim changed.
7. Update `HANDOFF.md`: Last verified, status, issues, changelog.
8. Build the ZIP (repo-relative paths, unique name, `.update-delete.txt` if deleting). **Dry-run it:** fresh clone → copy ZIP into `upload/` → `python3 scripts/process_uploads.py --upload-dir upload` → `git status` shows exactly the intended changes.
9. Tell the owner the steps: GitHub → `upload/` → **Add file → Upload files** → drop the ZIP → **Commit to `main`** → Actions → *Apply uploaded ZIP updates* green → Pages deployment finished.
10. Ask the owner to run the smoke test (§5.4) and paste any console errors.

### 5.3 Local development

- `python3 -m http.server 8000` in the repo root, open `http://localhost:8000/`. The worker registers on localhost.
- Test **both** warm (worker active) and cold (Clear site data, or "Bypass for network") — the cold path is the crashing one (KI-02).
- `file://` has no worker, so it only ever shows the unpatched app.
- Scripts in Appendix A need Node ≥ 22 (older Node: copy `.js` to `.mjs` before `--check`).

### 5.4 Smoke test (owner, in a browser)

1. Fresh tab, DevTools console open → note errors. Reload once; `navigator.serviceWorker.controller` must be non-null.
2. **Build:** viewport renders a character; presets and sliders → *Apply proportions* rebuilds it.
3. Add *Front* and *Side (facing left)* images **by clicking** (drag-and-drop is known broken until R-1); backgrounds are removed.
4. *Reconstruct 3D character mesh* → progress → mesh appears, label reads `MULTI-VIEW 3D MESH · SKINNED`; orbit; toggle the skeleton.
5. **Rig & pose:** select bones, sliders clamp, Reset works.
6. **Animate:** play every clip; add an overlay, change mask and blend; add 2 keyframes (pose on the Rig page first) → save a custom motion.
7. **Export:** download the GLB; open it in Blender or a glTF viewer; check clips, skeleton, and shoulder/hip/knee deformation.
8. **Persistence:** Save → reload → auto-restore; download a `.forma` → Open it.
9. Import a GLB, an OBJ, a PLY; export.
10. Narrow window / phone: menu drawer works; no WebGL context errors.
11. Offline: after one online visit, reload in airplane mode.
12. Actions tab: green run; Pages deployment finished.

### 5.5 Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Old behaviour after a ZIP | `sw.js` unchanged (cache-first), or no reload after the worker updated | Bump `CACHE_NAME`; reload twice; Unregister + Clear site data |
| Empty viewport + toast "Startup problem: avatar.helper.update is not a function" | Unpatched app running (KI-02) | Reload normally; fix with R-1 |
| Toast "cutout is not defined" | Drag-and-drop upload (KI-03) | Use click-to-choose |
| "3D engine unavailable" banner | All four CDNs blocked/unreachable, or import maps unsupported | Other network, disable blocker, update browser; vendor Three.js (R-21) |
| Action did not run | ZIP not directly in `upload/`, not committed, wrong branch, Actions disabled, or a bad ZIP is blocking | Check Actions; delete the bad ZIP; run the workflow manually |
| Red run: `Update rejected: …` | Validation error in a ZIP | Fix or delete that ZIP in `upload/` |
| Green run, site unchanged | Pages deploy pending, or SW cache | Check the Pages deployment; see first row |
| Stray file in the repo root | Wrapper stripping (ZIP name = new folder name) | Delete via UI; rename the ZIP next time |
| "A view has no usable character silhouette… Auto mask, paint/erase" | Cutout failed (busy or low-contrast background); the editor named in the message does not exist (KI-08) | Plain contrasting background, or a pre-cut transparent PNG |
| Arms misaligned or left/right mirrored in an engine | KI-05 / KI-06 | Known; see R-6 / R-7 |

---

## 6. Roadmap (proposed)

*Proposed by the auditing chat on 2026-11-23 from the code, the research report and the issue list. **Not agreed with the owner.** Order rationale: while source ≠ runtime, every later change is riskier, so M0 comes first.*

| ID | Item | Fixes | Done when |
|---|---|---|---|
| **M0 — make the repo tell the truth** | | | |
| R-1 | Fold the runtime patches into real source (§3.5) | KI-01, 02, 03, 18 | `sw.js` has no patch code; cold first load starts cleanly; drag-and-drop works; behaviour otherwise identical (smoke test) |
| R-2 | One version constant (cache name, `?v=`, UI label); precache list matches requested URLs | KI-04 | One place to bump |
| R-3 | Docs and copy truth pass | KI-19 | README, Help page, in-UI text and code comments match behaviour; honesty section covers classical auto-cutout + visual hull |
| R-4 | Housekeeping: delete `upload/README.MD` and root `.update-delete.txt`; load or self-host the fonts | KI-20, 21 | Clone works on macOS/Windows; intended typography actually renders |
| R-5 | Harden the updater | KI-10 | A rejected ZIP no longer blocks later ones; stripping limited to an explicit rule; T1–T8 kept as a script |
| **M1 — rig and export correctness** | | | |
| R-6 | Rest-pose alignment (skeleton ↔ mesh) and re-tune the clips | KI-05 | `rig_check`: arm-axis gap ≲5° and hand-bone gap ≲0.05; all clips visually reviewed |
| R-7 | Anatomical L/R convention | KI-06 | `_L` bones on the character's left in Blender's front view; "Right" motions animate the right side |
| R-8 | Export hygiene: rest pose at export, clamp baked clips | KI-07, 11 | GLB default pose = rest pose; `rig_check` reports no clip over limit; preview = export |
| R-9 | Real validation panel | KI-16 | Computed from the live avatar and export; no hard-coded PASS |
| R-10 | Indexed/welded body mesh; generate off the main thread | KI-13 | ≈¼ the vertices; UI responsive on a mid-range phone |
| **M2 — reconstruction quality and UX** | | | |
| R-11 | Mask review/refine step before reconstructing | KI-08 | Users can see and fix each silhouette; messages point to tools that exist |
| R-12 | Persist or deterministically re-run the reconstruction; clear on new/open; angle control for every slot | KI-09, 15 | Opening a project never shows another project's mesh; extra slots have an angle |
| R-13 | Fit the skeleton to the reconstructed mesh; joint-position editor | KI-14 | Joints sit at shoulders/elbows/wrists/hips/knees/ankles of the mesh; plausible deformation in Blender |
| R-14 | Hull clean-up (islands, holes, optional smoothing) and a confidence / "unseen surface" indicator | — | Per the research report's two-view guidance |
| **M3 — animation** | | | |
| R-15 | Root motion (Hips translation), foot planting, optional in-place export | KI-12 | Jump and Roll leave and travel |
| R-16 | IK drag posing (CCD/FABRIK, honouring limits) | — | Dragging a hand or foot poses the limb |
| R-17 | Retarget imported GLB clips; optional CC0 clip pack with attribution | — | Imported clips play on the 22-bone rig |
| R-18 | Timeline editor: layers, keyframe edit/delete/move, slerp, dialog instead of `prompt()` | KI-22 | — |
| R-19 | Guided auto-rig for imported meshes | — | A static mesh can be fitted and weighted |
| **M4 — platform** | | | |
| R-20 | Tests and CI (`scripts/check.mjs`, updater tests); trigger via `workflow_run` or manual — **not** `push`, which bot commits do not fire | KI-25 | Checks run on every update |
| R-21 | Vendor Three.js into the repo | — | No CDN dependency; first run works offline |
| R-22 | Accessibility and mobile memory profile | — | Keyboard-operable sliders, bone list and timeline |

**Parked** (only if the owner asks): colmap-wasm in-browser SfM, SMPL fallback (CC-BY, needs attribution), WebGPU paths, photo-texture baking, neural reconstruction.

---

## 7. Known issues

Priority: P0 breaks users now or the delivery model · P1 wrong output or high risk · P2 notable · P3 polish. "Ev." = evidence tag.

| ID | Pri | Ev. | Issue | Fix |
|---|---|---|---|---|
| KI-01 | P0 | ran | **Runtime patch layer.** `sw.js` string-replaces three files on every request; any edit to a target string silently disables its patch. All patches apply at `34eda7b` | R-1 |
| KI-02 | P0 | ran / read | **Unpatched app crashes at startup.** `main.js` calls `avatar.helper.update()`; Three.js 0.180.0 has no such method; only the patch-imported shim adds it. First visit, hard reload, `file://`, SW-less hosts: `init()` throws in `createAllAvatars()` → empty viewport, "Startup problem" toast, no render loop, no restore. Exact call reproduced in Node; browser symptom inferred | R-1 (use `updateMatrixWorld(true)`) |
| KI-03 | P0 | ran | **Drag-and-drop onto a reference slot fails** with toast `cutout is not defined`, nothing stored. The patch wraps only the first `readFileAsDataURL` (`replace`) but rewrites both `references.push` calls (`replaceAll`). Click-to-choose works | R-1 (shared `addReferenceFile`) |
| KI-04 | P1 | read | **Cache-first worker + split versions.** App files refresh only when `sw.js` bytes change. Version ids are unrelated: UI 0.9.1, `CACHE_NAME` v8, `?v=8`, `?v=4`. `APP_FILES` precaches `workspace-ui.*` without `?v=4`, though the patched HTML requests the versioned URLs | R-2 |
| KI-05 | P1 | ran | **Skeleton and mesh disagree at rest.** Right-arm bone axis 3.1° below horizontal vs mesh axis 41.1°; `Hand_R` sits 0.377 units above the hand mesh (body ≈1.9 tall). Weights come from distance to the T-pose bones, so arm and shoulder vertices bind partly to torso bones; the skeleton overlay floats above the arms. Clips were tuned against this | R-6 |
| KI-06 | P1 | ran (positions) | **L/R look mirrored.** `_L` bones sit at −X while the character faces +Z; by the glTF convention (+Y up, +Z forward) a character's left is +X. Humanoid retargeters assume anatomical sides, and "Right"-labelled motions (Wave, Punch, Kick) animate the +X bone. Convention analysis, not an engine test — verify in Blender: with the model facing you, `UpperArm_L` should be on **your right** | R-7 |
| KI-07 | P1 | ran | **Baked clips are not clamped, the editor is.** `Roll` needs `Spine.x` ≈72° vs a ±35° limit (over by 37.3°); `Sword Slash` `Chest.z` over by 5.0°. Preview and exported GLB differ for those clips | R-8 |
| KI-08 | P1 | ran | **Manual mask editor unreachable.** It exists in on-disk `visual-hull.js` but the patch replaces `installVisualHullWorkflow` to end of file, so nothing builds it. If auto-cutout fails (`needs manual refinement`) the only fallback is a second colour threshold at reconstruct time, and the resulting error text tells users to use tools that do not exist. `reference-cutout.js` still claims "the existing mask editor remains usable" | R-11 |
| KI-09 | P1 | read | **Reconstruction is not persisted and not cleared.** It lives only in `state.visualHullGeometry`: absent from `.forma`/IndexedDB; not cleared by `restoreProject` or the "fitted" source choice, so opening another project re-applies the previous mesh to the new rig until reload. `applyShape()` also resets the label to `PARAMETRIC HUMANOID · SKINNED` while the hull is still applied | R-12 |
| KI-10 | P1 | ran | **Updater traps:** a bad ZIP blocks the queue; a ZIP named like a new top-level folder is stripped; ZIPs cannot change workflow files (likely) | R-5, §5.1 |
| KI-11 | P2 | read | **Export default pose.** The GLB is built from `buildAvatar`, which the Build page animates with Idle each frame, so joint default rotations are an arbitrary idle snapshot (a few degrees off rest) | R-8 |
| KI-12 | P2 | read | **No root motion.** Clips carry only `<bone>.quaternion` tracks. Jump and Roll neither leave the ground nor travel; Walk and Run are in place | R-15 |
| KI-13 | P2 | ran | **Body mesh is non-indexed** (44,436 vertices for 14,812 triangles, 3× duplication) and built synchronously on the main thread on every Apply, preset, reset and restore. Larger GLBs; stalls on weak devices | R-10 |
| KI-14 | P2 | read | **Skeleton is not fitted to a reconstructed mesh**, and the Build page says "Fine-tune the joint placement in Rig & pose" although only rotations are editable | R-13 |
| KI-15 | P2 | read | **Extra "Angle N" slots have no angle control** (angle = array position × 45° mod 360, so duplicates are possible); `Back` is fixed at 180° and `3/4` at 45° — a 3/4 photo from the other side carves wrongly | R-12 |
| KI-16 | P2 | ran | **Export "Model validation" is static HTML** (hard-coded PASS rows and "4 / 5"); nothing computes or updates it | R-9 |
| KI-17 | P2 | read | **Fallback-mode Save writes `customMotions: []`** over the single IndexedDB record; fallback never auto-restores a project, so saved custom motions can be lost | R-1 / R-5 follow-up |
| KI-18 | P2 | ran | **`forma:startup-error` has no listener.** A failure inside `init()` leaves a half-initialised UI instead of entering fallback mode | R-1 |
| KI-19 | P2 | read | **Stale docs and copy.** README never mentions auto cutout, visual-hull reconstruction, side-facing slots or the patch layer, and says the app does not claim "automatic segmentation" (it now does classical, non-AI background removal). `.gltf` is accepted by the file input and named in the source card but rejected in code (GLB/OBJ/PLY only). Button label differs between the HTML patch ("Reconstruct 3D mesh from views") and the workflow ("Reconstruct 3D character mesh", which also drops the ↗ icon) | R-3 |
| KI-20 | P3 | ran | **Fonts never load.** DM Sans, Space Grotesk and DM Mono are referenced (1, 14 and 38 uses respectively) but there is no `@font-face` or font link anywhere | R-4 |
| KI-21 | P3 | ran | **Duplicate `upload/README.md` and `upload/README.MD`** (breaks clones on case-insensitive file systems); stale root `.update-delete.txt` | R-4 |
| KI-22 | P3 | read | **UX nits:** custom motions are named with `window.prompt`; the `<dialog id="confirmDialog">` is unused; draft keyframes survive opening another project; keyframe interpolation is Euler-lerp | R-18 |
| KI-23 | P3 | read | **Storage size:** each reference can hold three data URLs (cutout, original, mask) × up to 8 slots; project files and the IndexedDB record may be large. Not measured | R-12 |
| KI-24 | P3 | read | **Dead code:** the original silhouette-fit path, the on-disk mask-editor helpers, `initExport()` (empty), unused exports `createRestPose`, `restoreAvatarPose`, `BONE_ORDER`, and the imported-but-unused `clampBoneRotation` | R-1 |
| KI-25 | P3 | read | **No tests or CI.** Bot commits made with the default `GITHUB_TOKEN` do not start other workflows (documented GitHub behaviour), so a `push`-triggered CI would not run for them | R-20 |

---

## 8. Research plan vs reality

`docs/deep-research-report.md` proposes a 7-phase plan. It is aspirational; the implementation took a different route.

| Research item | Status | Notes |
|---|---|---|
| Browser SfM (colmap-wasm), sparse cloud, offline photogrammetry | Not started | README tells users to run COLMAP/Meshroom locally and import a GLB |
| Gaussian splatting / NeRF | Not planned | The report itself says offline-only |
| Two-view fallback | **Done differently** | Classical visual hull + iso-surface + vertex colours instead of an SMPL fit |
| SMPL body fitting | Not used | CC-BY would need an attribution line |
| Mesh clean-up, retopology, auto-UV, watertight diagnostics | Not started | UVs are planar/cylindrical projections |
| Auto-rig with named skeleton and proximity weights | Partial | Fixed 22-bone template; no fit/placement UI; no weight painting |
| Joint limits | Done (approximate) | Editor clamps; the bake does not (KI-07) |
| Animation library from CC0 clips | Different | 12 hand-authored procedural clips; no external clips or retargeting |
| Layering, masking, blending | Partial | One base + one masked additive overlay; no multi-clip timeline |
| Inverse kinematics | Not started | — |
| Split view: source vs result | Done | — |
| GLB/OBJ/PLY import | Done | `.gltf` rejected; no auto-rig, no retarget |
| Animated GLB export | Done | Rotation-only tracks at 30 fps |
| FBX | By design via Blender | — |
| Local-first storage, `.forma` project files | Done | Single IndexedDB slot |
| Confidence meter, uncertain-region highlight | Not in the runtime flow | The original silhouette-fit toast had a "capture confidence" number |
| Web Workers, WebGPU, low-quality mode | Partial | Coarser grids and lighter renderer options on mobile only |
| CSP / security headers | Not done | No CSP meta tag |
| QA acceptance criteria and tests | Not done | Validation panel is static |

---

## 9. Open decisions and unverified items

**Decisions needed from the owner**

- **D-1** Fold the patch layer into the source (R-1)? Recommended: yes, first.
- **D-2** Manual mask editing: restore it as an optional "refine mask" step, redesign it, or remove it?
- **D-3** Rest-pose standard: T-pose or A-pose? Pick one; the mesh and bones must agree.
- **D-4** Confirm the anatomical L/R convention, and which side Wave/Punch/Kick should use.
- **D-5** Persist the reconstruction in project files (bigger files) or re-run it on open?
- **D-6** Vendor Three.js into the repo (offline first run, no CDN trust)?
- **D-7** Priority among reconstruction quality, animation tooling, export quality and mobile.
- **D-8** Add tests and CI?
- **D-9** What is the live site URL, and should it appear in the README?

**Not verified by anyone (as of this writing)**

- **U-1** GitHub Issues, Pages settings and URL, Actions history, and whether Pages redeploys after the bot's commits. (The unauthenticated API was rate-limited from the sandbox; the repo is not search-indexed.)
- **U-2** Everything in a real browser. All runtime statements here come from code reading and Node simulation. Not seen: the first-load crash, patched behaviour, cutout quality, reconstruction output, GLBs in Blender/Unity/Godot/Unreal.
- **U-3** Safari, Firefox, mobile, low-memory devices, WebGL context loss.
- **U-4** Real project and IndexedDB sizes with 8 views.
- **U-5** Whether a ZIP that changes a workflow file really fails at the push step.
- **U-6** Preferences and decisions from earlier chats (not visible to the author).

---

## 10. Changelog

| Date | Change | Files | Cache id |
|---|---|---|---|
| 2026-11-22 | Repo built in one day (53 commits): updater workflow and script, full app upload, roughly twenty ZIP iterations, removal of an accidental `forma-studio-fix/` folder that an earlier updater version created (three delete commits plus `.update-delete.txt`), research report added. *Reconstructed from `git log`; per-iteration detail was not recorded.* | many | ends at `forma-studio-auto-cutout-v8` |
| 2026-11-23 | Audit and this handoff document. No application code changed | `HANDOFF.md` | unchanged (`…-v8`) |

*Add a row per session: date · what changed and why · files · new `CACHE_NAME`.*

---

## Appendix A. Verification scripts

Setup (scratch directory outside the repo):

```bash
mkdir -p ~/forma-verify/lib && cd ~/forma-verify
npm init -y && npm pkg set type=module && npm i three@0.180.0
cp /path/to/Forma-Studio/src/model.js /path/to/Forma-Studio/src/motion.js lib/    # re-copy after changing them
```

Syntax check of every JS file (Node ≥ 22):

```bash
cd /path/to/Forma-Studio && for f in bootstrap.js sw.js workspace-ui.js src/*.js; do node --check "$f" || echo "FAIL $f"; done
```

### A.1 `sim_patch.mjs` — do the runtime patches still apply?

Run: `node sim_patch.mjs /path/to/Forma-Studio`, then `for f in patched/*.mjs; do node --check "$f"; done`.

```js
// sim_patch.mjs — runs sw.js's REAL patch functions against the repo files and reports which patches apply.
// Usage (from the scratch dir):  node sim_patch.mjs /path/to/Forma-Studio
import fs from 'fs';
import vm from 'vm';

const ROOT = process.argv[2] || '.';
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const ctx = vm.createContext({
  self: { addEventListener() {}, location: { origin: 'https://x.github.io' } },
  caches: {}, Headers, Response, URL, console,
});
vm.runInContext(read('sw.js'), ctx);
const fn = (name) => vm.runInContext(name, ctx);

const main = fn('patchMainModule')(read('src/main.js'));
const hull = fn('patchVisualHullModule')(read('src/visual-hull.js'));
const html = await (await fn('applyClientPatches')(
  new Response(read('index.html'), { status: 200 }),
  new URL('https://x.github.io/Forma-Studio/index.html'),
)).text();

fs.mkdirSync('patched', { recursive: true });
fs.writeFileSync('patched/main.mjs', main);          // what the browser really executes
fs.writeFileSync('patched/visual-hull.mjs', hull);
fs.writeFileSync('patched/index.html', html);

const expected = [
  [main, "import './skeleton-helper-compat.js';"],
  [main, "from './visual-hull.js?v=8'"],
  [main, "from './reference-cutout.js?v=8'"],
  [main, 'visualHullGeometry:null'],
  [main, "role:'sideFacingLeft'"],
  [main, 'const cutout=await autoCutoutDataUrl('],
  [main, 'applyVisualHullToAvatar(THREE,avatar,state.visualHullGeometry)'],
  [main, 'installVisualHullWorkflow(THREE,'],
  [hull, 'sideFacingLeft: 90'],
  [hull, 'return createIsoSurfaceGeometry(THREE, grid, views, onProgress);'],
  [hull, "fitButton.textContent = 'Reconstruct 3D character mesh';"],
  [html, 'workspace-ui.css?v=4'],
  [html, 'Reconstruct 3D mesh from views'],
  [html, 'Backgrounds are removed automatically'],
];
let broken = 0;
for (const [source, needle] of expected) {
  const ok = source.includes(needle);
  if (!ok) broken++;
  console.log(ok ? 'APPLIED' : 'NO-OP  ', needle);
}
console.log(broken ? `\n${broken} patch(es) NOT applying` : '\nall patches apply');
console.log('next: for f in patched/*.mjs; do node --check "$f"; done');
process.exit(broken ? 1 : 0);
```

### A.2 `rig_check.mjs` — rig, mesh and clip numbers

Run: `node rig_check.mjs`.

```js
// rig_check.mjs — numeric regression checks for the generated rig, mesh and built-in motions.
// Needs ./lib/model.js and ./lib/motion.js (copies of the repo's src files) and `three@0.180.0` in node_modules.
import * as THREE from 'three';
import { createHumanoid, DEFAULT_SHAPE, JOINT_LIMITS } from './lib/model.js';
import { MOTIONS, getMotionPose, getOverlayPose } from './lib/motion.js';

const t0 = performance.now();
const av = createHumanoid(DEFAULT_SHAPE);
const pos = av.mesh.geometry.getAttribute('position');
console.log(`body: ${pos.count} verts, indexed=${!!av.mesh.geometry.index}, built in ${Math.round(performance.now() - t0)} ms`);

av.root.updateMatrixWorld(true);
const wp = (name) => av.boneMap[name].getWorldPosition(new THREE.Vector3());
console.log('L/R : UpperArm_L x =', wp('UpperArm_L').x.toFixed(3), '| character faces +Z =', wp('Toe_L').z > wp('Foot_L').z);

// Rest-pose alignment, right arm: angle below horizontal of the skeleton vs the mesh, and hand gap.
const arm = [];
for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0.42) arm.push([pos.getX(i), pos.getY(i)]);
arm.sort((a, b) => a[0] - b[0]);
const avg = (list, k) => list.reduce((s, v) => s + v[k], 0) / list.length;
const q = Math.floor(arm.length * 0.15);
const inner = arm.slice(0, q), outer = arm.slice(-q), tip = arm.slice(-Math.floor(arm.length * 0.05));
const below = (dx, dy) => (Math.atan2(-dy, dx) * 180 / Math.PI).toFixed(1);
const hand = wp('Hand_R'), upper = wp('UpperArm_R');
console.log('arm : axis below horizontal  mesh', below(avg(outer, 0) - avg(inner, 0), avg(outer, 1) - avg(inner, 1)),
  'deg | skeleton', below(hand.x - upper.x, hand.y - upper.y), 'deg');
console.log('arm : Hand_R bone y minus hand-mesh y =', (hand.y - avg(tip, 1)).toFixed(3));

// Built-in clips vs JOINT_LIMITS (the editor clamps to limits; the GLB bake does not).
const limits = {};
for (const [bone, l] of Object.entries(JOINT_LIMITS)) limits[bone] = ['x', 'y', 'z'].map((a) => l[a].map(THREE.MathUtils.degToRad));
const worst = {};
const scan = (label, poseAt) => {
  for (let s = 0; s <= 400; s++) {
    for (const [bone, rot] of Object.entries(poseAt(s / 400))) {
      rot.forEach((v, i) => {
        const [lo, hi] = limits[bone]?.[i] ?? [-Infinity, Infinity];
        const over = v < lo ? lo - v : v > hi ? v - hi : 0;
        const key = `${label} ${bone}.${'xyz'[i]}`;
        if (over > 1e-6) worst[key] = Math.max(worst[key] || 0, (over * 180) / Math.PI);
      });
    }
  }
};
MOTIONS.forEach((m) => scan(m.name, (t) => getMotionPose(m.name, t)));
['Wave', 'Head Nod', 'Guard', 'Point', 'Breathing'].forEach((o) => scan(`overlay ${o}`, (t) => getOverlayPose(o, t)));
console.log('clips over limit (deg):', Object.keys(worst).length ? worst : 'none');
```

### A.3 Baselines measured at `34eda7b`

| Metric | Value |
|---|---|
| Body mesh | 44,436 vertices, 14,812 triangles, not indexed |
| Right-arm axis below horizontal | mesh **41.1°** · skeleton **3.1°** |
| `Hand_R` bone y minus hand-mesh y | **0.377** |
| Clips over `JOINT_LIMITS` | `Roll` `Spine.x` +37.3° · `Sword Slash` `Chest.z` +5.0° |
| `_L` bone x / facing | `UpperArm_L` x = −0.235, character faces +Z |
| Patch simulation | all patches apply; patched files pass `node --check` |

After fixing KI-05, KI-06 or KI-07, update these baselines and the matching issue rows.

### A.4 Updater dry-run cases (reproduce in a scratch repo with `scripts/process_uploads.py` and Python's `zipfile`)

| # | ZIP contents | Expected result |
|---|---|---|
| T1 | `assets.zip` → `assets/logo.txt`, folder `assets/` absent | `logo.txt` lands in the repo **root** (wrapper stripped) |
| T2 | `src.zip` → `src/new.js`, folder `src/` exists | `src/new.js` |
| T3 | `forma-studio.zip` → `forma-studio/index.html` | `index.html` (legacy wrapper stripped) |
| T4 | one invalid ZIP plus one valid ZIP | exit 1, nothing applied, both stay in `upload/`; applies only after the invalid one is deleted |
| T5 | `.update-delete.txt` naming the workflow file | refused, exit 1 |
| T6 | manifest (comment, blank, one path) plus a new file | path deleted, file added, manifest not copied |
| T7 | entry `../evil.txt` | refused, exit 1 |
| T8 | `a-first.zip` and `b-second.zip` both write `order.txt` | content from `b-second.zip` |
