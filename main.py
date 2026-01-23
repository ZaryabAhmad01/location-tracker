from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from datetime import datetime, timedelta
import database
import config
import uvicorn
import logging
import json
import asyncio
import secrets

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="Live Location Tracker", version="3.0")

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# Helper function to verify admin credentials
def verify_admin_credentials(username: str, password: str) -> bool:
    return username == config.ADMIN_USERNAME and password == config.ADMIN_PASSWORD

# Helper function to check if user is authenticated
def is_authenticated(request: Request) -> bool:
    session_id = request.cookies.get("session_id")
    if not session_id:
        return False
    
    return database.db.validate_admin_session(session_id)

# Protected endpoints middleware
@app.middleware("http")
async def protect_dashboard(request: Request, call_next):
    path = request.url.path
    
    # Public endpoints (no auth required)
    public_paths = [
        "/",
        "/index.html",
        "/login.html",
        "/test.html",
        "/api/location",
        "/api/login",
        "/api/test",
        "/api/health",
        "/ws/"
    ]
    
    # Check if path requires authentication
    requires_auth = False
    if path.startswith("/dashboard") or (path.startswith("/api/") and "login" not in path and "location" not in path):
        requires_auth = True
    
    if requires_auth:
        if not is_authenticated(request):
            # If it's an API request, return 401
            if path.startswith("/api/"):
                return JSONResponse(
                    status_code=401,
                    content={"status": "error", "message": "Unauthorized"}
                )
            # Otherwise redirect to login
            return RedirectResponse(url="/login.html")
    
    # Update session activity
    session_id = request.cookies.get("session_id")
    if session_id:
        database.db.update_admin_session(session_id)
    
    response = await call_next(request)
    return response

