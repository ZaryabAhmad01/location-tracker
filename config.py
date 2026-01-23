import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Admin credentials
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "ZaryabAhmadAnsari")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "363610bhai")

# Security settings
SESSION_TIMEOUT = int(os.getenv("SESSION_TIMEOUT", 3600))  # 1 hour
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")

# Server settings
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))
DEBUG = os.getenv("DEBUG", "True").lower() == "true"