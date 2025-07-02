const { app, BrowserWindow, ipcMain, session, BrowserView } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const stateFilePath = path.join(app.getPath('userData'), 'app-state.json');

const tabs = new Map();
const views = new Map();
let orders = new Map()
let ordersInfo = new Map()


let mainWindow;
let startupWindow;
let exnessLoginWindow = null; // Variable for the login window
let activeTabId = null;
let exnessAccounts = [];

let selectedExnessAccount = null;
const EXNESS_LOGIN_URL = 'https://my.ex-markets.pro/accounts/sign-in?redirect=%2Fwebtrading%2F';
const EXNESS_WEBTRADING_URL_PREFIX = 'https://my.ex-markets.pro/webtrading/';
const EXNESS_API_URL = 'https://my.ex-markets.pro/v4/wta-api/async/personal_area/account?legal_entity=vc&platform_type=';
let EXNESS_API_ORDER = null

function createExnessAPITrade(selectedExnessAccount, close = false, position = false){
    EXNESS_API_ORDER = 'https://rtapi-jb.eccweb.mobi/rtapi/mt5/' + (selectedExnessAccount.server.server_code).replace(/mt5_vc_/gi, "") + '/v1/accounts/' + selectedExnessAccount.account_number + '/orders/'
    if(close) return 'https://rtapi-jb.eccweb.mobi/rtapi/mt5/' + (selectedExnessAccount.server.server_code).replace(/mt5_vc_/gi, "") + '/v2/accounts/' + selectedExnessAccount.account_number + '/positions/'
    if(position) return 'https://rtapi-jb.eccweb.mobi/rtapi/mt5/' + (selectedExnessAccount.server.server_code).replace(/mt5_vc_/gi, "") + '/v1/accounts/' + selectedExnessAccount.account_number + '/positions/'
}

function saveState() {
    const state = {
        tabs: Array.from(tabs.values()).map(tab => ({ id: tab.id, url: tab.url, title: tab.title, sessionId: tab.sessionId })),
        activeTabId,
        orders: orders ? [...orders] : [],
        ordersInfo: ordersInfo ? [...ordersInfo] : [],
        selectedExnessAccount: selectedExnessAccount ? selectedExnessAccount : null,
    };
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
    console.log('App state saved.', state);
}

function loadState() {
    if (fs.existsSync(stateFilePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
            return state;
        } catch (e) {
            console.error("Failed to parse state file, starting fresh.", e);
            return null;
        }
    }
    console.log('No state file found.');
    return null;
}

function sendTabsUpdate() {
    const tabsData = Array.from(tabs.values()).map(t => ({ ...t, isActive: t.id === activeTabId }));
    if (mainWindow) {
        mainWindow.webContents.send('update-tabs', tabsData);
        console.log('Tabs update sent to renderer:', tabsData);
    }
}

function sendExnessAccountsUpdate() {
    if (mainWindow) {
        const accountsToSend = exnessAccounts.map(acc => ({
            ...acc,
            is_active: selectedExnessAccount && acc.account_number === selectedExnessAccount.account_number
        }));
        createExnessAPITrade(selectedExnessAccount)
        // console.log('Data being sent to renderer (exness-accounts-updated):', accountsToSend);
        mainWindow.webContents.send('exness-accounts-updated', accountsToSend);
    }
}

