import { useStore } from './store';

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function handle(msg: any) {
  const s = useStore.getState();
  switch (msg.type) {
    case 'capture_added': {
      if (msg.capture) s.upsertCapture(msg.capture);
      if (msg.screen) {
        s.upsertScreen(msg.screen);
        s.showToast('Captured new screen');
      }
      break;
    }
    case 'capture_failed': {
      s.showToast(`Capture failed: ${msg.error ?? 'unknown'}`);
      break;
    }
    case 'screen_updated': {
      if (msg.screen) s.upsertScreen(msg.screen);
      break;
    }
    case 'screen_deleted': {
      if (msg.screen_id != null) s.removeScreen(msg.screen_id);
      break;
    }
    case 'annotation_updated': {
      if (msg.annotation) s.upsertAnnotation(msg.annotation);
      break;
    }
    case 'annotation_deleted': {
      if (msg.annotation_id != null) s.removeAnnotation(msg.annotation_id);
      break;
    }
    case 'composite_created': {
      if (msg.composite) s.upsertComposite(msg.composite);
      if (msg.screen) s.upsertScreen(msg.screen);
      break;
    }
    case 'layer_updated': {
      if (msg.layer) s.upsertLayer(msg.layer);
      break;
    }
    case 'layer_deleted': {
      if (msg.layer_id != null) s.removeLayer(msg.layer_id);
      break;
    }
    case 'settings_updated': {
      if (msg.settings) s.setSettings(msg.settings);
      break;
    }
    case 'annotation_types_updated': {
      if (msg.annotation_types) s.setAnnotationTypes(msg.annotation_types);
      break;
    }
    case 'backup_imported': {
      void s.bootstrap().catch((e: Error) => s.showToast(`Reload failed: ${e.message ?? e}`));
      break;
    }
  }
}

export function connectWS() {
  try {
    socket?.close();
  } catch {}
  socket = new WebSocket(url());
  socket.onopen = () => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  socket.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      console.warn('bad WS message', err, e.data);
    }
  };
  socket.onclose = () => {
    if (reconnectTimer == null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectWS();
      }, 1500);
    }
  };
  socket.onerror = () => {
    socket?.close();
  };
}
