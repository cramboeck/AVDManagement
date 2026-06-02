// Cloud Management Portal - Main Application JavaScript

const API_BASE = '/api';
let currentPage = 'dashboard';

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    checkAuthStatus();
    loadDashboard();
});

// Navigation
function initializeNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // Update active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Show page
            const pageName = item.dataset.page;
            showPage(pageName);
        });
    });
}

function showPage(pageName) {
    currentPage = pageName;

    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show selected page
    const pageElement = document.getElementById(`${pageName}-page`);
    if (pageElement) {
        pageElement.classList.add('active');
    }

    // Update title
    const titles = {
        'dashboard': 'Dashboard',
        'm365': 'Microsoft 365',
        'intune': 'Intune Devices',
        'avd': 'Azure Virtual Desktop',
        'sessions': 'AVD Sessions'
    };
    document.getElementById('pageTitle').textContent = titles[pageName] || pageName;

    // Load page data
    switch (pageName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'm365':
            loadM365Data();
            break;
        case 'intune':
            loadIntuneDevices();
            break;
        case 'avd':
            loadHostPools();
            break;
        case 'sessions':
            loadHostPoolsForSessions();
            break;
    }
}

function refreshCurrentPage() {
    showPage(currentPage);
    showToast('Refreshing data...', 'Data refresh initiated', 'success');
}

// Authentication
async function checkAuthStatus() {
    try {
        const response = await fetch(`${API_BASE}/auth/status`);
        const data = await response.json();

        const statusElement = document.getElementById('authStatus');
        if (data.authenticated) {
            statusElement.innerHTML = '<span class="status-icon">🔓</span><span class="status-text">Authenticated</span>';
        } else {
            statusElement.innerHTML = '<span class="status-icon">🔒</span><span class="status-text">Not Authenticated</span>';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        document.getElementById('authStatus').innerHTML = '<span class="status-icon">⚠️</span><span class="status-text">Auth Error</span>';
    }
}

// Dashboard
async function loadDashboard() {
    try {
        const response = await fetch(`${API_BASE}/dashboard`);
        const data = await response.json();

        // Update M365 stats
        document.getElementById('m365-users-total').textContent = data.m365.Users.Total;
        document.getElementById('m365-users-active').textContent = data.m365.Users.Active;

        // Update Intune stats
        document.getElementById('intune-devices-total').textContent = data.intune.Devices.Total;
        document.getElementById('intune-devices-compliant').textContent = data.intune.Devices.Compliant;

        // Update AVD stats
        document.getElementById('avd-hosts-total').textContent = data.avd.TotalHosts;
        document.getElementById('avd-hosts-active').textContent = data.avd.ActiveHosts;
        document.getElementById('avd-sessions-total').textContent = data.avd.TotalSessions;

        // Update license overview
        const licenseOverview = document.getElementById('license-overview');
        if (data.m365.Licenses.Details && data.m365.Licenses.Details.length > 0) {
            licenseOverview.innerHTML = data.m365.Licenses.Details.map(license => `
                <div class="license-item">
                    <span class="license-name">${license.Name}</span>
                    <span class="license-count">${license.Consumed} / ${license.Total}</span>
                </div>
            `).join('');
        } else {
            licenseOverview.innerHTML = '<p class="loading">No license data available</p>';
        }

        // Update host pool overview
        const hostpoolOverview = document.getElementById('hostpool-overview');
        if (data.avd.HostPools && data.avd.HostPools.length > 0) {
            hostpoolOverview.innerHTML = data.avd.HostPools.map(pool => `
                <div class="hostpool-item">
                    <span class="hostpool-name">${pool.Name}</span>
                    <span class="hostpool-stats">${pool.ActiveHosts}/${pool.TotalHosts} hosts, ${pool.ActiveSessions} sessions</span>
                </div>
            `).join('');
        } else {
            hostpoolOverview.innerHTML = '<p class="loading">No host pool data available</p>';
        }

    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast('Error', 'Failed to load dashboard data', 'error');
    }
}

// M365 Management
async function loadM365Data() {
    await loadUsers();
    await loadGroups();
}

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/m365/users?top=50`);
        const data = await response.json();

        const tbody = document.querySelector('#users-table tbody');

        if (data.value && data.value.length > 0) {
            tbody.innerHTML = data.value.map(user => `
                <tr>
                    <td>${user.displayName || 'N/A'}</td>
                    <td>${user.userPrincipalName || 'N/A'}</td>
                    <td><span class="badge ${user.accountEnabled ? 'badge-success' : 'badge-danger'}">${user.accountEnabled ? 'Enabled' : 'Disabled'}</span></td>
                    <td>${user.assignedLicenses ? user.assignedLicenses.length : 0}</td>
                    <td>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-secondary" onclick="viewUser('${user.id}')">View</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No users found</td></tr>';
        }
    } catch (error) {
        console.error('Users load error:', error);
        showToast('Error', 'Failed to load users', 'error');
    }
}

