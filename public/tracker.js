// Location Tracker - User Side
let username = '';
let watchId = null;
let lastLocation = null;
let updateCount = 0;
let sessionStartTime = null;
let batteryLevel = 100;
let isCharging = false;
let isSharing = false;

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const infoBox = document.getElementById('infoBox');
const loadingDiv = document.getElementById('loading');

// Format time duration
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

// Get activity from speed
function getActivityFromSpeed(speed) {
    const kmh = speed * 3.6;
    
    if (kmh < 1) return 'Stationary';
    if (kmh < 5) return 'Walking';
    if (kmh < 15) return 'Running';
    if (kmh < 30) return 'Cycling';
    return 'Driving';
}

// Get battery level if available
async function getBatteryInfo() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            batteryLevel = Math.round(battery.level * 100);
            isCharging = battery.charging;
            
            battery.addEventListener('levelchange', () => {
                batteryLevel = Math.round(battery.level * 100);
                updateBatteryDisplay();
            });
            
            battery.addEventListener('chargingchange', () => {
                isCharging = battery.charging;
                updateBatteryDisplay();
            });
            
            updateBatteryDisplay();
            
        } catch (error) {
            console.log('Battery API not available:', error);
            // Use random battery for demo
            batteryLevel = Math.floor(Math.random() * 100);
            updateBatteryDisplay();
        }
    } else {
        // Fallback
        batteryLevel = Math.floor(Math.random() * 100);
        updateBatteryDisplay();
    }
}

// Update battery display
function updateBatteryDisplay() {
    const batteryFill = document.getElementById('batteryFill');
    const batteryText = document.getElementById('batteryText');
    
    if (batteryFill && batteryText) {
        batteryFill.style.width = `${batteryLevel}%`;
        
        // Set color
        if (batteryLevel > 60) {
            batteryFill.className = 'battery-fill battery-high';
        } else if (batteryLevel > 30) {
            batteryFill.className = 'battery-fill battery-medium';
        } else {
            batteryFill.className = 'battery-fill battery-low';
        }
        
        batteryText.textContent = `${batteryLevel}%${isCharging ? ' 🔌' : ''}`;
    }
}

// Show status message
function showStatus(message, type = 'info') {
    if (!statusDiv) return;
    
    statusDiv.className = `status-box status-${type}`;
    statusDiv.innerHTML = message;
    statusDiv.style.display = 'block';
}

// Start sharing location
async function startSharing() {
    username = document.getElementById('username').value.trim();
    
    if (!username) {
        alert('Please enter your name to start sharing location');
        document.getElementById('username').focus();
        return;
    }
    
    // Check if browser supports geolocation
    if (!navigator.geolocation) {
        showStatus('❌ Your browser does not support location tracking', 'offline');
        return;
    }
    
    // Update UI
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    loadingDiv.style.display = 'block';
    infoBox.style.display = 'none';
    
    // Reset counters
    updateCount = 0;
    sessionStartTime = new Date();
    
    // Get battery info
    await getBatteryInfo();
    
    // Request location permission
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });
        
        // Success - start tracking
        lastLocation = position;
        updateDisplay(position);
        sendLocationToServer(position);
        
        // Start watching position
        watchId = navigator.geolocation.watchPosition(
            locationSuccess,
            locationError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );
        
        // Periodic updates every 3 seconds
        setInterval(sendPeriodicUpdate, 3000);
        
        // Update session timer every second
        setInterval(updateSessionTimer, 1000);
        
        isSharing = true;
        
        // Hide loading, show info
        loadingDiv.style.display = 'none';
        infoBox.style.display = 'block';
        
        showStatus('✅ Location sharing active! Keep this tab open.', 'online');
        
    } catch (error) {
        handleLocationError(error);
    }
}

// Stop sharing location
function stopSharing() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    isSharing = false;
    
    // Update UI
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    infoBox.style.display = 'none';
    
    showStatus('❌ Location sharing stopped', 'offline');
}

