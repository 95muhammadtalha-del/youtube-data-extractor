import os
import urllib.parse
import logging
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv, set_key

from youtube_service import YouTubeService
from excel_exporter import create_excel
import re

# load_dotenv is called after BASE_DIR resolution below

logger = logging.getLogger(__name__)

app = FastAPI(title="YouTube Channel Data Extraction API")

# Allow all origins for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve the project directory.
# DO NOT use __file__ — it resolves to AutoTube's bundled Python path.
# Instead, rely on the current working directory (start.bat always cd's to the project folder)
# with a hardcoded fallback as safety net.
from pathlib import Path

_PROJECT_DIR = Path(r"c:\Users\DawoodMehmood\Desktop\YouTube Channels Data extraction")

# Use cwd if it has our files, otherwise use the hardcoded project path
if (Path.cwd() / 'static' / 'index.html').exists():
    BASE_DIR = Path.cwd()
elif _PROJECT_DIR.exists() and (_PROJECT_DIR / 'static' / 'index.html').exists():
    BASE_DIR = _PROJECT_DIR
else:
    BASE_DIR = Path.cwd()

static_dir = str(BASE_DIR / 'static')
os.makedirs(static_dir, exist_ok=True)

print(f"[YouTube Data Extractor] Project dir: {BASE_DIR}")
print(f"[YouTube Data Extractor] Static dir:  {static_dir}")

# Ensure .env is loaded from the project directory
load_dotenv(BASE_DIR / '.env')

app.mount("/static", StaticFiles(directory=static_dir), name="static")

# In-memory API key storage (persists during server session)
# Priority: UI-provided key > .env key
_stored_api_key: Optional[str] = None


class ExtractRequest(BaseModel):
    query: str


class ExportRequest(BaseModel):
    data: list


class ApiKeyRequest(BaseModel):
    api_key: str


def get_api_key() -> str:
    """Returns the active API key: UI-stored key takes priority over .env key."""
    key = _stored_api_key or os.getenv('YOUTUBE_API_KEY')
    if not key:
        raise HTTPException(
            status_code=400,
            detail="No API key configured. Please set your YouTube API key in Settings."
        )
    return key


def get_youtube_service() -> YouTubeService:
    """Creates a YouTubeService instance with the current API key."""
    return YouTubeService(api_key=get_api_key())


@app.get("/")
async def root():
    index_path = os.path.join(static_dir, 'index.html')
    return FileResponse(index_path)


@app.post("/api/set-key")
async def set_api_key(request: ApiKeyRequest):
    """Stores the API key permanently in the .env file."""
    global _stored_api_key
    key = request.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")
    
    _stored_api_key = key
    env_path = BASE_DIR / '.env'
    
    try:
        # Create .env if it doesn't exist
        if not env_path.exists():
            env_path.touch()
        set_key(str(env_path), 'YOUTUBE_API_KEY', key)
    except Exception as e:
        logger.error(f"Error saving to .env: {e}")
        
    return {"status": "ok", "message": "API key saved permanently"}


@app.post("/api/test-key")
async def test_api_key(request: ApiKeyRequest):
    """Tests a YouTube API key by making a simple API call, and saves it permanently if valid."""
    key = request.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")
        
    try:
        service = YouTubeService(api_key=key)
        # Make a lightweight API call to verify the key works
        response = service.youtube.channels().list(
            part='snippet',
            id='UC_x5XG1OV2P6uZZ5FSM9Ttw'  # Google Developers channel (always exists)
        ).execute()
        if response.get('items'):
            # Key works — store it permanently
            global _stored_api_key
            _stored_api_key = key
            env_path = BASE_DIR / '.env'
            try:
                if not env_path.exists():
                    env_path.touch()
                set_key(str(env_path), 'YOUTUBE_API_KEY', key)
            except Exception as e:
                logger.error(f"Error saving to .env: {e}")
                
            return {
                "status": "ok",
                "message": "✅ API key is valid! Connected to YouTube Data API successfully and saved permanently."
            }
        else:
            raise HTTPException(status_code=400, detail="API key returned no results. It may be invalid.")
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if 'forbidden' in error_msg.lower() or 'accessNotConfigured' in error_msg.lower():
            raise HTTPException(
                status_code=403,
                detail="❌ API key is valid but YouTube Data API v3 is not enabled. "
                       "Please enable it in Google Cloud Console."
            )
        elif 'invalid' in error_msg.lower() or 'badRequest' in error_msg.lower():
            raise HTTPException(status_code=400, detail="❌ Invalid API key. Please check and try again.")
        else:
            raise HTTPException(status_code=400, detail=f"❌ API key test failed: {error_msg}")


