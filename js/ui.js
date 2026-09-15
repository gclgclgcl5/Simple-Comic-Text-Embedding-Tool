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

  function formatBytes(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '—';
    const mb = n / (1024 * 1024);
    if (mb < 0.1) return Math.round(n / 1024) + ' KB';
    if (mb < 10) return mb.toFixed(1) + ' MB';
    return Math.round(mb) + ' MB';
  }

  function openStorageQuotaModal(opts) {
    const {
      storageQuotaModal, storageQuotaTitle, storageQuotaUsage
    } = App.Dom;
    if (!storageQuotaModal || typeof storageQuotaModal.showModal !== 'function') return;

    const force = !!(opts && opts.force);
    if (storageQuotaTitle) {
      storageQuotaTitle.textContent = force ? '本地存储空间不足' : '本地存储占用偏高';
    }
    if (storageQuotaUsage) {
      const usage = opts && opts.usage;
      const quota = opts && opts.quota;
      const ratio = opts && opts.ratio;
      if (typeof usage === 'number' && typeof quota === 'number' && quota > 0 && typeof ratio === 'number') {
        storageQuotaUsage.textContent = '当前约已用 ' + formatBytes(usage) + ' / 配额约 ' +
          formatBytes(quota) + '（' + Math.round(ratio * 100) + '%）。';
      } else if (force) {
        storageQuotaUsage.textContent = '浏览器拒绝继续写入本地数据（配额不足）。请先导出备份，再清除缓存。';
      } else {
        storageQuotaUsage.textContent = '本地存储占用已接近上限，建议先导出备份再清除缓存。';
      }
    }

    if (!storageQuotaModal.open) storageQuotaModal.showModal();
  }

  function closeStorageQuotaModal() {
    const modal = App.Dom.storageQuotaModal;
    if (modal && typeof modal.close === 'function' && modal.open) modal.close();
  }

  async function clearLocalCacheFromQuotaModal() {
    const { toast } = App.Utils;
    if (!confirm('将清除所有本地保存的图片、工程、编辑与上传字体。\n当前内存中的内容也会一并清空，是否继续？\n\n请确认已导出需要保留的备份。')) return;
    if (App.Storage && App.Storage.isAvailable()) await App.Storage.clearAll();
    if (App.Gallery) App.Gallery.clearAll(true, true);
    closeStorageQuotaModal();
    toast('已清除本地缓存');
  }

  async function exportFromQuotaModal(mode) {
    const { toast } = App.Utils;
    if (!App.Export || !App.Export.collectExportJobs) return;
    const jobs = App.Export.collectExportJobs();
    if (!jobs.length) {
      toast('请先在图库勾选要备份的图片或工程', 3200);
      return;
    }
    await App.Export.exportSelected({ mode });
  }

  function initStorageQuotaModal() {
    const {
      storageQuotaModal, storageQuotaClose, storageQuotaExportProject,
      storageQuotaExportPng, storageQuotaClear, storageQuotaLater
    } = App.Dom;
    if (!storageQuotaModal) return;

    if (storageQuotaClose) storageQuotaClose.addEventListener('click', closeStorageQuotaModal);
    if (storageQuotaLater) storageQuotaLater.addEventListener('click', closeStorageQuotaModal);
    if (storageQuotaExportProject) {
      storageQuotaExportProject.addEventListener('click', () => exportFromQuotaModal('project'));
    }
    if (storageQuotaExportPng) {
      storageQuotaExportPng.addEventListener('click', () => exportFromQuotaModal('png'));
    }
    if (storageQuotaClear) {
      storageQuotaClear.addEventListener('click', () => {
        clearLocalCacheFromQuotaModal().catch(e => console.error(e));
      });
    }
    storageQuotaModal.addEventListener('click', e => {
      if (e.target === storageQuotaModal) closeStorageQuotaModal();
    });
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
    initStorageQuotaModal();
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
    closeHelpModal,
    openStorageQuotaModal,
    closeStorageQuotaModal
  };
})(window.App = window.App || {});
