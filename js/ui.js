/* UI shell: theme, sidebar, help modal */
(function (App) {
  "use strict";

  const THEME_KEY = 'dsh_theme_v1';
  const SIDEBAR_KEY = 'dsh_sidebar_v1';
  const ONBOARD_KEY = 'dsh_onboarded_v1';

  let sidebarState = { gallery: false, props: false };

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    let theme = saved;
    if (!theme || (theme !== 'dark' && theme !== 'light')) {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeIcon(theme);
  }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function syncThemeIcon(theme) {
    const btn = App.Dom.themeToggleBtn;
    if (!btn) return;
    const sun = btn.querySelector('.icon-sun');
    const moon = btn.querySelector('.icon-moon');
    if (sun) sun.hidden = theme === 'dark';
    if (moon) moon.hidden = theme === 'light';
    btn.title = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
  }

  function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    syncThemeIcon(next);
  }

  function loadSidebarState() {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw) sidebarState = { ...sidebarState, ...JSON.parse(raw) };
    } catch (e) {}
    applySidebarState();
  }

  function saveSidebarState() {
    try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebarState)); } catch (e) {}
  }

  function applySidebarState() {
    const { galleryPanel, propsPanel } = App.Dom;
    if (galleryPanel) galleryPanel.classList.toggle('collapsed', sidebarState.gallery);
    if (propsPanel) propsPanel.classList.toggle('collapsed', sidebarState.props);
    document.body.classList.toggle('gallery-collapsed', sidebarState.gallery);
    document.body.classList.toggle('props-collapsed', sidebarState.props);
  }

  function initSidebarCollapse() {
    const { sidebarCollapseGallery, sidebarCollapseProps } = App.Dom;
    loadSidebarState();
    if (sidebarCollapseGallery) {
      sidebarCollapseGallery.addEventListener('click', () => {
        sidebarState.gallery = !sidebarState.gallery;
        applySidebarState();
        saveSidebarState();
        if (App.Editor && App.State.current()) {
          App.Editor.layoutStage();
          App.Editor.renderBoxes();
        }
      });
    }
    if (sidebarCollapseProps) {
      sidebarCollapseProps.addEventListener('click', () => {
        sidebarState.props = !sidebarState.props;
        applySidebarState();
        saveSidebarState();
      });
    }
  }

  function syncPropsState(mode) {
    const { textProps, drawProps, propsPanel, propsHint, propsHintText } = App.Dom;
    if (!textProps || !drawProps) return;

    const State = App.State;
    const drawMode = State.isDrawMode();
    const hasImage = !!State.current();
    const hasSelection = !!State.selectedTextId;

    if (propsPanel) propsPanel.hidden = !hasImage;

    if (drawMode) {
      textProps.hidden = true;
      drawProps.hidden = !hasImage;
      if (propsHint) propsHint.hidden = true;
      return;
    }

    drawProps.hidden = true;
    textProps.hidden = !hasImage;

    if (propsHint && propsHintText) {
      if (!hasImage) {
        propsHint.hidden = true;
      } else if (hasSelection) {
        propsHint.hidden = false;
        propsHintText.textContent = '已选中文字框 — 修改样式将应用到当前框';
      } else {
        propsHint.hidden = false;
        propsHintText.textContent = '默认样式 — 新添加的文字框将使用以下设置';
      }
    }

    if (mode === 'default' || (!hasSelection && hasImage)) {
      if (App.Toolbar && App.Toolbar.syncDefaultStylePanel) {
        App.Toolbar.syncDefaultStylePanel();
      }
    }
  }

  function openHelpModal() {
    const modal = App.Dom.helpModal;
    if (modal && typeof modal.showModal === 'function') modal.showModal();
  }

  function closeHelpModal() {
    const modal = App.Dom.helpModal;
    if (modal && typeof modal.close === 'function') modal.close();
  }

  function initHelpModal() {
    const { helpModal, helpBtn, helpModalClose, helpModalOk } = App.Dom;
    if (helpBtn) helpBtn.addEventListener('click', openHelpModal);
    if (helpModalClose) helpModalClose.addEventListener('click', closeHelpModal);
    if (helpModalOk) helpModalOk.addEventListener('click', closeHelpModal);
    if (helpModal) {
      helpModal.addEventListener('click', e => {
        if (e.target === helpModal) closeHelpModal();
      });
    }
    if (!localStorage.getItem(ONBOARD_KEY)) {
      setTimeout(() => {
        openHelpModal();
        localStorage.setItem(ONBOARD_KEY, '1');
      }, 400);
    }
  }

  function initOwlEasterEgg() {
    const { brandOwlBtn, owlThemeAudio } = App.Dom;
    if (!brandOwlBtn || !owlThemeAudio) return;

    owlThemeAudio.volume = 0.25;

    function stop() {
      owlThemeAudio.pause();
      owlThemeAudio.currentTime = 0;
      brandOwlBtn.classList.remove('playing');
    }

    brandOwlBtn.addEventListener('click', async () => {
      if (!owlThemeAudio.paused) {
        stop();
        return;
      }
      try {
        await owlThemeAudio.play();
        brandOwlBtn.classList.add('playing');
      } catch (e) {
        console.warn('owl theme play failed', e);
      }
    });

    owlThemeAudio.addEventListener('ended', stop);
  }

  function initDragHighlight() {
    let dragCounter = 0;
    window.addEventListener('dragenter', e => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      dragCounter++;
      document.body.classList.add('drag-active');
    });
    window.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) document.body.classList.remove('drag-active');
    });
    window.addEventListener('drop', () => {
      dragCounter = 0;
      document.body.classList.remove('drag-active');
    });
  }

  function init() {
    initTheme();
    initSidebarCollapse();
    initHelpModal();
    initOwlEasterEgg();
    initDragHighlight();

    const { themeToggleBtn, dropzone, fileInput } = App.Dom;
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
    }

    document.addEventListener('keydown', e => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          openHelpModal();
        }
      }
    });
  }

  App.UI = {
    init,
    initTheme,
    toggleTheme,
    getTheme,
    syncPropsState,
    openHelpModal,
    closeHelpModal
  };
})(window.App = window.App || {});
