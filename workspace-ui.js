(() => {
  'use strict';

  const PAGE_HEADINGS = {
    build: ['STEP 01 / CHARACTER FOUNDATION', 'Build your character.'],
    rig: ['STEP 02 / SKELETON & DEFORMATION', 'Give it a structure.'],
    animate: ['STEP 03 / MOTION DESIGN', 'Make it move.'],
    export: ['STEP 04 / GAME-READY EXPORT', 'Export your character.'],
    help: ['WORKFLOW GUIDE', 'Create with confidence.'],
  };

  function installHeader() {
    const projectHeading = document.querySelector('.project-heading');
    const actions = document.querySelector('.top-actions');
    const localPill = document.querySelector('.local-pill');
    if (!projectHeading || !actions || !localPill || document.querySelector('#activeStepHeading')) return;

    const projectName = document.querySelector('#projectName');
    const heading = document.createElement('div');
    heading.className = 'active-step-heading';
    heading.id = 'activeStepHeading';
    heading.innerHTML = '<span class="eyebrow" id="activeStepEyebrow"></span><strong id="activeStepTitle"></strong>';
    projectHeading.replaceWith(heading);

    const projectMeta = document.createElement('div');
    projectMeta.className = 'header-project-meta';
    projectMeta.innerHTML = '<span class="eyebrow">CHARACTER LAB</span>';
    if (projectName) {
      projectName.classList.add('header-project-name');
      projectName.setAttribute('aria-label', 'Character project name');
      projectMeta.appendChild(projectName);
    }
    localPill.insertAdjacentElement('afterend', projectMeta);

    updateHeader(getActivePage());
  }

  function getActivePage() {
    return document.querySelector('.nav-item[data-page].active')?.dataset.page
      || document.querySelector('.page-panel.active')?.dataset.pagePanel
      || 'build';
  }

  function updateHeader(page) {
    const heading = PAGE_HEADINGS[page] || PAGE_HEADINGS.build;
    const eyebrow = document.querySelector('#activeStepEyebrow');
    const title = document.querySelector('#activeStepTitle');
    if (eyebrow) eyebrow.textContent = heading[0];
    if (title) title.textContent = heading[1];
  }

  function watchNavigation() {
    document.addEventListener('click', event => {
      const button = event.target.closest('.nav-item[data-page]');
      if (!button) return;
      updateHeader(button.dataset.page);
    });

    const observer = new MutationObserver(() => updateHeader(getActivePage()));
    document.querySelectorAll('.nav-item[data-page]').forEach(button => {
      observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function install() {
    installHeader();
    watchNavigation();
    document.documentElement.classList.add('forma-compact-workspace');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
