const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Main window controls
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    maximizeApp: () => ipcRenderer.send('maximize-app'),
    closeApp: () => ipcRenderer.send('close-app'),

    // Tab management
    newTab: (isLoginTab = false) => ipcRenderer.send('new-tab', isLoginTab),
    switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),
    closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
    reorderTabs: (newOrder) => ipcRenderer.send('reorder-tabs', newOrder),

    // Exness Account Management
    getExnessAccounts: () => ipcRenderer.invoke('get-exness-accounts'),
    onExnessAccountsUpdated: (callback) => ipcRenderer.on('exness-accounts-updated', (_event, accounts) => callback(accounts)),
    onExnessLoginRequired: (callback) => ipcRenderer.on('exness-login-required', callback),
    selectExnessAccount: (accountNumber) => ipcRenderer.send('select-exness-account', accountNumber),

    // Listen for events from main process
    onUpdateTabs: (callback) => ipcRenderer.on('update-tabs', (_event, tabs) => callback(tabs)),
});