async function loadGroups() {
    try {
        const response = await fetch(`${API_BASE}/m365/groups`);
        const data = await response.json();

        const tbody = document.querySelector('#groups-table tbody');

        if (data.value && data.value.length > 0) {
            tbody.innerHTML = data.value.map(group => `
                <tr>
                    <td>${group.displayName || 'N/A'}</td>
                    <td>${group.groupTypes && group.groupTypes.includes('Unified') ? 'Microsoft 365' : 'Security'}</td>
                    <td><span class="badge ${group.mailEnabled ? 'badge-success' : 'badge-secondary'}">${group.mailEnabled ? 'Yes' : 'No'}</span></td>
                    <td><span class="badge ${group.securityEnabled ? 'badge-success' : 'badge-secondary'}">${group.securityEnabled ? 'Yes' : 'No'}</span></td>
                    <td>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-secondary" onclick="viewGroup('${group.id}')">View</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">No groups found</td></tr>';
        }
    } catch (error) {
        console.error('Groups load error:', error);
        showToast('Error', 'Failed to load groups', 'error');
    }
}

// Intune Device Management
async function loadIntuneDevices() {
    try {
        const response = await fetch(`${API_BASE}/intune/devices?top=50`);
        const data = await response.json();

        const tbody = document.querySelector('#devices-table tbody');

        if (data.value && data.value.length > 0) {
            tbody.innerHTML = data.value.map(device => `
                <tr>
                    <td>${device.deviceName || 'N/A'}</td>
                    <td>${device.userDisplayName || device.userPrincipalName || 'N/A'}</td>
                    <td>${device.operatingSystem || 'N/A'}</td>
                    <td><span class="badge ${getComplianceBadgeClass(device.complianceState)}">${device.complianceState || 'Unknown'}</span></td>
                    <td>${device.lastSyncDateTime ? new Date(device.lastSyncDateTime).toLocaleString() : 'Never'}</td>
                    <td>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-secondary" onclick="syncDevice('${device.id}')">Sync</button>
                            <button class="btn btn-sm btn-warning" onclick="restartDevice('${device.id}')">Restart</button>
                            <button class="btn btn-sm btn-danger" onclick="lockDevice('${device.id}')">Lock</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No devices found</td></tr>';
        }
    } catch (error) {
        console.error('Devices load error:', error);
        showToast('Error', 'Failed to load devices', 'error');
    }
}

function getComplianceBadgeClass(state) {
    switch (state) {
        case 'compliant': return 'badge-success';
        case 'noncompliant': return 'badge-danger';
        default: return 'badge-secondary';
    }
}

async function syncDevice(deviceId) {
    if (!confirm('Sync this device?')) return;

    try {
        await fetch(`${API_BASE}/intune/devices/${deviceId}/sync`, { method: 'POST' });
        showToast('Success', 'Device sync initiated', 'success');
    } catch (error) {
        showToast('Error', 'Failed to sync device', 'error');
    }
}

async function restartDevice(deviceId) {
    if (!confirm('Restart this device?')) return;

    try {
        await fetch(`${API_BASE}/intune/devices/${deviceId}/restart`, { method: 'POST' });
        showToast('Success', 'Device restart initiated', 'success');
    } catch (error) {
        showToast('Error', 'Failed to restart device', 'error');
    }
}

async function lockDevice(deviceId) {
    if (!confirm('Lock this device?')) return;

    try {
        await fetch(`${API_BASE}/intune/devices/${deviceId}/lock`, { method: 'POST' });
        showToast('Success', 'Device lock initiated', 'success');
    } catch (error) {
        showToast('Error', 'Failed to lock device', 'error');
    }
}

// AVD Management
async function loadHostPools() {
    try {
        const response = await fetch(`${API_BASE}/avd/hostpools`);
        const data = await response.json();

        const select = document.getElementById('hostpool-select');

        if (data.value && data.value.length > 0) {
            select.innerHTML = '<option value="">Select Host Pool...</option>' +
                data.value.map(pool => `<option value="${pool.name}">${pool.name}</option>`).join('');
        } else {
            select.innerHTML = '<option value="">No host pools found</option>';
        }
    } catch (error) {
        console.error('Host pools load error:', error);
        showToast('Error', 'Failed to load host pools', 'error');
    }
}

async function loadSessionHosts() {
    const hostPool = document.getElementById('hostpool-select').value;
    if (!hostPool) return;

    try {
        const response = await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts`);
        const data = await response.json();

        const tbody = document.querySelector('#sessionhosts-table tbody');

        if (data.value && data.value.length > 0) {
            tbody.innerHTML = data.value.map(host => `
                <tr>
                    <td>${host.name || 'N/A'}</td>
                    <td><span class="badge ${getStatusBadgeClass(host.properties.status)}">${host.properties.status || 'Unknown'}</span></td>
                    <td>${host.properties.sessions || 0}</td>
                    <td><span class="badge ${host.properties.allowNewSession ? 'badge-success' : 'badge-warning'}">${host.properties.allowNewSession ? 'No' : 'Yes'}</span></td>
                    <td>${host.properties.lastHeartBeat ? new Date(host.properties.lastHeartBeat).toLocaleString() : 'Never'}</td>
                    <td>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-success" onclick="startSessionHost('${hostPool}', '${host.name}')">Start</button>
                            <button class="btn btn-sm btn-warning" onclick="restartSessionHost('${hostPool}', '${host.name}')">Restart</button>
                            <button class="btn btn-sm btn-danger" onclick="stopSessionHost('${hostPool}', '${host.name}')">Stop</button>
                            <button class="btn btn-sm btn-secondary" onclick="toggleDrainMode('${hostPool}', '${host.name}', ${host.properties.allowNewSession})">Drain</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No session hosts found</td></tr>';
        }
    } catch (error) {
        console.error('Session hosts load error:', error);
        showToast('Error', 'Failed to load session hosts', 'error');
    }
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'Available': return 'badge-success';
        case 'Unavailable': return 'badge-danger';
        default: return 'badge-secondary';
    }
}