@app.get("/api/key-status")
async def key_status():
    """Check if an API key is currently configured."""
    key = _stored_api_key or os.getenv('YOUTUBE_API_KEY')
    if key:
        # Mask the key for display
        masked = key[:4] + '•' * (len(key) - 8) + key[-4:]
        return {"has_key": True, "masked_key": masked}
    return {"has_key": False, "masked_key": None}


@app.post("/api/extract")
async def extract_data(request: ExtractRequest):
    api_key = get_api_key()
    
    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")
        
    yt = YouTubeService(api_key=api_key)
    
    queries = [q.strip() for q in request.query.split(',') if q.strip()]
    if not queries:
        raise HTTPException(status_code=400, detail="Valid query is required")
        
    if len(queries) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 channels allowed per request")

    results = []
    try:
        for q in queries:
            try:
                data = yt.extract_channel_data(q)
                results.append(data)
            except Exception as e:
                # If one fails in a batch, log it but continue if others exist
                logger.error(f"Failed to extract {q}: {e}")
                if len(queries) == 1:
                    raise e
                    
        if not results:
            raise Exception("Failed to extract data for any of the requested channels.")
            
        return {"status": "success", "data": results}
    except Exception as e:
        logger.error(f"Extraction error: {e}")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


@app.post("/api/export-excel")
async def export_excel(request: ExportRequest):
    """Generates a styled Excel file from extracted channel data."""
    try:
        data_list = request.data
        if not isinstance(data_list, list) or len(data_list) == 0:
            raise HTTPException(status_code=400, detail="Invalid data format")

        excel_file = create_excel(data_list)

        if len(data_list) == 1:
            channel_name = data_list[0].get('channel', {}).get('name', 'Channel')
            safe_name = "".join([c for c in channel_name if c.isalpha() or c.isdigit() or c == ' ']).rstrip()
            filename = f"YouTube_{safe_name}_Data.xlsx".replace(" ", "_")
        else:
            filename = f"YouTube_MultiChannel_Comparison.xlsx"

        # Properly encode filename for headers
        encoded_filename = urllib.parse.quote(filename)

        headers = {
            'Content-Disposition': f'attachment; filename="{encoded_filename}"'
        }

        return StreamingResponse(
            excel_file,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Excel export error: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating Excel file: {str(e)}")


class DownloadRequest(BaseModel):
    data: dict

download_logs = []

def add_log(msg: str):
    import datetime
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    formatted = f"[{ts}] {msg}"
    download_logs.append(formatted)
    if len(download_logs) > 150:
        download_logs.pop(0)
    logger.info(msg)

@app.get("/api/download-logs")
async def get_download_logs():
    return {"logs": download_logs}

class CookiesRequest(BaseModel):
    cookies: str

@app.post("/api/set-cookies")
async def set_cookies(req: CookiesRequest):
    cookie_file = BASE_DIR / 'cookies.txt'
    try:
        with open(cookie_file, 'w', encoding='utf-8') as f:
            f.write(req.cookies)
        return {"message": "Cookies saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/get-cookies")
async def get_cookies():
    cookie_file = BASE_DIR / 'cookies.txt'
    if cookie_file.exists():
        with open(cookie_file, 'r', encoding='utf-8') as f:
            return {"cookies": f.read()}
    return {"cookies": ""}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=9000, reload=True)
