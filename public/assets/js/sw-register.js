/**
 * sw-register.js — register the service worker and prompt to refresh when a
 * new version is waiting (iOS won't auto-activate, so we nudge the user).
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdate(reg);
          }
        });
      });
    }).catch(() => {});

    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });

  function showUpdate(reg) {
    const bar = document.createElement('div');
    bar.className = 'install-hint show';
    bar.innerHTML = '<b>New version available.</b> Tap to refresh. ';
    bar.style.cursor = 'pointer';
    bar.addEventListener('click', () => {
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
    });
    document.body.insertBefore(bar, document.body.firstChild);
  }
})();
