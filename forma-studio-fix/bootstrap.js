/*
 * Forma Studio bootloader.
 * This file intentionally has no module imports so the reference uploader and
 * basic workspace remain usable if a third-party 3D CDN is unavailable.
 */
(() => {
  'use strict';

  const THREE_VERSION = '0.180.0';
  const CDN_BASES = [
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`,
    `https://unpkg.com/three@${THREE_VERSION}`,
    `https://fastly.jsdelivr.net/npm/three@${THREE_VERSION}`,
    `https://gcore.jsdelivr.net/npm/three@${THREE_VERSION}`,
  ];
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const DEFAULT_SLOTS = [
    { role: 'front', label: 'Front', required: true },
    { role: 'side', label: 'Side', required: true },
    { role: 'back', label: 'Back', required: false },
    { role: 'threeQuarter', label: '3/4 view', required: false },
  ];
  let fallbackStarted = false;
  let fallbackReferences = [];
  let fallbackSlots = DEFAULT_SLOTS.map((slot) => ({ ...slot }));
  let fallbackShape = { height: 100, shoulders: 100, chest: 100, waist: 100, hips: 100, arms: 100, legs: 100 };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function toast(message, type = 'info', duration = 4200) {
    const region = $('#toastRegion');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), duration);
  }

  async function probeCdn(base) {
    const coreUrl = `${base}/build/three.module.js`;
    const controlsUrl = `${base}/examples/jsm/controls/OrbitControls.js`;
    // Permit an offline start after a previous successful visit has cached the modules.
    if ('caches' in window) {
      const cached = await Promise.all([caches.match(coreUrl), caches.match(controlsUrl)]);
      if (cached.every((response) => response?.ok)) return base;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const paths = [coreUrl, controlsUrl];
      const responses = await Promise.all(paths.map((url) => fetch(url, {
        method: 'HEAD',
        mode: 'cors',
        cache: 'force-cache',
        signal: controller.signal,
      })));
      if (responses.every((response) => response.ok)) return base;
      throw new Error(`CDN responded with ${responses.map((response) => response.status).join('/')}`);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function findThreeCdn() {
    const checks = CDN_BASES.map((base) => probeCdn(base));
    if (typeof Promise.any === 'function') return Promise.any(checks);
    return new Promise((resolve, reject) => {
      let pending = checks.length;
      checks.forEach((check) => check.then(resolve, (error) => {
        pending -= 1;
        if (pending === 0) reject(error);
      }));
    });
  }

  function injectImportMap(base) {
    const script = document.createElement('script');
    script.type = 'importmap';
    script.textContent = JSON.stringify({
      imports: {
        three: `${base}/build/three.module.js`,
        'three/addons/': `${base}/examples/jsm/`,
      },
    });
    document.head.appendChild(script);
  }

  function loadMainModule() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = new URL('./src/main.js', document.baseURI).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('The Forma Studio 3D modules could not be loaded.'));
      document.body.appendChild(script);
    });
  }

  function setEngineUnavailable(message) {
    const status = $('.intro-status');
    if (status) status.innerHTML = '<span class="status-dot status-dot-warning"></span> 3D engine offline · image tools available';
    const overlay = $('#viewportLoading');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.innerHTML = `
        <strong>3D engine unavailable</strong>
        <span class="engine-error-copy">${escapeHtml(message)}</span>
        <span class="engine-error-copy">Reference images, project backup and navigation still work. Reconnect or try another network for 3D editing and GLB export.</span>
        <button class="button button-outline" id="retryEngine" type="button">Retry 3D engine</button>`;
      $('#retryEngine')?.addEventListener('click', () => window.location.reload());
    }
    $('#modelSourceLabel')?.replaceChildren(document.createTextNode('3D ENGINE NOT CONNECTED'));
    toast('3D engine could not load. Image previews and project backup remain available.', 'error', 7000);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function projectData() {
    return {
      format: 'forma-project',
      version: 1,
      projectName: ($('#projectName')?.value || 'Untitled character').trim() || 'Untitled character',
      savedAt: new Date().toISOString(),
      shape: { ...fallbackShape },
      references: fallbackReferences.map((reference) => ({ ...reference })),
      referenceSlots: fallbackSlots.map((slot) => ({ ...slot })),
      customMotions: [],
      baseMotion: 'Idle',
      overlayMotion: '',
      overlayMask: 'arms',
      blendWeight: 0.65,
      fallbackBackup: true,
    };
  }

  function openFallbackDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('Local browser storage is unavailable. Use Project file to download a backup.'));
      const request = indexedDB.open('forma-studio-local', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local project storage.'));
    });
  }

  async function saveFallbackProject() {
    const db = await openFallbackDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite');
      transaction.objectStore('projects').put({ id: 'current', updatedAt: new Date().toISOString(), project: projectData() });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Local save failed.')); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Local save was interrupted.')); };
    });
  }

  function supportedImage(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    return ['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(type)
      || /\.(png|jpe?g|webp|avif)$/i.test(name);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('The browser could not read this image.'));
      reader.readAsDataURL(file);
    });
  }

  function updateReferenceCount() {
    const counter = $('#referenceCount');
    if (counter) counter.textContent = `${fallbackReferences.length} / 8`;
  }

  function updateReferenceSlot(slot, reference = null) {
    const label = $(`.reference-slot[data-role="${CSS.escape(slot.role)}"]`);
    if (!label) return;
    let input = $('input[type="file"]', label);
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      label.appendChild(input);
    }
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'reference-file-input';
    input.removeAttribute('hidden');
    input.setAttribute('aria-label', `Choose ${slot.label} reference image`);

    [...label.children].forEach((child) => { if (child !== input) child.remove(); });
    label.classList.toggle('has-image', Boolean(reference));
    label.classList.toggle('primary-slot', Boolean(slot.required));

    if (reference) {
      const image = document.createElement('img');
      image.src = reference.dataUrl;
      image.alt = `${slot.label} reference preview`;
      image.decoding = 'async';
      label.appendChild(image);
      const badge = document.createElement('span');
      badge.className = 'slot-label';
      badge.textContent = slot.label.toUpperCase();
      label.appendChild(badge);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'slot-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${slot.label} reference`);
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        fallbackReferences = fallbackReferences.filter((item) => item.role !== slot.role);
        updateReferenceSlot(slot);
        updateReferenceCount();
      });
      label.appendChild(remove);
    } else {
      const add = document.createElement('span');
      add.className = 'slot-add';
      add.textContent = '＋';
      label.appendChild(add);
      const title = document.createElement('strong');
      title.textContent = slot.label;
      label.appendChild(title);
      const subtitle = document.createElement('small');
      subtitle.textContent = slot.required ? 'Required' : 'Optional';
      label.appendChild(subtitle);
    }

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_IMAGE_BYTES) {
        toast('Choose an image smaller than 20 MB.', 'error');
        input.value = '';
        return;
      }
      if (!supportedImage(file)) {
        toast('Choose a PNG, JPG, WebP or AVIF image.', 'error');
        input.value = '';
        return;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        fallbackReferences = fallbackReferences.filter((item) => item.role !== slot.role);
        fallbackReferences.push({ role: slot.role, label: slot.label, name: file.name, dataUrl });
        updateReferenceSlot(slot, fallbackReferences.find((item) => item.role === slot.role));
        updateReferenceCount();
        toast(`${slot.label} image added. It is stored only in this browser.`, 'success');
      } catch (error) {
        toast(error.message || 'Image upload failed.', 'error');
      }
    };
  }

  function renderFallbackReferences() {
    fallbackSlots.forEach((slot) => updateReferenceSlot(slot, fallbackReferences.find((item) => item.role === slot.role)));
    updateReferenceCount();
  }

  function updateShapeValue(key, value) {
    fallbackShape[key] = Number(value);
    const prefix = { height: 'height', shoulders: 'shoulder', chest: 'chest', waist: 'waist', hips: 'hip', arms: 'arm', legs: 'leg' }[key];
    const output = $(`#${prefix}Out`);
    if (output) {
      output.value = `${value}%`;
      output.textContent = `${value}%`;
    }
    const input = $(`#${prefix}Range`);
    if (input) input.value = value;
  }

  function navigateFallback(page) {
    $$('.nav-item[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
    $$('[data-page-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === page));
    $('#sidebar')?.classList.remove('open');
  }

  function attachFallbackInteractions() {
    $$('.nav-item[data-page]').forEach((button) => button.addEventListener('click', () => navigateFallback(button.dataset.page)));
    $('#menuToggle')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));

    renderFallbackReferences();
    $('#addReference')?.addEventListener('click', () => {
      if (fallbackSlots.length >= 8) return toast('The reference set is limited to eight views.', 'info');
      const number = fallbackSlots.length + 1;
      const slot = { role: `angle${number}`, label: `Angle ${number}`, required: false };
      fallbackSlots.push(slot);
      const label = document.createElement('label');
      label.className = 'reference-slot';
      label.dataset.role = slot.role;
      $('#referenceGrid')?.appendChild(label);
      updateReferenceSlot(slot);
      toast('Additional reference slot added.', 'success');
    });

    $('#fitReferences')?.addEventListener('click', () => {
      const hasFront = fallbackReferences.some((item) => item.role === 'front');
      const hasSide = fallbackReferences.some((item) => item.role === 'side');
      if (!hasFront || !hasSide) return toast('Add both front and side reference images first.', 'error');
      toast('Both references are loaded. The 3D engine must connect before proportion fitting can run.', 'info', 6000);
    });

    const shapeKeys = { height: 'height', shoulder: 'shoulders', chest: 'chest', waist: 'waist', hip: 'hips', arm: 'arms', leg: 'legs' };
    Object.entries(shapeKeys).forEach(([prefix, key]) => {
      const input = $(`#${prefix}Range`);
      input?.addEventListener('input', () => updateShapeValue(key, input.value));
    });
    const presets = {
      balanced: { height: 100, shoulders: 100, chest: 100, waist: 100, hips: 100, arms: 100, legs: 100 },
      athletic: { height: 100, shoulders: 118, chest: 112, waist: 88, hips: 98, arms: 105, legs: 103 },
      stylized: { height: 104, shoulders: 92, chest: 92, waist: 88, hips: 108, arms: 95, legs: 112 },
    };
    $$('.preset').forEach((button) => button.addEventListener('click', () => {
      $$('.preset').forEach((item) => item.classList.toggle('active', item === button));
      fallbackShape = { ...presets[button.dataset.preset] };
      Object.entries(fallbackShape).forEach(([key, value]) => updateShapeValue(key, value));
      toast('Preset values updated. 3D fitting will be available when the engine loads.', 'info');
    }));
    $('#resetShape')?.addEventListener('click', () => {
      fallbackShape = { height: 100, shoulders: 100, chest: 100, waist: 100, hips: 100, arms: 100, legs: 100 };
      Object.entries(fallbackShape).forEach(([key, value]) => updateShapeValue(key, value));
      $$('.preset').forEach((button) => button.classList.toggle('active', button.dataset.preset === 'balanced'));
    });
    $('#applyShape')?.addEventListener('click', () => toast('Proportions are recorded. The 3D engine must connect before the mesh can be rebuilt.', 'info', 5500));

    $('#saveProject')?.addEventListener('click', async () => {
      try {
        await saveFallbackProject();
        toast('Project saved in this browser. Download a project file for a portable backup.', 'success');
      } catch (error) {
        toast(`${error.message} Use Project file to download a backup.`, 'error', 6500);
      }
    });
    $('#downloadProject')?.addEventListener('click', () => {
      const project = projectData();
      const filename = project.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'forma-character';
      downloadJSON(project, `${filename}.forma`);
    });
    $('#openProjectInput')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const project = JSON.parse(await file.text());
        if (!Array.isArray(project.references)) throw new Error('This file does not contain Forma project references.');
        fallbackReferences = project.references;
        fallbackSlots = Array.isArray(project.referenceSlots) ? project.referenceSlots : DEFAULT_SLOTS.map((slot) => ({ ...slot }));
        fallbackShape = { ...fallbackShape, ...(project.shape || {}) };
        if ($('#projectName')) $('#projectName').value = project.projectName || 'Untitled character';
        Object.entries(fallbackShape).forEach(([key, value]) => updateShapeValue(key, value));
        $('#referenceGrid').innerHTML = '';
        fallbackSlots.forEach((slot) => {
          const label = document.createElement('label');
          label.className = 'reference-slot';
          label.dataset.role = slot.role;
          $('#referenceGrid').appendChild(label);
        });
        renderFallbackReferences();
        toast('Project references and proportions restored.', 'success');
      } catch (error) {
        toast(`Could not open project: ${error.message}`, 'error');
      }
      event.target.value = '';
    });

    const unavailable = (name) => () => toast(`${name} needs the 3D engine. Reconnect or try another network, then reload.`, 'info', 5200);
    $('#exportTop')?.addEventListener('click', unavailable('GLB export'));
    $('#downloadGlb')?.addEventListener('click', unavailable('GLB export'));
    $('#meshImport')?.addEventListener('change', unavailable('Mesh preview and import'));
    $('#toggleSkeleton')?.addEventListener('click', unavailable('Skeleton preview'));
    $('#rigToggleBones')?.addEventListener('click', unavailable('Skeleton preview'));
    $('#resetCamera')?.addEventListener('click', unavailable('3D camera controls'));
    $('#rigResetPose')?.addEventListener('click', unavailable('Skeleton posing'));
    $('#resetJoint')?.addEventListener('click', unavailable('Joint posing'));
    $$('.camera-switch button').forEach((button) => button.addEventListener('click', () => {
      $$('.camera-switch button').forEach((item) => item.classList.toggle('active', item === button));
      toast(`The ${button.dataset.camera || 'selected'} camera view needs the 3D engine.`, 'info');
    }));
    $$('.source-choice[data-source]').forEach((choice) => choice.addEventListener('click', () => {
      $$('.source-choice').forEach((item) => item.classList.toggle('selected', item === choice));
      if (choice.dataset.source === 'fitted') toast('The fitted humanoid source is selected. Reconnect the 3D engine to build it.', 'info');
    }));
    $('#addKeyframe')?.addEventListener('click', unavailable('Animation keyframes'));
    $('#saveCustomMotion')?.addEventListener('click', unavailable('Custom animation editing'));
    $('#clearOverlay')?.addEventListener('click', () => {
      if ($('#overlaySelect')) $('#overlaySelect').value = '';
      if ($('#overlayMotionLabel')) $('#overlayMotionLabel').textContent = 'No overlay selected';
    });

    $$('.bone-row').forEach((button) => button.addEventListener('click', () => {
      $$('.bone-row').forEach((item) => item.classList.toggle('active', item === button));
      if ($('#selectedBoneTitle')) $('#selectedBoneTitle').textContent = button.dataset.bone || button.textContent.trim();
      if ($('#selectedBoneReadout')) $('#selectedBoneReadout').textContent = button.dataset.bone || button.textContent.trim();
      toast('Joint selected. 3D posing will be available when the engine loads.', 'info');
    }));
    $('#boneSearch')?.addEventListener('input', () => {
      const query = $('#boneSearch').value.toLowerCase();
      $$('.bone-row').forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(query); });
    });
    ['X', 'Y', 'Z'].forEach((axis) => $(`#rot${axis}`)?.addEventListener('input', () => {
      $(`#rot${axis}Out`).textContent = `${$(`#rot${axis}`).value}°`;
    }));

    let playing = false;
    $('#playMotion')?.addEventListener('click', () => {
      playing = !playing;
      $('#playMotion').textContent = playing ? 'Ⅱ' : '▶';
      toast('Animation preview requires the 3D engine.', 'info');
    });
    $('#stopMotion')?.addEventListener('click', () => {
      playing = false;
      if ($('#playMotion')) $('#playMotion').textContent = '▶';
      if ($('#timelineRange')) $('#timelineRange').value = 0;
    });
    $('#timelineRange')?.addEventListener('input', () => {
      if ($('#currentTime')) $('#currentTime').textContent = `00:${(Number($('#timelineRange').value) / 1000 * 2).toFixed(2).padStart(5, '0')}`;
    });
    $$('.motion-card').forEach((button) => button.addEventListener('click', () => {
      $$('.motion-card').forEach((item) => item.classList.toggle('active', item === button));
      if ($('#baseMotionLabel')) $('#baseMotionLabel').textContent = `${button.dataset.motion} · preview unavailable`;
      toast('Motion selected. Preview requires the 3D engine.', 'info');
    }));
    $$('#motionFilters button').forEach((button) => button.addEventListener('click', () => {
      $$('#motionFilters button').forEach((item) => item.classList.toggle('active', item === button));
      $$('.motion-card').forEach((card) => { card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter; });
    }));
  }

  async function start() {
    if (!('HTMLScriptElement' in window) || typeof HTMLScriptElement.supports !== 'function' || !HTMLScriptElement.supports('importmap')) {
      throw new Error('This browser does not support JavaScript import maps. Update the browser to use 3D tools.');
    }
    const base = await findThreeCdn();
    window.FORMA_THREE_CDN = base;
    injectImportMap(base);
    await loadMainModule();
  }

  function startFallback(error) {
    if (fallbackStarted) return;
    fallbackStarted = true;
    console.error('Forma Studio 3D startup failed:', error);
    attachFallbackInteractions();
    setEngineUnavailable(error?.message || 'Could not reach the free Three.js module hosts.');
  }

  start().catch(startFallback);
})();
