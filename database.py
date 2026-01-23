import sqlite3
from datetime import datetime, timedelta
import json
import os
from typing import Dict, List, Optional
import secrets

class Database:
    def __init__(self):
        self.db_path = "location_data.db"
        self.init_db()
    
    def get_connection(self):
        """Get database connection"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def init_db(self):
        """Initialize database tables"""
        conn = self.get_connection()
        c = conn.cursor()
        
        # Admin sessions table
        c.execute('''
            CREATE TABLE IF NOT EXISTS admin_sessions (
                session_id TEXT PRIMARY KEY,
                username TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address TEXT,
                user_agent TEXT
            )
        ''')
        
        # Users table
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_online INTEGER DEFAULT 0,
                battery INTEGER DEFAULT 100,
                total_points INTEGER DEFAULT 0,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                device_info TEXT,
                is_active INTEGER DEFAULT 1
            )
        ''')
        
        # Locations table
        c.execute('''
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                lat REAL,
                lng REAL,
                speed REAL DEFAULT 0,
                activity TEXT DEFAULT 'Unknown',
                accuracy REAL DEFAULT 0,
                battery INTEGER DEFAULT 100,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                geohash TEXT,
                place_category TEXT,
                FOREIGN KEY (username) REFERENCES users(username)
            )
        ''')
        
        # User sessions table
        c.execute('''
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP,
                total_points INTEGER DEFAULT 0,
                avg_speed REAL DEFAULT 0
            )
        ''')
        
        # Daily summary table
        c.execute('''
            CREATE TABLE IF NOT EXISTS daily_summary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                date DATE,
                total_points INTEGER DEFAULT 0,
                avg_speed REAL DEFAULT 0,
                total_distance REAL DEFAULT 0,
                active_hours INTEGER DEFAULT 0,
                top_activity TEXT
            )
        ''')
        
        # Create indexes
        c.execute('CREATE INDEX IF NOT EXISTS idx_username ON locations(username)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_created_at ON locations(created_at)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_user_online ON users(is_online, last_seen)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_geohash ON locations(geohash)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_daily_summary ON daily_summary(username, date)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_admin_sessions ON admin_sessions(session_id)')
        
        conn.commit()
        conn.close()
        print("✅ Database initialized successfully")
    
    # ... [Keep all the previous database methods from your original code] ...
    # Add these methods to your existing Database class:

    def create_admin_session(self, username: str, ip_address: str, user_agent: str) -> str:
        """Create a new admin session"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            session_id = secrets.token_urlsafe(32)
            now = datetime.now()
            
            c.execute('''
                INSERT INTO admin_sessions (session_id, username, created_at, last_activity, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (session_id, username, now, now, ip_address, user_agent))
            
            conn.commit()
            conn.close()
            
            return session_id
            
        except Exception as e:
            print(f"❌ Error creating admin session: {e}")
            return None
    
    def validate_admin_session(self, session_id: str) -> bool:
        """Validate admin session"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            c.execute('''
                SELECT session_id FROM admin_sessions 
                WHERE session_id = ? AND 
                      last_activity > datetime('now', '-1 hour')
            ''', (session_id,))
            
            result = c.fetchone()
            conn.close()
            
            return result is not None
            
        except Exception as e:
            print(f"❌ Error validating admin session: {e}")
            return False
    
    def update_admin_session(self, session_id: str):
        """Update session last activity"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            c.execute('''
                UPDATE admin_sessions 
                SET last_activity = CURRENT_TIMESTAMP 
                WHERE session_id = ?
            ''', (session_id,))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            print(f"❌ Error updating admin session: {e}")
    
    def delete_admin_session(self, session_id: str):
        """Delete admin session"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            c.execute('DELETE FROM admin_sessions WHERE session_id = ?', (session_id,))
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            print(f"❌ Error deleting admin session: {e}")
    
    def cleanup_admin_sessions(self):
        """Clean up expired admin sessions"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            c.execute('''
                DELETE FROM admin_sessions 
                WHERE last_activity < datetime('now', '-1 hour')
            ''')
            
            deleted = c.rowcount
            if deleted > 0:
                print(f"🧹 Cleaned up {deleted} expired admin sessions")
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            print(f"❌ Error cleaning admin sessions: {e}")

    # Keep all your existing methods (calculate_geohash, add_location, get_users, etc.)
    # Make sure to include all the methods from your original database.py

    def calculate_geohash(self, lat: float, lng: float, precision: float = 0.001) -> str:
        """Calculate simple geohash for grouping nearby locations"""
        lat_grid = int(lat / precision)
        lng_grid = int(lng / precision)
        return f"{lat_grid}:{lng_grid}"
    
    def categorize_place(self, lat: float, lng: float) -> str:
        """Categorize location type (simplified)"""
        return "Unknown"
    
    def add_location(self, username: str, lat: float, lng: float, speed: float = 0, 
                     activity: str = "Unknown", accuracy: float = 0, battery: int = 100,
                     device_info: str = None) -> bool:
        """Save location data"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            now = datetime.now()
            geohash = self.calculate_geohash(lat, lng)
            place_category = self.categorize_place(lat, lng)
            
            # Check/create user
            c.execute('SELECT username FROM users WHERE username = ?', (username,))
            user = c.fetchone()
            
            if not user:
                # Create new user
                c.execute('''
                    INSERT INTO users (username, last_seen, is_online, battery, total_points, 
                                     first_seen, device_info, is_active) 
                    VALUES (?, ?, 1, ?, 1, ?, ?, 1)
                ''', (username, now, battery, now, device_info))
                print(f"👤 New user created: {username}")
            else:
                # Update existing user
                c.execute('''
                    UPDATE users 
                    SET last_seen = ?, is_online = 1, battery = ?, total_points = total_points + 1,
                        device_info = COALESCE(?, device_info)
                    WHERE username = ?
                ''', (now, battery, device_info, username))
            
            # Save location
            c.execute('''
                INSERT INTO locations (username, lat, lng, speed, activity, accuracy, 
                                      battery, geohash, place_category, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (username, lat, lng, speed, activity, accuracy, battery, geohash, place_category, now))
            
            # Update or create current session
            c.execute('''
                SELECT id FROM user_sessions 
                WHERE username = ? AND end_time IS NULL
                ORDER BY start_time DESC LIMIT 1
            ''', (username,))
            
            session = c.fetchone()
            if session:
                # Update existing session
                c.execute('''
                    UPDATE user_sessions 
                    SET end_time = ?, total_points = total_points + 1,
                        avg_speed = ((avg_speed * (total_points - 1)) + ?) / (total_points + 1)
                    WHERE id = ?
                ''', (now, speed, session['id']))
            else:
                # Start new session
                c.execute('''
                    INSERT INTO user_sessions (username, start_time, total_points, avg_speed)
                    VALUES (?, ?, 1, ?)
                ''', (username, now, speed))
            
            # Update daily summary
            today = now.date()
            c.execute('''
                SELECT id FROM daily_summary 
                WHERE username = ? AND date = ?
            ''', (username, today))
            
            daily = c.fetchone()
            if daily:
                c.execute('''
                    UPDATE daily_summary 
                    SET total_points = total_points + 1,
                        avg_speed = ((avg_speed * (total_points - 1)) + ?) / total_points,
                        top_activity = ?
                    WHERE id = ?
                ''', (speed, activity, daily['id']))
            else:
                c.execute('''
                    INSERT INTO daily_summary (username, date, total_points, avg_speed, top_activity)
                    VALUES (?, ?, 1, ?, ?)
                ''', (username, today, speed, activity))
            
            conn.commit()
            conn.close()
            
            print(f"✅ Location saved: {username} at {lat:.6f}, {lng:.6f}")
            return True
            
        except Exception as e:
            print(f"❌ ERROR in add_location: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def get_users(self, minutes_offline: int = 5) -> Dict:
        """Get all users with their latest data"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            # Mark users as offline if last_seen > threshold
            offline_threshold = datetime.now() - timedelta(minutes=minutes_offline)
            c.execute('''
                UPDATE users 
                SET is_online = 0 
                WHERE last_seen < ? AND is_online = 1
            ''', (offline_threshold.isoformat(),))
            
            # Get all active users with latest location
            query = '''
                SELECT 
                    u.username,
                    u.last_seen,
                    u.is_online,
                    u.battery,
                    u.total_points,
                    u.first_seen,
                    l.lat,
                    l.lng,
                    l.speed,
                    l.activity,
                    l.accuracy,
                    l.created_at as location_time,
                    (SELECT COUNT(*) FROM locations WHERE username = u.username) as total_locations
                FROM users u
                LEFT JOIN (
                    SELECT username, MAX(created_at) as max_time
                    FROM locations 
                    GROUP BY username
                ) latest ON u.username = latest.username
                LEFT JOIN locations l ON u.username = l.username AND l.created_at = latest.max_time
                WHERE u.is_active = 1
                ORDER BY u.is_online DESC, u.last_seen DESC
            '''
            
            c.execute(query)
            rows = c.fetchall()
            
            users = {}
            for row in rows:
                users[row['username']] = {
                    "last_seen": row['last_seen'],
                    "online": bool(row['is_online']),
                    "battery": row['battery'] or 100,
                    "lat": row['lat'],
                    "lng": row['lng'],
                    "speed": row['speed'] or 0,
                    "activity": row['activity'] or "Unknown",
                    "accuracy": row['accuracy'] or 0,
                    "total_points": row['total_points'] or 0,
                    "first_seen": row['first_seen'],
                    "total_locations": row['total_locations'] or 0,
                    "last_location_time": row['location_time']
                }
            
            conn.commit()
            conn.close()
            
            print(f"👥 Retrieved {len(users)} users")
            return users
            
        except Exception as e:
            print(f"❌ Error getting users: {e}")
            return {}
    
    def get_user_details(self, username: str) -> Optional[Dict]:
        """Get detailed user information"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            c.execute('''
                SELECT username, last_seen, is_online, battery, total_points, 
                       first_seen, device_info
                FROM users 
                WHERE username = ? AND is_active = 1
            ''', (username,))
            
            row = c.fetchone()
            if not row:
                return None
            
            user = dict(row)
            
            # Get last 10 locations
            c.execute('''
                SELECT lat, lng, activity, created_at, speed, accuracy, battery
                FROM locations 
                WHERE username = ? 
                ORDER BY created_at DESC 
                LIMIT 10
            ''', (username,))
            
            recent_locations = []
            for loc in c.fetchall():
                recent_locations.append(dict(loc))
            
            # Get daily summary for last 7 days
            c.execute('''
                SELECT date, total_points, avg_speed, top_activity
                FROM daily_summary 
                WHERE username = ? 
                ORDER BY date DESC 
                LIMIT 7
            ''', (username,))
            
            weekly_summary = []
            for day in c.fetchall():
                weekly_summary.append(dict(day))
            
            # Get top 3 places (geohash groups)
            c.execute('''
                SELECT geohash, COUNT(*) as visits, 
                       AVG(lat) as avg_lat, AVG(lng) as avg_lng,
                       MIN(created_at) as first_visit, MAX(created_at) as last_visit
                FROM locations 
                WHERE username = ? 
                GROUP BY geohash 
                HAVING COUNT(*) > 1
                ORDER BY visits DESC 
                LIMIT 3
            ''', (username,))
            
            top_places = []
            for place in c.fetchall():
                top_places.append(dict(place))
            
            conn.close()
            
            return {
                **user,
                "recent_locations": recent_locations,
                "weekly_summary": weekly_summary,
                "top_places": top_places
            }
            
        except Exception as e:
            print(f"❌ Error getting user details: {e}")
            return None
    
    def get_user_history(self, username: str, hours: int = 24, limit: int = 500) -> List[Dict]:
        """Get user's location history"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            time_threshold = datetime.now() - timedelta(hours=hours)
            
            c.execute('''
                SELECT lat, lng, activity, created_at, accuracy, speed, battery, geohash
                FROM locations 
                WHERE username = ? AND created_at > ?
                ORDER BY created_at DESC
                LIMIT ?
            ''', (username, time_threshold.isoformat(), limit))
            
            locations = []
            for row in c.fetchall():
                locations.append(dict(row))
            
            conn.close()
            return locations
            
        except Exception as e:
            print(f"❌ Error getting history: {e}")
            return []
    
    def get_user_daily_stats(self, username: str, days: int = 30) -> List[Dict]:
        """Get daily statistics for a user"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            start_date = (datetime.now() - timedelta(days=days)).date()
            
            # Get from daily_summary table if available
            c.execute('''
                SELECT date, total_points, avg_speed, top_activity
                FROM daily_summary 
                WHERE username = ? AND date >= ?
                ORDER BY date DESC
            ''', (username, start_date))
            
            stats = []
            for row in c.fetchall():
                stats.append(dict(row))
            
            conn.close()
            return stats
            
        except Exception as e:
            print(f"❌ Error getting daily stats: {e}")
            return []
    
    def delete_user(self, username: str) -> bool:
        """Soft delete user (mark as inactive)"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            # Mark user as inactive instead of deleting
            c.execute('UPDATE users SET is_active = 0 WHERE username = ?', (username,))
            
            # Note: We don't delete location data to preserve history
            # If you want to delete all data, uncomment below:
            # c.execute('DELETE FROM locations WHERE username = ?', (username,))
            # c.execute('DELETE FROM user_sessions WHERE username = ?', (username,))
            # c.execute('DELETE FROM daily_summary WHERE username = ?', (username,))
            
            conn.commit()
            conn.close()
            
            print(f"🗑️ User marked as inactive: {username}")
            return True
            
        except Exception as e:
            print(f"❌ Error deleting user: {e}")
            return False
    
    def get_system_stats(self) -> Dict:
        """Get system-wide statistics"""
        try:
            conn = self.get_connection()
            c = conn.cursor()
            
            c.execute('SELECT COUNT(*) as total FROM users WHERE is_active = 1')
            total_users = c.fetchone()['total']
            
            c.execute('SELECT COUNT(*) as online FROM users WHERE is_online = 1')
            online_users = c.fetchone()['online']
            
            c.execute('SELECT COUNT(*) as locations FROM locations')
            total_locations = c.fetchone()['locations']
            
            c.execute('SELECT COUNT(DISTINCT DATE(created_at)) as days FROM locations')
            active_days = c.fetchone()['days']
            
            c.execute('SELECT username, total_points FROM users WHERE is_active = 1 ORDER BY total_points DESC LIMIT 5')
            top_users = [dict(row) for row in c.fetchall()]
            
            c.execute('SELECT activity, COUNT(*) as count FROM locations GROUP BY activity ORDER BY count DESC LIMIT 5')
            top_activities = [dict(row) for row in c.fetchall()]
            
            conn.close()
            
            return {
                "total_users": total_users,
                "online_users": online_users,
                "total_locations": total_locations,
                "active_days": active_days,
                "top_users": top_users,
                "top_activities": top_activities
            }
            
        except Exception as e:
            print(f"❌ Error getting system stats: {e}")
            return {}

# Create global database instance
db = Database()