async function sendOrder(instrument, type, price, volume, sl = 0, tp = 0, currentSession) {
    const data = {
        order: {
          instrument,
          type,
          volume,
          sl,
          tp,
          deviation: 0,
          oneClick: false,
          ...(price !== undefined && price !== null ? { price } : {})
        }
    };
    console.log(data)
    try {
      const cookies = await currentSession.cookies.get({ url: EXNESS_API_URL });
      const token = cookies.find(c => c.name === 'JWT')?.value;
      if (!token) {
        throw new Error('JWT token không tồn tại trong cookie.');
      }
  
      const response = await axios.post(EXNESS_API_ORDER, JSON.stringify(data), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        validateStatus: () => true,
      });
      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.status, message: response.data };
      }
  
    } catch (err) {
      return { success: false, error: 'network', message: err.message };
    }
  }  

  async function closeOrder(id, currentSession){
    try {
        const cookies = await currentSession.cookies.get({ url: EXNESS_API_URL });
        const token = cookies.find(c => c.name === 'JWT')?.value;
        const info = ordersInfo.get(id)
        // console.log(id)
        if (!token) {
          throw new Error('JWT token không tồn tại trong cookie.');
        }
        const response = await axios.put(createExnessAPITrade(selectedExnessAccount, true) + id + '/close', JSON.stringify({
            position: {
                close_by_id: 0, 
                volume: info.volume,
                price: info.order.price
            }
        }), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          validateStatus: () => true,
        });
        if (response.status >= 200 && response.status < 300) {
          return { success: true, data: response.data };
        } else {
          return { success: false, error: response.status, message: response.data };
        }
    
      } catch (err) {
        return { success: false, error: 'network', message: err.message };
      }
  }

  async function cancelOrder(id, currentSession){
    try {
        const cookies = await currentSession.cookies.get({ url: EXNESS_API_URL });
        const token = cookies.find(c => c.name === 'JWT')?.value;
        if (!token) {
          throw new Error('JWT token không tồn tại trong cookie.');
        }
        console.log(id)
        const response = await axios.put(EXNESS_API_ORDER + id + '/cancel', {}, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          validateStatus: () => true,
        });
        if (response.status >= 200 && response.status < 300) {
          return { success: true, data: response.data };
        } else {
          return { success: false, error: response.status, message: response.data };
        }
    
      } catch (err) {
        return { success: false, error: 'network', message: err.message };
      }
  }

  async function modifyOrder(id, price, tp = 0, sl = 0, currentSession){
    try {
        const data = {
            order: {
                exp_date: 0, 
                price, 
                tp, 
                sl
            }
        }
        const cookies = await currentSession.cookies.get({ url: EXNESS_API_URL });
        const token = cookies.find(c => c.name === 'JWT')?.value;
        if (!token) {
          throw new Error('JWT token không tồn tại trong cookie.');
        }
        const response = await axios.put(EXNESS_API_ORDER + id + '/modify', JSON.stringify(data), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          validateStatus: () => true,
        });
        if (response.status >= 200 && response.status < 300) {
          return { success: true, data: response.data };
        } else {
          return { success: false, error: response.status, message: response.data };
        }
    
      } catch (err) {
        return { success: false, error: 'network', message: err.message };
      }
  }

  async function modifyPosition(id, tp = 0, sl = 0, currentSession){
    try {
        const data = {
            position: {
                tp, 
                sl
            }
        }
        const cookies = await currentSession.cookies.get({ url: EXNESS_API_URL });
        const token = cookies.find(c => c.name === 'JWT')?.value;
        if (!token) {
          throw new Error('JWT token không tồn tại trong cookie.');
        }
        const response = await axios.put(createExnessAPITrade(selectedExnessAccount, false, true)+ id + '/modify', JSON.stringify(data), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          validateStatus: () => true,
        });
        if (response.status >= 200 && response.status < 300) {
          return { success: true, data: response.data };
        } else {
          return { success: false, error: response.status, message: response.data };
        }
    
      } catch (err) {
        return { success: false, error: 'network', message: err.message };
      }
  }
 
