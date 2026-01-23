// Dashboard JavaScript - Real-time Location Monitoring with Authentication

// Initialize map
let map = null;

// Global variables
let markers = {};
let selectedUser = null;
let currentTab = 'all';
let refreshCountdown = 5;
let autoRefreshInterval = null;
let ws = null;
let userDataCache = {};

// Authentication check
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        if (data.authenticated) {
            // Hide auth overlay, show dashboard
            document.getElementById('authOverlay').style.display = 'none';
            document.getElementById('sidebar').style.display = 'flex';
            document.getElementById('mapContainer').style.display = 'block';
            
            // Initialize map after auth check
            if (!map) {
                map = L.map('map').setView([30.1898, 71.4845], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: 19
                }).addTo(map);
            }
            
            return true;
        } else {
            // Not authenticated, redirect to login
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 1000);
            return false;
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 1000);
        return false;
    }
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            // Clear any local storage
            sessionStorage.clear();
            localStorage.clear();
            
            // Redirect to login
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login.html';
    }
}

// Format time ago
function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return 'Long time ago';
}

// Format date time
function formatDateTime(timestamp) {
    if (!timestamp) return '--';
    
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// Initialize WebSocket with heartbeat
function initWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ Dashboard WebSocket connected');
        if (document.getElementById('refreshTimer')) {
            document.getElementById('refreshTimer').parentElement.style.background = '#28a745';
        }
        
        // Start heartbeat (optional)
        setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000); // Send ping every 30 seconds
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // Handle WebSocket messages if server sends any
            if (data.type === 'pong') {
                // Heartbeat response
            }
        } catch (e) {
            console.error('WebSocket message error:', e);
        }
    };
    
    ws.onclose = () => {
        console.log('❌ Dashboard WebSocket disconnected');
        if (document.getElementById('refreshTimer')) {
            document.getElementById('refreshTimer').parentElement.style.background = '#dc3545';
        }
        // Try to reconnect after 3 seconds
        setTimeout(initWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Fetch users from server
async function refreshUsers() {
    try {
        console.log('🔄 Fetching users...');
        
        const response = await fetch('/api/users');
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log(`✅ Got ${data.count} users`);
            
            // Update cache
            userDataCache = data.users;
            
            updateDashboard(data.users);
            updateUserList(data.users);
        } else {
            console.error('❌ Error fetching users:', data.message);
        }
    } catch (error) {
        console.error('❌ Network error:', error);
    }
}

// Update dashboard stats
function updateDashboardStats() {
    const userCount = Object.keys(userDataCache).length;
    const onlineCount = Object.values(userDataCache).filter(u => u.online).length;
    
    document.getElementById('totalUsers').textContent = userCount;
    document.getElementById('onlineUsers').textContent = onlineCount;
    document.getElementById('lastUpdate').textContent = 
        new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function updateDashboard(users) {
    userDataCache = users;
    updateDashboardStats();
    updateUserList(users);
}

// Update user list
function updateUserList(users) {
    const userList = document.getElementById('userList');
    const noUsersMessage = document.getElementById('noUsersMessage');
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();
    
    // Clear current list
    userList.innerHTML = '';
    
    // Filter users based on tab and search
    let filteredUsers = Object.entries(users);
    
    // Apply tab filter
    if (currentTab === 'online') {
        filteredUsers = filteredUsers.filter(([username, data]) => data.online);
    } else if (currentTab === 'offline') {
        filteredUsers = filteredUsers.filter(([username, data]) => !data.online);
    }
    
    // Apply search filter
    if (searchQuery) {
        filteredUsers = filteredUsers.filter(([username, data]) => 
            username.toLowerCase().includes(searchQuery)
        );
    }
    
    // Show no users message if empty
    if (filteredUsers.length === 0) {
        noUsersMessage.style.display = 'block';
        userList.appendChild(noUsersMessage);
        return;
    } else {
        noUsersMessage.style.display = 'none';
    }
    
    // Sort users: online first, then by last seen
    filteredUsers.sort(([aName, aData], [bName, bData]) => {
        if (aData.online && !bData.online) return -1;
        if (!aData.online && bData.online) return 1;
        
        const aTime = new Date(aData.last_seen || 0);
        const bTime = new Date(bData.last_seen || 0);
        return bTime - aTime;
    });
    
    // Create user cards
    filteredUsers.forEach(([username, data]) => {
        const card = document.createElement('div');
        card.className = `user-card ${selectedUser === username ? 'active' : ''}`;
        card.onclick = () => selectUser(username, data);
        
        // Get activity icon
        let activityIcon = '❓';
        if (data.activity.includes('Stationary')) activityIcon = '🧍';
        else if (data.activity.includes('Walking')) activityIcon = '🚶';
        else if (data.activity.includes('Running')) activityIcon = '🏃';
        else if (data.activity.includes('Cycling')) activityIcon = '🚴';
        else if (data.activity.includes('Driving')) activityIcon = '🚗';
        
        // Battery class
        let batteryClass = 'battery-high';
        if (data.battery < 50) batteryClass = 'battery-medium';
        if (data.battery < 20) batteryClass = 'battery-low';
        
        // Speed in km/h
        const speedKmh = (data.speed * 3.6).toFixed(1);
        
        card.innerHTML = `
            <div class="user-header">
                <div class="user-name">
                    <i class="fas fa-user-circle"></i> ${username}
                </div>
                <div class="user-status ${data.online ? 'status-online' : 'status-offline'}">
                    ${data.online ? 'ONLINE' : 'OFFLINE'}
                </div>
            </div>
            <div class="user-details">
                <div class="detail-item">
                    <div class="detail-label"><i class="fas fa-walking"></i> Activity</div>
                    <div class="detail-value">${activityIcon} ${data.activity}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label"><i class="fas fa-clock"></i> Last Seen</div>
                    <div class="detail-value">${formatTimeAgo(data.last_seen)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label"><i class="fas fa-tachometer-alt"></i> Speed</div>
                    <div class="detail-value">${speedKmh} km/h</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label"><i class="fas fa-battery-full"></i> Battery</div>
                    <div class="detail-value">
                        ${data.battery}%
                        <div class="battery-bar">
                            <div class="battery-fill ${batteryClass}" style="width: ${data.battery}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        userList.appendChild(card);
    });
    
    // Update map markers
    updateMapMarkers(users);
}

// Update map markers
function updateMapMarkers(users) {
    Object.entries(users).forEach(([username, data]) => {
        if (data.lat && data.lng) {
            let marker = markers[username];
            
            if (!marker) {
                // Create new marker
                const icon = L.divIcon({
                    html: `
                        <div style="
                            background: ${data.online ? '#28a745' : '#dc3545'};
                            color: white;
                            width: 40px;
                            height: 40px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.3);
                            border: 3px solid white;
                            ${data.online ? 'animation: pulse 2s infinite;' : ''}
                            cursor: pointer;
                            font-weight: bold;
                        ">
                            <i class="fas fa-map-marker-alt"></i>
                        </div>
                    `,
                    className: data.online ? 'pulse-marker' : '',
                    iconSize: [40, 40],
                    iconAnchor: [20, 40]
                });
                
                marker = L.marker([data.lat, data.lng], { icon })
                    .addTo(map)
                    .bindPopup(`
                        <div style="font-weight: bold; margin-bottom: 5px;">
                            <i class="fas fa-user"></i> ${username}
                        </div>
                        <div><small>${data.activity}</small></div>
                        <div><small>📍 ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}</small></div>
                        <div><small>🔋 ${data.battery}%</small></div>
                        <div><small>⏱️ ${formatTimeAgo(data.last_seen)}</small></div>
                        <button onclick="selectUserFromMap('${username}')" 
                            style="margin-top: 8px; padding: 5px 10px; background: #1a2980; color: white; border: none; border-radius: 3px; cursor: pointer;">
                            View Details
                        </button>
                    `);
                
                marker.on('click', () => selectUser(username, data));
                markers[username] = marker;
                
            } else {
                // Update existing marker
                marker.setLatLng([data.lat, data.lng]);
                
                // Update marker style
                const newIcon = L.divIcon({
                    html: `
                        <div style="
                            background: ${data.online ? '#28a745' : '#dc3545'};
                            color: white;
                            width: 40px;
                            height: 40px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.3);
                            border: 3px solid white;
                            ${data.online ? 'animation: pulse 2s infinite;' : ''}
                            cursor: pointer;
                            font-weight: bold;
                        ">
                            <i class="fas fa-map-marker-alt"></i>
                        </div>
                    `,
                    className: data.online ? 'pulse-marker' : '',
                    iconSize: [40, 40],
                    iconAnchor: [20, 40]
                });
                
                marker.setIcon(newIcon);
                
                // Update popup content
                marker.getPopup().setContent(`
                    <div style="font-weight: bold; margin-bottom: 5px;">
                        <i class="fas fa-user"></i> ${username}
                    </div>
                    <div><small>${data.activity}</small></div>
                    <div><small>📍 ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}</small></div>
                    <div><small>🔋 ${data.battery}%</small></div>
                    <div><small>⏱️ ${formatTimeAgo(data.last_seen)}</small></div>
                    <button onclick="selectUserFromMap('${username}')" 
                        style="margin-top: 8px; padding: 5px 10px; background: #1a2980; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        View Details
                    </button>
                `);
            }
        } else {
            // Remove marker if no location
            if (markers[username]) {
                map.removeLayer(markers[username]);
                delete markers[username];
            }
        }
    });
}

// Select a user
async function selectUser(username, userData = null) {
    selectedUser = username;
    
    // Update UI
    document.querySelectorAll('.user-card').forEach(card => {
        card.classList.remove('active');
    });
    
    // Find and activate the selected card
    const cards = document.querySelectorAll('.user-card');
    for (let card of cards) {
        if (card.textContent.includes(username)) {
            card.classList.add('active');
            break;
        }
    }
    
    // Get fresh user data if not provided
    if (!userData) {
        const response = await fetch('/api/users');
        const data = await response.json();
        userData = data.users[username];
    }
    
    if (!userData) return;
    
    // Center map on user
    if (userData.lat && userData.lng) {
        map.setView([userData.lat, userData.lng], 15);
    }
    
    // Show info panel
    showInfoPanel(username, userData);
    
    // Load user history
    loadUserHistory(username);
    
    // Load user analytics
    loadUserAnalytics(username);
}

// Show info panel
function showInfoPanel(username, userData) {
    const panel = document.getElementById('infoPanel');
    
    // Update panel content
    document.getElementById('selectedUserName').textContent = username;
    document.getElementById('infoStatus').innerHTML = userData.online 
        ? '<span style="color: #28a745;">🟢 Online</span>' 
        : '<span style="color: #dc3545;">🔴 Offline</span>';
    document.getElementById('infoActivity').textContent = userData.activity;
    document.getElementById('infoSpeed').textContent = `${(userData.speed * 3.6).toFixed(1)} km/h`;
    document.getElementById('infoAccuracy').textContent = `${Math.round(userData.accuracy)} meters`;
    document.getElementById('infoBattery').textContent = `${userData.battery}%`;
    document.getElementById('infoLat').textContent = userData.lat ? userData.lat.toFixed(6) : '--';
    document.getElementById('infoLng').textContent = userData.lng ? userData.lng.toFixed(6) : '--';
    document.getElementById('infoLastSeen').textContent = formatDateTime(userData.last_seen);
    
    // Show panel
    panel.style.display = 'block';
}

// Close info panel
function closeInfoPanel() {
    const panel = document.getElementById('infoPanel');
    panel.style.display = 'none';
    
    // Clear selection
    selectedUser = null;
    document.querySelectorAll('.user-card').forEach(card => {
        card.classList.remove('active');
    });
}

// Close analytics panel
function closeAnalyticsPanel() {
    document.getElementById('analyticsPanel').style.display = 'none';
}

// Load user history
async function loadUserHistory(username) {
    try {
        const response = await fetch(`/api/user/${username}/history?hours=24&limit=10`);
        const data = await response.json();
        
        const historyDiv = document.getElementById('activityHistory');
        
        if (data.status === 'success' && data.locations && data.locations.length > 0) {
            let html = '';
            
            // Show last 5 activities
            data.locations.slice(0, 5).forEach(location => {
                const time = new Date(location.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const date = new Date(location.time).toLocaleDateString();
                
                let activityIcon = '🧍';
                if (location.activity.includes('Walking')) activityIcon = '🚶';
                else if (location.activity.includes('Running')) activityIcon = '🏃';
                else if (location.activity.includes('Cycling')) activityIcon = '🚴';
                else if (location.activity.includes('Driving')) activityIcon = '🚗';
                
                html += `
                    <div class="history-item">
                        <div>
                            <strong>${activityIcon} ${location.activity}</strong><br>
                            <small>📍 ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}</small>
                        </div>
                        <div>
                            <small>${time}</small><br>
                            <small>${date}</small>
                        </div>
                    </div>
                `;
            });
            
            historyDiv.innerHTML = html;
        } else {
            historyDiv.innerHTML = '<div class="no-data" style="padding: 20px;">No recent activity</div>';
        }
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('activityHistory').innerHTML = 
            '<div class="no-data" style="padding: 20px;">Error loading history</div>';
    }
}

// Load user analytics
async function loadUserAnalytics(username) {
    try {
        // Show analytics panel
        const panel = document.getElementById('analyticsPanel');
        panel.style.display = 'block';
        
        // Get user details
        const response = await fetch(`/api/user/${username}`);
        const data = await response.json();
        
        if (data.status === 'success' && data.user) {
            const user = data.user;
            
            // Update analytics values
            document.getElementById('analyticsTotal').textContent = user.total_points || 0;
            document.getElementById('analyticsAvgSpeed').textContent = (user.speed * 3.6).toFixed(1) + ' km/h';
            document.getElementById('analyticsDays').textContent = Math.ceil((user.total_points || 0) / 100);
            
            // Get daily stats for chart
            const dailyResponse = await fetch(`/api/user/${username}/daily?days=7`);
            const dailyData = await dailyResponse.json();
            
            if (dailyData.status === 'success' && dailyData.stats) {
                // Create simple chart
                createDailyChart(dailyData.stats);
            }
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

// Create daily chart
function createDailyChart(stats) {
    const chartDiv = document.getElementById('dailyChart');
    
    if (stats.length === 0) {
        chartDiv.innerHTML = '<div class="no-data" style="padding: 30px;">No daily data available</div>';
        return;
    }
    
    // Reverse to show oldest first
    stats = stats.reverse();
    
    let html = '<div style="display: flex; align-items: flex-end; height: 150px; gap: 5px;">';
    
    const maxPoints = Math.max(...stats.map(s => s.total_points || 0));
    
    stats.forEach(day => {
        const date = new Date(day.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const height = maxPoints > 0 ? (day.total_points / maxPoints) * 100 : 10;
        
        html += `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%;">
                <div style="
                    background: linear-gradient(180deg, #1a2980, #26d0ce);
                    width: 20px;
                    height: ${height}%;
                    border-radius: 4px 4px 0 0;
                    margin-top: auto;
                "></div>
                <div style="margin-top: 5px; font-size: 10px; color: #666;">${dayName}</div>
                <div style="font-size: 9px; color: #999;">${day.total_points || 0}</div>
            </div>
        `;
    });
    
    html += '</div>';
    
    chartDiv.innerHTML = html;
}

// Show tab
function showTab(tabName) {
    currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const buttons = document.querySelectorAll('.tab');
    for (let btn of buttons) {
        if (btn.textContent.toLowerCase().includes(tabName)) {
            btn.classList.add('active');
            break;
        }
    }
    
    // Refresh user list
    refreshUsers();
}

// Delete selected user
async function deleteSelectedUser() {
    if (!selectedUser) {
        alert('Please select a user first');
        return;
    }
    
    if (!confirm(`Are you sure you want to remove "${selectedUser}" from the dashboard?\n\nNote: Location history will be preserved.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/user/${selectedUser}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            alert(`✅ User "${selectedUser}" has been removed`);
            
            // Clean up
            if (markers[selectedUser]) {
                map.removeLayer(markers[selectedUser]);
                delete markers[selectedUser];
            }
            
            closeInfoPanel();
            closeAnalyticsPanel();
            refreshUsers();
            
        } else {
            alert('❌ Error removing user: ' + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('❌ Error removing user. Please try again.');
    }
}

