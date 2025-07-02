const tabsContainer = document.querySelector('.tabs-container');
const accountDropdown = document.getElementById('account-dropdown');

let draggedTabId = null;

document.getElementById('minimize-btn').addEventListener('click', () => window.electronAPI.minimizeApp());
document.getElementById('maximize-btn').addEventListener('click', () => window.electronAPI.maximizeApp());
document.getElementById('close-btn').addEventListener('click', () => window.electronAPI.closeApp());
document.querySelector('.add-tab-btn').addEventListener('click', () => window.electronAPI.newTab());

// Handle tab updates
window.electronAPI.onUpdateTabs(tabs => {
    tabsContainer.innerHTML = '';
    let activeTabFound = false;

    for (const tab of tabs) {
        const tabElement = document.createElement('div');
        tabElement.className = 'tab';
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true; // Make tab draggable

        if (tab.isActive) {
            tabElement.classList.add('active');
            activeTabFound = true;
        }

        const titleElement = document.createElement('span');
        titleElement.className = 'tab-title';
        titleElement.textContent = tab.title || 'New Tab';
        tabElement.appendChild(titleElement);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-tab-btn';
        closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M4.11 3.4l.707-.707L8 6.586l3.182-3.183l.707.707L8.707 7.293l3.182 3.182l-.707.707L8 8l-3.182 3.182l-.707-.707L7.293 7.293z"/></svg>'; // Corrected X icon
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.electronAPI.closeTab(tab.id);
        });
        tabElement.appendChild(closeBtn);

        tabElement.addEventListener('click', () => {
            window.electronAPI.switchTab(tab.id);
        });

        // Drag and Drop Events
        tabElement.addEventListener('dragstart', (e) => {
            draggedTabId = tab.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.id);
            tabElement.classList.add('dragging');
        });

        tabElement.addEventListener('dragover', (e) => {
            e.preventDefault(); // Allow drop
            const draggingElement = document.querySelector('.dragging');
            if (draggingElement && draggingElement !== tabElement) {
                const rect = tabElement.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                if (e.clientX < midX) {
                    tabsContainer.insertBefore(draggingElement, tabElement);
                } else {
                    tabsContainer.insertBefore(draggingElement, tabElement.nextSibling);
                }
            }
        });

        tabElement.addEventListener('dragend', () => {
            const draggingElement = document.querySelector('.dragging');
            if (draggingElement) {
                draggingElement.classList.remove('dragging');
            }
            // Send the new order to main process
            const newOrder = Array.from(tabsContainer.children).map(child => child.dataset.tabId);
            window.electronAPI.reorderTabs(newOrder);
        });

        tabsContainer.appendChild(tabElement);
    }

    // Fallback if no active tab is set (e.g., after closing the active one)
    if (!activeTabFound && tabs.length > 0) {
        window.electronAPI.switchTab(tabs[0].id);
    }
});

// Handle Exness Accounts
accountDropdown.addEventListener('change', (event) => {
    window.electronAPI.selectExnessAccount(event.target.value);
});

window.electronAPI.onExnessAccountsUpdated(accounts => {
    const activeAccount = accounts.find(acc => acc.is_active);
    const newAccountNumbers = new Set(accounts.map(acc => String(acc.account_number)));

    // 1. Synchronize the dropdown: Remove old, update existing, add new
    for (let i = accountDropdown.options.length - 1; i >= 0; i--) {
        const option = accountDropdown.options[i];
        if (!newAccountNumbers.has(option.value) || accounts.find(a => String(a.account_number) === option.value)?.is_archived) {
            accountDropdown.remove(i);
        }
    }

    accounts.forEach(account => {
        if (account.is_archived) return;

        const accountTypeLabel = account.is_real ? 'Thực' : 'Thử nghiệm';
        const newTextContent = `${account.account_type} - ${account.account_number} (${accountTypeLabel})` +
                               (account.balance !== undefined ? ` - ${account.balance} ${account.currency}` : '');

        let option = accountDropdown.querySelector(`option[value="${account.account_number}"]`);
        if (option) {
            option.textContent = newTextContent; // Update
        } else {
            option = document.createElement('option'); // Add
            option.value = account.account_number;
            option.textContent = newTextContent;
            accountDropdown.appendChild(option);
        }
    });

    // 2. Handle empty state
    if (accountDropdown.options.length === 0) {
        if (!document.querySelector('#no-accounts-option')) {
            const option = document.createElement('option');
            option.id = 'no-accounts-option';
            option.value = '';
            option.textContent = 'No accounts';
            accountDropdown.appendChild(option);
        }
        accountDropdown.disabled = true;
    } else {
        const noAccountsOption = document.querySelector('#no-accounts-option');
        if (noAccountsOption) noAccountsOption.remove();
        accountDropdown.disabled = false;
    }

    // 3. Set the active account based on the state from main process
    if (activeAccount) {
        accountDropdown.value = activeAccount.account_number;
    } else if (accountDropdown.options.length > 0 && accountDropdown.options[0].value) {
        // Fallback to the first account if no active one is designated
        accountDropdown.value = accountDropdown.options[0].value;
        window.electronAPI.selectExnessAccount(accountDropdown.value); // Inform main process
    }
});

window.electronAPI.onExnessLoginRequired(() => {
    console.log('Exness login required event received in renderer. Main process will open login window.');
});

// Request accounts on startup and periodically
window.addEventListener('DOMContentLoaded', () => {
    window.electronAPI.getExnessAccounts(); // Initial request
    setInterval(() => {
        window.electronAPI.getExnessAccounts(); // Refresh every 2 seconds
    }, 2000);
});