async function fetchExnessAccounts(currentSession) {
    console.log('Attempting to fetch Exness accounts...');
    try {
        const cookies = await currentSession.cookies.get({ url: EXNESS_API_URL });
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        const response = await axios.get(EXNESS_API_URL, {
            headers: {
                'Cookie': cookieString,
                'User-Agent': currentSession.getUserAgent(),
            },
        });
        exnessAccounts = response.data;
        if(selectedExnessAccount === null){
            selectedExnessAccount = exnessAccounts[0]
            createExnessAPITrade(selectedExnessAccount)
        }
        
        sendExnessAccountsUpdate();
        // console.log('Fetched Exness accounts:', exnessAccounts);
    } catch (error) {
        console.error('Failed to fetch Exness accounts:', error.message);
        if (error.response && error.response.status === 401) {
            console.log('Exness login required. Opening separate login window.');
            if (!exnessLoginWindow) {
                createExnessLoginWindow(currentSession); // Pass the session to the login window
            }
            // No need to send exness-login-required to renderer, main process handles window creation
        }
        exnessAccounts = [];
        sendExnessAccountsUpdate();
    }
}

function createExnessLoginWindow(parentSession) {
    exnessLoginWindow = new BrowserWindow({
        width: 400,
        height: 600,
        title: 'Exness Login',
        parent: mainWindow,
        modal: true,
        show: false,
        webPreferences: {
            session: parentSession, // Use the same session as the main tab
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js') // Use preload for IPC
        }
    });

    exnessLoginWindow.loadURL(EXNESS_LOGIN_URL);

    exnessLoginWindow.once('ready-to-show', () => {
        exnessLoginWindow.show();
    });

    exnessLoginWindow.on('closed', () => {
        exnessLoginWindow = null;
        // After login window closes, try fetching accounts again
        if (activeTabId) {
            fetchExnessAccounts(session.fromPartition(tabs.get(activeTabId).sessionId));
        }
    });

    // Monitor for successful login within the new window
    exnessLoginWindow.webContents.on('did-navigate', (event, url) => {
        console.log(`Login window navigated to: ${url}`);
        if (url.startsWith(EXNESS_WEBTRADING_URL_PREFIX)) {
            console.log('Exness login successful in separate window. Closing login window.');
            exnessLoginWindow.close(); // Close the login window
        }
    });
}

function instrument(symbol){
    if(symbol.includes("GOLD")||symbol.includes('XAU')) return "XAUUSDm"
    if(symbol.includes("EURUSD")) return "EURUSDm"
    if(symbol.includes("GBPUSD")) return "GBPUSDm"
    if(symbol.includes("USDJPY")) return "USDJPYm"
    if(symbol.includes("DXY")) return "DXYm"
    if(symbol.includes("BTCUSD")) return "BTCUSDm"
}

function type(type,side){
    if(type == "limit")
        if(side == "buy")return 2
        else return 3
    if(type == "market")
        if(side == "buy")return 0
        else return 1
}
function extractOrderId(url) {
    const match = url.match(/\/(orders|positions)\/(\d+)/);
    return match ? match[2] : null;
}
function extractAccountId(url) {
    const match = url.match(/\/accounts\/(\d+)/);
    return match ? match[1] : null;
  }
