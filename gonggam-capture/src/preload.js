const { contextBridge, ipcRenderer } = require('electron');

// 화면(렌더러)에서 메인 프로세스로 가는 통로. 로컬 파일만 띄우므로 채널을 그대로 넘긴다.
contextBridge.exposeInMainWorld('gc', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args)),
});