// Search functionality
document.getElementById('searchInput').addEventListener('input', () => {
    refreshUsers();
});

// Update refresh timer
function updateRefreshTimer() {
    refreshCountdown--;
    
    if (refreshCountdown <= 0) {
        refreshCountdown = 5;
        refreshUsers();
    }
    
    document.getElementById('refreshTimer').textContent = refreshCountdown;
}

// Select user from map
function selectUserFromMap(username) {
    // Close popup
    if (markers[username]) {
        markers[username].closePopup();
    }
    
    // Select the user
    refreshUsers().then(() => {
        // Try to find and select the user
        setTimeout(() => {
            fetch('/api/users')
                .then(res => res.json())
                .then(data => {
                    if (data.users[username]) {
                        selectUser(username, data.users[username]);
                    }
                });
        }, 100);
    });
}

// Initialize dashboard
async function initializeDashboard() {
    console.log('🚀 Initializing dashboard...');
    
    // Check authentication first
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        return;
    }
    
    // Initialize WebSocket (for connection status only)
    initWebSocket();
    
    // Initial refresh
    await refreshUsers();
    
    // Start auto-refresh
    autoRefreshInterval = setInterval(refreshUsers, 5000);
    
    // Start timer countdown
    setInterval(updateRefreshTimer, 1000);
    
    // Load system stats
    loadSystemStats();
    
    console.log('✅ Dashboard initialized');
}

// Load system stats
async function loadSystemStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log('📊 System stats loaded');
        }
    } catch (error) {
        console.error('Error loading system stats:', error);
    }
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', initializeDashboard);