function createTab(id, url, isActive = false, existingSessionId = null) {
    console.log(`createTab called: id=${id}, url=${url}, isActive=${isActive}`);
    const tabId = id || uuidv4();
    const partitionName = existingSessionId || `persist:tab_${tabId}`;
    const tabSession = session.fromPartition(partitionName);
    const requestMap = new Map();
    let authToken = null
    if (!tabSession.hasSetInterceptor) {
        tabSession.webRequest.onBeforeRequest((details, callback) => {
            if (
                details.method === 'POST' &&
                details.url.includes('https://tradingview-api-client-demo.fpmarkets.com/accounts/') &&
                details.url.includes('&requestId=')
            ) {
                if (details.uploadData && details.uploadData.length > 0) {
                    const buffer = details.uploadData[0].bytes;
                    if (buffer) {
                        try {
                            // const body = JSON.parse(buffer.toString());
                            const params = new URLSearchParams(buffer.toString());
                            const body = Object.fromEntries(params.entries());
                            // console.log(body)
                            sendOrder(
                                instrument(body.instrument),
                                type(body.type, body.side),
                                (body.limitPrice) ?  Number(body.limitPrice) :  body.currentBid ? Number(body.currentBid) : undefined,
                                Number(body.qty),
                                (body.stopLoss) ? Number(body.stopLoss): 0,
                                (body.takeProfit) ? Number(body.takeProfit): 0,
                                tabSession
                              ).then((result) => {
                                if (result.success) {
                                    console.log('Lệnh được chấp nhận:', result.data);
                                    const uid = crypto.randomUUID(); // hoặc uuidv4()
                                    const timestamp = Date.now();
                                    const fingerprint = `${uid}_${timestamp}`;
                                    ordersInfo.set((result.data.order.ticket_id).toString(), {...result.data, volume: Number(body.qty)})
                                    // Gán fingerprint cho requestId
                                    requestMap.set(details.requestId, {
                                        fingerprint,
                                        id: result.data.order.order_id,
                                        url: details.url,
                                        method: details.method,
                                        uploadData: details.uploadData
                                    });
                                    callback({ cancel: false });
                                } else {
                                    console.warn('Lệnh bị từ chối:', result.message || result.error);
                                    callback({ cancel: true });
                                }
                              }).catch((err) => {
                                console.error('Lỗi xử lý sendOrder:', err);
                                callback({ cancel: true });
                              });                              
    
                            return;
                        } catch (err) {
                            console.error('Lỗi phân tích body:', err);
                            return callback({ cancel: true });
                        }
                    }
                }
                return callback({ cancel: true });
            }
            

            if (
                details.method === 'DELETE' &&
                details.url.includes('https://tradingview-api-client-demo.fpmarkets.com/accounts/') &&
                details.url.includes('/orders/')
            ) {
                try {
                    // const body = JSON.parse(buffer.toString());
                    cancelOrder(orders.get(extractOrderId(details.url)), tabSession).then((result) => {
                        if (result.success) {
                            console.log('Lệnh được chấp nhận:', result.data);
                            ordersInfo.delete(orders.get(extractOrderId(details.url)))
                            orders.delete(extractOrderId(details.url))
                            callback({ cancel: false });
                        } else {
                            console.warn('Lệnh bị từ chối:', result.message || result.error);
                            callback({ cancel: true });
                        }
                      }).catch((err) => {
                        console.error('Lỗi xử lý cancelOrder:', err);
                        callback({ cancel: true });
                      });                              

                    return;
                } catch (err) {
                    console.error('Lỗi phân tích url:', err);
                    return callback({ cancel: true });
                }
            }

            if (
                details.method === 'DELETE' &&
                details.url.includes('https://tradingview-api-client-demo.fpmarkets.com/accounts/') &&
                details.url.includes('/positions/')
            ) {
                try {
                    axios.get(`https://tradingview-api-client-demo.fpmarkets.com/accounts/${extractAccountId(details.url)}/orders?locale=en`,{
                        headers: {
                            'Authorization': authToken
                        }
                    })
                    .then(result => {
                        const orderID = (result.data.d.find(order =>
                            order.customFields?.some(field =>
                              field.id === "PositionId" && field.value.startsWith(extractOrderId(details.url))
                            )
                          )).id;
                        //   console.log(orderID)
                        closeOrder(orders.get(orderID),tabSession).then((result) => {
                            if (result.success) {
                                console.log('Lệnh được chấp nhận:', result.data);
                                ordersInfo.delete(orders.get(orderID))
                                orders.delete(orderID)
                                callback({ cancel: false });
                            } else {
                                console.warn('Lệnh bị từ chối:', result.message || result.error);
                                callback({ cancel: true });
                            }
                          }).catch((err) => {
                            console.error('Lỗi xử lý cancelOrder:', err);
                            callback({ cancel: true });
                          });    


                    }).catch((err) => {
                        console.error('Lỗi lấy orders:', err);
                        callback({ cancel: true });
                    });                           

                    return;
                } catch (err) {
                    console.error('Lỗi phân tích body:', err);
                    return callback({ cancel: true });
                }
            }

            if (
                details.method === 'PUT' &&
                details.url.includes('https://tradingview-api-client-demo.fpmarkets.com/accounts/') &&
                details.url.includes('/orders/')
            ) {
                if (details.uploadData && details.uploadData.length > 0) {
                    const buffer = details.uploadData[0].bytes;
                    if (buffer) {
                        try {
                            const params = new URLSearchParams(buffer.toString());
                            const body = Object.fromEntries(params.entries());
                            // console.log(orders.get(extractOrderId(details.url)))
                            modifyOrder(
                                orders.get(extractOrderId(details.url)),
                                (body.limitPrice) ?  Number(body.limitPrice) :  undefined,
                                (body.takeProfit) ? Number(body.takeProfit): 0, 
                                (body.stopLoss) ? Number(body.stopLoss): 0,
                                tabSession).then((result) => {
                                if (result.success) {
                                    console.log('Lệnh được chấp nhận:', result.data);
                                    callback({ cancel: false });
                                } else {
                                    console.warn('Lệnh bị từ chối:', result.message || result.error);
                                    callback({ cancel: true });
                                }
                              }).catch((err) => {
                                console.error('Lỗi xử lý modifyOrder:', err);
                                callback({ cancel: true });
                              });                              
    
                            return;
                        } catch (err) {
                            console.error('Lỗi phân tích body:', err);
                            return callback({ cancel: true });
                        }
                    }
                }
            }


            if (
                details.method === 'PUT' &&
                details.url.includes('https://tradingview-api-client-demo.fpmarkets.com/accounts/') &&
                details.url.includes('/positions/')
            ) {
                if (details.uploadData && details.uploadData.length > 0) {
                    const buffer = details.uploadData[0].bytes;
                    if (buffer) {
                        try {
                            axios.get(`https://tradingview-api-client-demo.fpmarkets.com/accounts/${extractAccountId(details.url)}/orders?locale=en`,{
                                headers: {
                                    'Authorization': authToken
                                }
                            })
                            .then(result => {
                                const orderID = (result.data.d.find(order =>
                                    order.customFields?.some(field =>
                                      field.id === "PositionId" && field.value.startsWith(extractOrderId(details.url))
                                    )
                                  )).id;
                                  const params = new URLSearchParams(buffer.toString());
                                  const body = Object.fromEntries(params.entries());
                                  // console.log(orders.get(extractOrderId(details.url)))
                                  modifyPosition(
                                      orders.get(orderID),
                                      (body.takeProfit) ? Number(body.takeProfit): 0, 
                                      (body.stopLoss) ? Number(body.stopLoss): 0,
                                      tabSession).then((result) => {
                                      if (result.success) {
                                          console.log('Lệnh được chấp nhận:', result.data);
                                          callback({ cancel: false });
                                      } else {
                                          console.warn('Lệnh bị từ chối:', result.message || result.error);
                                          callback({ cancel: true });
                                      }
                                    }).catch((err) => {
                                      console.error('Lỗi xử lý modifyPosition:', err);
                                      callback({ cancel: true });
                                    });        
                            }).catch((err) => {
                                console.error('Lỗi lấy orders:', err);
                                callback({ cancel: true });
                            });                                 
    
                            return;
                        } catch (err) {
                            console.error('Lỗi phân tích body:', err);
                            return callback({ cancel: true });
                        }
                    }
                }
            }


            

            callback({});
        });

        tabSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = details.requestHeaders;
            headers.Authorization && authToken === null ? authToken = headers.Authorization : null

            const tracked = requestMap.get(details.requestId);
            if (tracked) {
              details.requestHeaders['X-Fingerprint'] = tracked.fingerprint;
            }
            callback({ requestHeaders: details.requestHeaders });
          });
    

        tabSession.hasSetInterceptor = true;
    }


    const tab = {
        id: tabId,
        url: url || 'https://www.tradingview.com/chart',
        title: 'TradingView',
        sessionId: partitionName,
    };
    tabs.set(tabId, tab);

    const view = new BrowserView({ webPreferences: { session: tabSession, nodeIntegration: false } });
    views.set(tabId, view);

    view.webContents.debugger.attach('1.3');
    view.webContents.debugger.sendCommand('Network.enable');


    const pendingResponseMap = new Map();

    view.webContents.debugger.on('message', async (event, method, params) => {
        if (method === 'Network.responseReceived') {
            const { requestId, response } = params;
    
            const match = Array.from(requestMap.entries()).find(
                ([rid, entry]) => response.url === entry.url
            );
    
            if (match) {
                const [matchedRequestId, tracked] = match;
    
                pendingResponseMap.set(requestId, { matchedRequestId, tracked });
            }
        }
    
        if (method === 'Network.loadingFinished') {
            const { requestId } = params;
    
            if (pendingResponseMap.has(requestId)) {
                const { matchedRequestId, tracked } = pendingResponseMap.get(requestId);
    
                try {
                    const { body, base64Encoded } = await view.webContents.debugger.sendCommand(
                        'Network.getResponseBody',
                        { requestId }
                    );
    
                    const decoded = base64Encoded
                        ? JSON.parse(Buffer.from(body, 'base64').toString())
                        : JSON.parse(body);
    
                    console.log(decoded);
    
                    orders.set((decoded.d.orderId).toString(), (tracked.id).toString());
    
                    requestMap.delete(matchedRequestId);
                } catch (err) {
                    console.error('Lỗi getResponseBody:', err);
                } finally {
                    pendingResponseMap.delete(requestId);
                }
            }
        }
    });
    



    const handleTitleUpdate = (_, title) => {
        const t = tabs.get(tabId);
        if (t) {
            t.title = title;
            sendTabsUpdate();
        }
    };
    view.webContents.on('page-title-updated', handleTitleUpdate);
    view.webContents.once('destroyed', () => {
        view.webContents.removeListener('page-title-updated', handleTitleUpdate);
    });

    view.webContents.loadURL(tab.url);

    if (isActive) {
        switchToTab(tabId);
    }

    sendTabsUpdate();
    console.log('Tab created:', tab);
    return tabId;
}