// Location success handler
function locationSuccess(position) {
    lastLocation = position;
    updateCount++;
    updateDisplay(position);
    sendLocationToServer(position);
}

// Update display with location data
function updateDisplay(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = Math.round(position.coords.accuracy);
    const speed = position.coords.speed || 0;
    const activity = getActivityFromSpeed(speed);
    
    // Update coordinates
    document.getElementById('coordinates').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('accuracy').textContent = `${accuracy} meters`;
    document.getElementById('activity').textContent = activity;
    document.getElementById('speedValue').textContent = (speed * 3.6).toFixed(1);
    document.getElementById('updateCount').textContent = updateCount;
    
    // Update map preview
    const mapDiv = document.getElementById('locationMap');
    if (mapDiv) {
        mapDiv.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <i class="fas fa-map-marker-alt" style="font-size: 48px; color: #dc3545;"></i>
                <p style="margin-top: 10px; font-weight: 600;">📍 Live Location</p>
                <p style="font-size: 12px; color: #666;">${lat.toFixed(4)}, ${lng.toFixed(4)}</p>
                <p style="font-size: 11px; color: #999;">Accuracy: ${accuracy}m</p>
            </div>
        `;
    }
    
    updateBatteryDisplay();
}

// Update session timer
function updateSessionTimer() {
    if (sessionStartTime) {
        const now = new Date();
        const diffSeconds = Math.floor((now - sessionStartTime) / 1000);
        document.getElementById('sessionTime').textContent = formatDuration(diffSeconds);
    }
}

// Send location to server
async function sendLocationToServer(position) {
    if (!username || !isSharing) return;
    
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const speed = position.coords.speed || 0;
    const accuracy = position.coords.accuracy || 0;
    const activity = getActivityFromSpeed(speed);
    
    const locationData = {
        username: username,
        lat: lat,
        lng: lng,
        speed: speed,
        activity: activity,
        accuracy: accuracy,
        battery: batteryLevel,
        device_info: navigator.userAgent
    };
    
    try {
        const response = await fetch('/api/location', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(locationData)
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            updateCount++;
            document.getElementById('updateCount').textContent = updateCount;
            
            console.log(`✅ Location sent (${updateCount})`);
        } else {
            console.error('Failed to save location:', data);
        }
    } catch (error) {
        console.error('Error sending location:', error);
    }
}

// Send periodic update
function sendPeriodicUpdate() {
    if (lastLocation && isSharing) {
        sendLocationToServer(lastLocation);
    }
}

// Handle location errors
function handleLocationError(error) {
    let message = 'Unable to get your location';
    let details = '';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message = 'Location permission denied';
            details = 'Please allow location access in your browser settings';
            break;
        case error.POSITION_UNAVAILABLE:
            message = 'Location unavailable';
            details = 'Make sure location services are enabled on your device';
            break;
        case error.TIMEOUT:
            message = 'Location request timeout';
            details = 'Please check your internet connection';
            break;
    }
    
    showStatus(`❌ ${message}<br><small>${details}</small>`, 'offline');
    loadingDiv.style.display = 'none';
}

// Location error callback
function locationError(error) {
    handleLocationError(error);
}

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isSharing) {
        console.log('⚠️ Page hidden - tracking may be paused');
    } else if (isSharing) {
        // Page visible again, get fresh location
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(locationSuccess, locationError);
        }
    }
});

// Handle page unload
window.addEventListener('beforeunload', (e) => {
    if (isSharing) {
        // Show warning
        e.preventDefault();
        e.returnValue = 'Location sharing will stop if you close this page.';
        return e.returnValue;
    }
});

// Auto-focus username field on load
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('location_username');
    if (savedUser) {
        document.getElementById('username').value = savedUser;
    }
    
    document.getElementById('username').focus();
});

// Auto-save username
document.getElementById('username').addEventListener('input', function() {
    localStorage.setItem('location_username', this.value);
});