# Login endpoint
@app.post("/api/login")
async def login(request: Request, response: Response):
    try:
        data = await request.json()
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        
        if verify_admin_credentials(username, password):
            # Create session in database
            session_id = database.db.create_admin_session(
                username=username,
                ip_address=request.client.host,
                user_agent=request.headers.get("user-agent", "")
            )
            
            if session_id:
                response.set_cookie(
                    key="session_id",
                    value=session_id,
                    httponly=True,
                    max_age=config.SESSION_TIMEOUT,
                    samesite="strict",
                    secure=False
                )
                
                return {
                    "status": "success",
                    "message": "Login successful",
                    "redirect": "/dashboard.html"
                }
            else:
                raise HTTPException(status_code=500, detail="Failed to create session")
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")
            
    except Exception as e:
        logger.error(f"❌ Login error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# Logout endpoint
@app.post("/api/logout")
async def logout(request: Request, response: Response):
    session_id = request.cookies.get("session_id")
    if session_id:
        database.db.delete_admin_session(session_id)
    
    response.delete_cookie(key="session_id")
    return {"status": "success", "message": "Logged out"}

# Check auth status
@app.get("/api/auth/status")
async def auth_status(request: Request):
    authenticated = is_authenticated(request)
    return {
        "status": "success",
        "authenticated": authenticated,
        "username": config.ADMIN_USERNAME if authenticated else None
    }

# Simple WebSocket for real-time updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Just keep connection alive and broadcast messages
            try:
                data = await websocket.receive_text()
                # Parse and handle messages if needed
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/location")
async def save_location(data: dict):
    """Save location data from a user"""
    try:
        username = data.get("username", "").strip()
        lat = data.get("lat")
        lng = data.get("lng")
        
        if not username:
            return {"status": "error", "message": "Username required"}
        
        if lat is None or lng is None:
            return {"status": "error", "message": "Location coordinates required"}
        
        logger.info(f"📍 Location from {username}: {lat:.6f}, {lng:.6f}")
        
        success = database.db.add_location(
            username=username,
            lat=lat,
            lng=lng,
            speed=data.get("speed", 0),
            activity=data.get("activity", "Unknown"),
            accuracy=data.get("accuracy", 0),
            battery=data.get("battery", 100),
            device_info=data.get("device_info")
        )
        
        if success:
            # Notify dashboard in real-time
            await manager.broadcast({
                "type": "location_updated",
                "username": username,
                "lat": lat,
                "lng": lng,
                "activity": data.get("activity", "Unknown"),
                "battery": data.get("battery", 100),
                "online": True,
                "timestamp": datetime.now().isoformat()
            })
            
            return {
                "status": "success",
                "message": "Location saved successfully",
                "username": username,
                "timestamp": datetime.now().isoformat()
            }
        else:
            return {"status": "error", "message": "Failed to save location"}
            
    except Exception as e:
        logger.error(f"❌ Error saving location: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/users")
async def get_all_users():
    """Get all users with their latest data"""
    try:
        users = database.db.get_users()
        
        return {
            "status": "success",
            "count": len(users),
            "users": users,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"❌ Error getting users: {e}")
        return {
            "status": "error",
            "message": str(e),
            "users": {},
            "count": 0
        }

@app.get("/api/user/{username}")
async def get_user_data(username: str):
    """Get detailed user information"""
    try:
        user_data = database.db.get_user_details(username)
        
        if not user_data:
            return {"status": "error", "message": "User not found"}
        
        return {
            "status": "success",
            "user": user_data
        }
    except Exception as e:
        logger.error(f"❌ Error getting user data: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/user/{username}/history")
async def get_user_history(username: str, hours: int = 24, limit: int = 100):
    """Get user's location history"""
    try:
        history = database.db.get_user_history(username, hours, limit)
        
        return {
            "status": "success",
            "username": username,
            "count": len(history),
            "locations": history,
            "timeframe_hours": hours
        }
    except Exception as e:
        logger.error(f"❌ Error getting history: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/user/{username}/daily")
async def get_user_daily_stats(username: str, days: int = 7):
    """Get daily statistics for a user"""
    try:
        stats = database.db.get_user_daily_stats(username, days)
        
        return {
            "status": "success",
            "username": username,
            "days": days,
            "stats": stats
        }
    except Exception as e:
        logger.error(f"❌ Error getting daily stats: {e}")
        return {"status": "error", "message": str(e)}

@app.delete("/api/user/{username}")
async def delete_user(username: str):
    """Delete/disable a user"""
    try:
        success = database.db.delete_user(username)
        
        if success:
            # Notify connected dashboards
            await manager.broadcast({
                "type": "user_deleted",
                "username": username,
                "timestamp": datetime.now().isoformat()
            })
            
            return {
                "status": "success",
                "message": f"User '{username}' has been removed"
            }
        else:
            return {"status": "error", "message": "Failed to delete user"}
    except Exception as e:
        logger.error(f"❌ Error deleting user: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/stats")
async def get_system_stats():
    """Get system-wide statistics"""
    try:
        stats = database.db.get_system_stats()
        
        return {
            "status": "success",
            "stats": stats,
            "timestamp": datetime.now().isoformat(),
            "connections": len(manager.active_connections)
        }
    except Exception as e:
        logger.error(f"❌ Error getting system stats: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        users = database.db.get_users()
        
        return {
            "status": "healthy",
            "database": "connected",
            "users_count": len(users),
            "timestamp": datetime.now().isoformat(),
            "websocket_connections": len(manager.active_connections),
            "admin_username": config.ADMIN_USERNAME,
            "version": "3.0"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "error",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

@app.get("/api/test")
async def test_api():
    """Test endpoint"""
    return {
        "status": "success",
        "message": "Location Tracker API is working!",
        "version": "3.0",
        "endpoints": {
            "POST /api/location": "Save location data",
            "GET /api/users": "Get all users",
            "GET /api/user/{username}": "Get user details",
            "GET /api/user/{username}/history": "Get user history",
            "GET /api/user/{username}/daily": "Get daily stats",
            "DELETE /api/user/{username}": "Delete user",
            "GET /api/stats": "Get system statistics",
            "GET /api/health": "Health check",
            "WebSocket /ws": "Real-time updates",
            "POST /api/login": "Admin login",
            "POST /api/logout": "Admin logout",
            "GET /api/auth/status": "Check auth status"
        }
    }

# Background task to clean up old data
async def cleanup_old_data():
    """Clean up old location data periodically"""
    while True:
        try:
            conn = database.db.get_connection()
            c = conn.cursor()
            
            # Delete locations older than 30 days
            old_date = (datetime.now() - timedelta(days=30)).isoformat()
            c.execute('DELETE FROM locations WHERE created_at < ?', (old_date,))
            
            deleted = c.rowcount
            if deleted > 0:
                logger.info(f"🧹 Cleaned up {deleted} old location records")
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Error in cleanup: {e}")
        
        # Run every hour
        await asyncio.sleep(3600)

# Background task to clean up expired sessions
async def cleanup_sessions():
    """Clean up expired admin sessions periodically"""
    while True:
        try:
            database.db.cleanup_admin_sessions()
            
        except Exception as e:
            logger.error(f"❌ Error cleaning sessions: {e}")
        
        # Run every 5 minutes
        await asyncio.sleep(300)

# Start cleanup tasks on startup
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_old_data())
    asyncio.create_task(cleanup_sessions())

# Serve static files
app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🚀 LIVE LOCATION TRACKER SERVER v3.0")
    print("="*60)
    print("📱 User Tracker:        http://localhost:8000")
    print("🔐 Admin Login:         http://localhost:8000/login.html")
    print("📊 Admin Dashboard:     http://localhost:8000/dashboard.html")
    print("🧪 Test Page:           http://localhost:8000/test.html")
    print("🔌 WebSocket:           ws://localhost:8000/ws")
    print("📈 System Stats:        http://localhost:8000/api/stats")
    print("❤️  Health Check:       http://localhost:8000/api/health")
    print("🛠️  API Test:           http://localhost:8000/api/test")
    print("="*60)
    print("🔐 Admin Credentials:")
    print(f"   Username: {config.ADMIN_USERNAME}")
    print(f"   Password: {config.ADMIN_PASSWORD}")
    print("="*60)
    print("⚠️  CHANGE DEFAULT PASSWORD IN PRODUCTION!")
    print("="*60 + "\n")
    
    uvicorn.run(
        app,
        host=config.HOST,
        port=config.PORT,
        reload=config.DEBUG,
        log_level="info"
    )