function switchToTab(tabId) {
    console.log('Attempting to switch to tab:', tabId);
    if (!tabs.has(tabId) || !mainWindow) {
        console.log('Tab not found or mainWindow not ready.');
        return;
    }

    activeTabId = tabId;
    mainWindow.setBrowserView(views.get(tabId));
    updateViewBounds();
    sendTabsUpdate();
    console.log('Switched to tab:', tabId);
}

function closeTab(tabId) {
    console.log('Attempting to close tab:', tabId);
    if (!tabs.has(tabId)) {
        console.log('Tab not found:', tabId);
        return;
    }

    const tab = tabs.get(tabId);
    if (tab) {
        const tabSession = session.fromPartition(tab.sessionId);
        if (tabSession) {
            // Clear storage data BEFORE destroying webContents
            tabSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexeddb', 'websql', 'serviceworkers', 'cachestorage'] })
                .then(() => console.log('Session data cleared for tab:', tabId))
                .catch(err => console.error(`Failed to clear session data for tab ${tabId}:`, err));
        }
    }

    const view = views.get(tabId);
    if (view) {
        if (mainWindow && mainWindow.getBrowserView() === view) {
            mainWindow.removeBrowserView(view); // Explicitly remove the BrowserView if it's currently attached
        }
        view.webContents.destroy();
        views.delete(tabId);
        console.log('BrowserView destroyed for tab:', tabId);
    }
    
    tabs.delete(tabId);
    console.log('Tab data removed from map:', tabId);

    if (activeTabId === tabId) {
        if (tabs.size > 0) {
            const newActiveTabId = tabs.keys().next().value;
            console.log('Active tab closed, switching to new active tab:', newActiveTabId);
            switchToTab(newActiveTabId);
        } else {
            activeTabId = null;
            if (mainWindow) mainWindow.setBrowserView(null);
            console.log('Last tab closed, no active tab.');
        }
    }

    sendTabsUpdate();
    console.log('Tab closed successfully:', tabId);
}

