# Forma Studio — Character Lab

A local-first, static browser application for reference-guided humanoid fitting, skeletal posing, procedural motion layering, and animated GLB export. It is designed for GitHub Pages and modern desktop/mobile browsers with WebGL.

## Run it

This is a static site: no package manager, build step, API key, backend, account, or server-side inference is required.

- Open `index.html` from a local static web server, or deploy the folder to GitHub Pages.
- The first launch needs an internet connection to load Three.js and its official addon modules. The bootloader tries several free CDN hosts automatically and caches the selected modules for later offline use where the browser permits it. If all hosts are blocked, image previews, reference management, navigation and project backups still work; 3D editing and GLB export show a clear unavailable message rather than leaving the page inert.
- WebGL must be available. Desktop Chrome/Firefox and recent Android browsers are the main targets.

### GitHub Pages

1. Put the contents of this folder at the repository root (or set Pages to the folder containing `index.html`).
2. In GitHub, open **Settings → Pages** and choose **Deploy from a branch**, the desired branch, and `/ (root)`.
3. Open the published Pages URL. No build action or secret is required.

## Current working capabilities

- Local image-reference slots for front, side, back, three-quarter and up to four additional views. Images are stored in IndexedDB only when the user saves the project; there is no image upload endpoint.
- A parameter-driven humanoid builder that extracts a continuous triangulated surface from a smooth-union implicit body field (marching tetrahedra), with vertex colors, cylindrical-projection UVs, a named 22-bone skeleton, normalized four-influence skin weights, and a real Three.js `SkinnedMesh`.
- Body proportion presets and independent height, shoulder, chest, waist, hip, arm and leg controls.
- A rig hierarchy and joint editor with per-joint rotation ranges and a visible skeleton helper.
- Twelve procedural motion clips (idle, walk, run, crouch, jump, wave, punch, kick, sword slash, hit reaction, roll and nod), plus body-region masked additive overlays.
- Synchronized source-rig and character previews, one shared playhead, playback speed, and timeline scrubbing.
- Pose keyframes can be captured from the rig editor and saved as custom motions in a project.
- Animated GLB export. The exporter bakes the built-in and custom clips at 30 fps, and includes the current selected base-plus-overlay blend as a separate clip.
- GLB, OBJ and PLY import for inspection and GLB packaging. Existing embedded GLB animation data is preserved on direct export; external clips are not retargeted or edited in this workspace. Imported unrigged meshes are not automatically rigged. Single-file GLB is the recommended import format; PLY point clouds without faces are preview-only and must be converted to a surface mesh before export.
- Local IndexedDB save/restore and portable `.forma` project-file download/open. Project files preserve reference images, proportions and custom motion data; an imported external mesh is exported separately as GLB.

## Honest reconstruction boundary

Two stationary images do not uniquely determine the hidden 3D volume, topology, material texture, occluded parts, or backside. The app measures front/side silhouettes on contrasting backgrounds to estimate a small set of body proportions; it then rebuilds an editable procedural humanoid base. It does not reconstruct the subject’s exact identity, clothing details, or surface appearance. The app does **not** claim neural image-to-3D, Gaussian-splat-to-mesh conversion, automatic photogrammetry, automatic segmentation, or photo-texture baking.

For a real scan, capture many overlapping photos around the subject and reconstruct locally with tools such as COLMAP or AliceVision/Meshroom. Clean and retopologize the scan, unwrap UVs and bake textures in Blender/MeshLab, then import a single-file GLB here. Gaussian splats are primarily a novel-view rendering representation; they are not a replacement for a clean, riggable, watertight character mesh.

## Rig and motion notes

The generated model uses 22 labeled bones and proximity-derived skin weights with four influences per vertex. The continuous surface is a non-indexed triangle mesh; its UVs are a general cylindrical projection rather than production seam-packed UV islands. This is a practical starter humanoid rig, not a studio-quality deformation rig. Production characters may need additional twist bones, facial/eye/hand rigs, corrective shape keys, collision-aware IK, cloth/hair simulation and manual weight-painting. The joint limits are approximate editor guardrails; they are not medical or clinical range-of-motion data.

Procedural motions are hand-authored joint curves, not motion-capture recordings or biomechanical simulations. The current browser editor does not implement inverse-kinematics drag targets or retarget animation clips between unrelated skeletons. The split view shows the same base motion on a neutral source rig and the target character; the target can add a masked overlay. Custom motions are built by posing bones in the Rig & pose page, scrubbing the Animate timeline, adding at least two keyframes, and saving the motion.

