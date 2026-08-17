import './index.css';
import {
  clearAutoScan,
  connectDevice,
  disconnectDevice,
  initUsbDisconnectListener,
  scanSockets,
} from './app/connection';
import { initLocale, toggleLocale } from './app/i18n';
import { initTheme, toggleTheme } from './app/theme';
import { renderShell } from './app/ui';
import { initViewer, toggleFullscreen } from './app/viewer';

document.addEventListener('DOMContentLoaded', () => {
  initLocale();
  initViewer();
  renderShell({
    onConnect: () => void connectDevice(),
    onDisconnect: () => void disconnectDevice(),
    onScan: () => {
      clearAutoScan();
      void scanSockets();
    },
    onFullscreen: toggleFullscreen,
    onToggleTheme: toggleTheme,
    onToggleLocale: toggleLocale,
  });
  initTheme();
  initUsbDisconnectListener();
});