async function startSessionHost(hostPool, hostName) {
    if (!confirm('Start this session host?')) return;

    try {
        await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts/${hostName}/start`, { method: 'POST' });
        showToast('Success', 'Session host start initiated', 'success');
        setTimeout(() => loadSessionHosts(), 2000);
    } catch (error) {
        showToast('Error', 'Failed to start session host', 'error');
    }
}

async function stopSessionHost(hostPool, hostName) {
    if (!confirm('Stop this session host?')) return;

    try {
        await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts/${hostName}/stop`, { method: 'POST' });
        showToast('Success', 'Session host stop initiated', 'success');
        setTimeout(() => loadSessionHosts(), 2000);
    } catch (error) {
        showToast('Error', 'Failed to stop session host', 'error');
    }
}

async function restartSessionHost(hostPool, hostName) {
    if (!confirm('Restart this session host?')) return;

    try {
        await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts/${hostName}/restart`, { method: 'POST' });
        showToast('Success', 'Session host restart initiated', 'success');
        setTimeout(() => loadSessionHosts(), 2000);
    } catch (error) {
        showToast('Error', 'Failed to restart session host', 'error');
    }
}

async function toggleDrainMode(hostPool, hostName, currentAllowNewSession) {
    const enable = currentAllowNewSession; // If currently allowing, we want to enable drain mode
    const action = enable ? 'enable' : 'disable';

    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} drain mode for this session host?`)) return;

    try {
        await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts/${hostName}/drainmode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enable })
        });
        showToast('Success', `Drain mode ${action}d`, 'success');
        setTimeout(() => loadSessionHosts(), 1000);
    } catch (error) {
        showToast('Error', `Failed to ${action} drain mode`, 'error');
    }
}