function reorderTabs(newOrder) {
    console.log('Reordering tabs:', newOrder);
    const reorderedTabs = new Map();
    for (const tabId of newOrder) {
        if (tabs.has(tabId)) {
            reorderedTabs.set(tabId, tabs.get(tabId));
        }
    }
    tabs.clear();
    for (const [tabId, tab] of reorderedTabs) {
        tabs.set(tabId, tab);
    }
    sendTabsUpdate();
    console.log('Tabs reordered.', Array.from(tabs.keys()));
}

function updateViewBounds() {
    if (!mainWindow || !activeTabId) return;
    const [width, height] = mainWindow.getSize();
    const view = views.get(activeTabId);
    if (view) {
        view.setBounds({ x: 0, y: 41, width: width, height: height - 41 });
    }
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        frame: false,
        show: false,
        webPreferences: {
            devTools: false,
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
        }
    });
    mainWindow.maximize();
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('resize', updateViewBounds);
    mainWindow.on('maximize', updateViewBounds);
    mainWindow.on('unmaximize', updateViewBounds);

    mainWindow.once('ready-to-show', () => {
        const state = loadState();
        if (state && state.tabs.length > 0) {
            if(state.selectedExnessAccount !== null) {
                selectedExnessAccount = state.selectedExnessAccount
                createExnessAPITrade(state.selectedExnessAccount)
            }
            if(state.orders.length !== 0)orders = new Map(state.orders)
            if(state.ordersInfo.length !== 0)ordersInfo = new Map(state.ordersInfo)
            state.tabs.forEach(tab => createTab(tab.id, tab.url, tab.id === state.activeTabId, tab.sessionId));
        } else {
            createTab(null, null, true);
        }
        mainWindow.show();
        // Open DevTools in detached mode
        // mainWindow.webContents.openDevTools({ mode: 'detach' });
        // Initial fetch of Exness accounts using the session of the currently active tab
        if (activeTabId) {
            fetchExnessAccounts(session.fromPartition(tabs.get(activeTabId).sessionId));
        }
    });

    mainWindow.on('close', () => {
        saveState();
        mainWindow = null;
    });
}

app.on('ready', () => {
    createMainWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('minimize-app', () => mainWindow?.minimize());
ipcMain.on('maximize-app', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});
ipcMain.on('close-app', () => mainWindow?.close());

ipcMain.on('new-tab', () => createTab(null, null, true));
ipcMain.on('switch-tab', (_, tabId) => switchToTab(tabId));
ipcMain.on('close-tab', (_, tabId) => closeTab(tabId));
ipcMain.on('reorder-tabs', (_, newOrder) => reorderTabs(newOrder));

ipcMain.handle('get-exness-accounts', async (event) => {
    // Use the session of the currently active tab to fetch accounts
    if (activeTabId) {
        const currentTabSession = session.fromPartition(tabs.get(activeTabId).sessionId);
        await fetchExnessAccounts(currentTabSession);
    }
    return exnessAccounts;
});

ipcMain.on('select-exness-account', (event, accountNumber) => {
    selectedExnessAccount = exnessAccounts.find(acc => acc.account_number == accountNumber);
    console.log('Selected Exness account:', selectedExnessAccount);
    sendExnessAccountsUpdate();
});
