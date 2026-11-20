const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_, data) => cb(data));

contextBridge.exposeInMainWorld('pet', {
  ready: () => ipcRenderer.send('pet:ready'),
  onConfig: (cb) => on('pet:config', cb),
  onState: (cb) => on('pet:state', cb),
  onBubble: (cb) => on('pet:bubble', cb),
  hover: (v) => ipcRenderer.send('pet:hover', v),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  contextMenu: () => ipcRenderer.send('pet:context-menu'),
  bubbleAction: (id) => ipcRenderer.send('pet:bubble-action', id),
});

contextBridge.exposeInMainWorld('checkin', {
  get: () => ipcRenderer.invoke('checkin:get'),
  do: (itemId) => ipcRenderer.invoke('checkin:do', itemId),
  undo: (eventId) => ipcRenderer.invoke('checkin:undo', eventId),
  updateItem: (itemId, changes) => ipcRenderer.invoke('checkin:updateItem', itemId, changes),
  onChanged: (cb) => on('checkin:changed', cb),
});

contextBridge.exposeInMainWorld('notes', {
  list: () => ipcRenderer.invoke('notes:list'),
  add: () => ipcRenderer.invoke('notes:add'),
  update: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
  remove: (id) => ipcRenderer.invoke('notes:delete', id),
  pin: (id) => ipcRenderer.invoke('notes:pin', id),
  unpin: (id) => ipcRenderer.invoke('notes:unpin', id),
  isPinned: (id) => ipcRenderer.invoke('notes:isPinned', id),
  onChanged: (cb) => on('notes:changed', cb),
  onNewNote: (cb) => on('panel:new-note', cb),
  onTheme: (cb) => on('panel:theme', cb),
  onTab: (cb) => on('panel:tab', cb),
  getTheme: () => ipcRenderer.invoke('panel:get-theme'),
  close: () => ipcRenderer.send('panel:close'),
});