// AVD Sessions
async function loadHostPoolsForSessions() {
    try {
        const response = await fetch(`${API_BASE}/avd/hostpools`);
        const data = await response.json();

        const select = document.getElementById('sessions-hostpool-select');

        if (data.value && data.value.length > 0) {
            select.innerHTML = '<option value="">Select Host Pool...</option>' +
                data.value.map(pool => `<option value="${pool.name}">${pool.name}</option>`).join('');
        } else {
            select.innerHTML = '<option value="">No host pools found</option>';
        }
    } catch (error) {
        console.error('Host pools load error:', error);
    }
}

async function loadUserSessions() {
    const hostPool = document.getElementById('sessions-hostpool-select').value;
    if (!hostPool) return;

    try {
        const response = await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessions`);
        const data = await response.json();

        const tbody = document.querySelector('#sessions-table tbody');

        if (data.value && data.value.length > 0) {
            tbody.innerHTML = data.value.map(session => `
                <tr>
                    <td>${session.properties.userPrincipalName || 'N/A'}</td>
                    <td>${session.name ? session.name.split('/')[1] : 'N/A'}</td>
                    <td><span class="badge ${getSessionStateBadgeClass(session.properties.sessionState)}">${session.properties.sessionState || 'Unknown'}</span></td>
                    <td>${session.properties.applicationType || 'N/A'}</td>
                    <td>${session.properties.createTime ? new Date(session.properties.createTime).toLocaleString() : 'N/A'}</td>
                    <td>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-warning" onclick="disconnectSession('${hostPool}', '${session.name}', '${session.id}')">Disconnect</button>
                            <button class="btn btn-sm btn-danger" onclick="logoffSession('${hostPool}', '${session.name}', '${session.id}')">Logoff</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No active sessions found</td></tr>';
        }
    } catch (error) {
        console.error('Sessions load error:', error);
        showToast('Error', 'Failed to load sessions', 'error');
    }
}

function getSessionStateBadgeClass(state) {
    switch (state) {
        case 'Active': return 'badge-success';
        case 'Disconnected': return 'badge-warning';
        default: return 'badge-secondary';
    }
}

async function disconnectSession(hostPool, sessionName, sessionId) {
    if (!confirm('Disconnect this user session?')) return;

    const hostName = sessionName.split('/')[1];

    try {
        await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts/${hostName}/sessions/${sessionId}/disconnect`, { method: 'POST' });
        showToast('Success', 'Session disconnected', 'success');
        setTimeout(() => loadUserSessions(), 1000);
    } catch (error) {
        showToast('Error', 'Failed to disconnect session', 'error');
    }
}

async function logoffSession(hostPool, sessionName, sessionId) {
    if (!confirm('Logoff this user? This will end their session immediately.')) return;

    const hostName = sessionName.split('/')[1];

    try {
        await fetch(`${API_BASE}/avd/hostpools/${hostPool}/sessionhosts/${hostName}/sessions/${sessionId}`, { method: 'DELETE' });
        showToast('Success', 'User logged off', 'success');
        setTimeout(() => loadUserSessions(), 1000);
    } catch (error) {
        showToast('Error', 'Failed to logoff user', 'error');
    }
}

// Toast Notifications
function showToast(title, message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Placeholder functions
function viewUser(userId) {
    showToast('Info', 'User details view coming soon', 'success');
}

function viewGroup(groupId) {
    showToast('Info', 'Group details view coming soon', 'success');
}

function showModal(modalType) {
    showToast('Info', 'Create forms coming soon', 'success');
}