## Export compatibility

- **Godot:** Import the GLB directly. Check the Skeleton3D and AnimationPlayer/AnimationLibrary after import.
- **Unreal Engine:** Import the GLB with a supported glTF importer/plugin, or convert the GLB to FBX in Blender and import the FBX as a skeletal mesh with animations.
- **Unity:** Import GLB with a glTF package, or convert through Blender to FBX when the project uses an FBX workflow.
- **Blender:** Open the GLB to inspect mesh, armature, skinning and animation actions.

FBX is intentionally not exported natively by this page. The Autodesk FBX SDK is not an open browser export dependency; Blender is the free conversion route.

## Zero-cost and privacy model

No paid API, model endpoint, subscription, usage token or cloud GPU is called. Geometry generation, rig posing, motion evaluation, preview and GLB export run locally in the browser. Reference images and project data are not sent to a service. The only network dependency on first load is the free jsDelivr delivery of Three.js; GitHub Pages hosting is also free for public repositories subject to GitHub's standard usage terms. Heavy photogrammetry or Gaussian-splat training still consumes local CPU/GPU and memory and is not magically free of hardware requirements.

## Dependencies and licenses

- Three.js and official addon modules: MIT License — https://github.com/mrdoob/three.js/blob/dev/LICENSE
- Forma Studio application source: MIT License (see `LICENSE`).
- No SMPL body model, third-party character mesh, or third-party animation pack is redistributed in this repository. The built-in motion curves are authored in this source code.

## Validation status

The repository includes syntax-checkable source modules and a static deployment setup. The browser implementation provides a functional local character-fitting, rigging, motion and GLB workflow, but it is not a substitute for a full DCC pipeline or a formally certified production-character generator. Test exported GLBs in the exact engine/version and target platform used by your game, with special attention to shoulders, hips, elbows, knees, foot contacts, UVs, materials, and animation retargeting.

## Startup and image-upload troubleshooting

The plain JavaScript bootloader (`bootstrap.js`) loads the 3D engine only after checking free CDN availability. If a CDN is blocked by a network filter, browser content blocker or DNS issue, it falls back to a limited mode where image selection and previews, navigation, proportion values and project-file backups remain available. The 3D viewport and GLB export require the Three.js modules to load. Try reloading on a different network or disabling a content blocker for the Pages site. The reference picker accepts PNG, JPG, WebP and AVIF; images must be under 20 MB.

The reference images are local browser files; they are not uploaded to GitHub or a server. Save a project locally or download a `.forma` file to retain the images between browsers/devices.

## Incremental ZIP update workflow

After the initial installation, the repository includes a GitHub Actions workflow that applies update ZIPs uploaded to `upload/`.

### One-time bootstrap

The complete Forma Studio package must first be extracted and uploaded to the repository root. Keep the hidden `.github/workflows/unpack-upload.yml` and `scripts/process_uploads.py` paths; GitHub Actions needs both to process later uploads. This bootstrap cannot be performed by uploading the ZIP into `upload/` because a workflow must already exist in the repository before GitHub can run it.

In **Settings → Actions → General → Workflow permissions**, allow the workflow to have read and write repository permissions. The workflow itself declares `contents: write`.

### Future updates

1. Create an incremental `.zip` containing only the files being added or replaced. Store each file at its repository-relative path inside the archive, such as `src/main.js` or `styles.css`. Do not include a parent project folder.
2. To delete existing files, add a UTF-8 `.update-delete.txt` at the ZIP root. List one repository-relative file path per line; blank lines and lines beginning with `#` are ignored. The manifest is not extracted as a repository file.
3. Upload the ZIP directly into `upload/` on the same branch configured for GitHub Pages, then commit it. The workflow validates and extracts the archive into the repository root, commits the result, and removes the uploaded ZIP.
4. Open **Actions → Apply uploaded ZIP updates** and confirm the run succeeded. If it did not trigger, run it manually with `workflow_dispatch` after committing the ZIP.

The updater also accepts a complete initial package that has a single `forma-studio/` top-level folder and strips that wrapper automatically. It rejects path traversal, absolute paths, symbolic links, oversized archives and suspicious compression ratios. When several ZIPs are uploaded together, they are applied in filename order; later archives can replace files written by earlier ones.
