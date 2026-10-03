import os
import random
import string
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from livekit import api


# =========================================================
# CT VOICE
# =========================================================

APP_NAME = "CT Voice"
VERSION = "1.0.0"

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"

DB_FILE = BASE_DIR / "ct_voice.db"

# =========================================================
# SETTINGS
# =========================================================

PLAYER_TIMEOUT = 65          # اللاعب يعتبر داخل الماب إذا حدث موقعه خلال هذه المدة
POSITION_UPDATE_SECONDS = 30

CODE_LENGTH = 8
CODE_EXPIRE_SECONDS = 600    # الرمز صالح 10 دقائق
MAX_CODE_ATTEMPTS = 5

NO_COOLDOWN_SECONDS = 300    # رفض التفعيل = 5 دقائق

ROOM_NAME = "ct-voice"

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")


# =========================================================
# FASTAPI
# =========================================================

app = FastAPI(
    title=APP_NAME,
    version=VERSION
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DATABASE
# =========================================================

def db():
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    return con


def init_db():
    con = db()

    con.execute("""
        CREATE TABLE IF NOT EXISTS players (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            x REAL DEFAULT 0,
            y REAL DEFAULT 0,
            z REAL DEFAULT 0,
            last_seen TEXT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS verification (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            code TEXT,
            created_at TEXT,
            expires_at TEXT,
            attempts INTEGER DEFAULT 0,
            verified INTEGER DEFAULT 0,
            declined_until TEXT
        )
    """)

    con.commit()
    con.close()


init_db()


# =========================================================
# MODELS
# =========================================================

class RobloxPlayer(BaseModel):
    user_id: int
    username: str = ""
    x: float
    y: float
    z: float


class AuthRequest(BaseModel):
    username: str


class AuthVerify(BaseModel):
    username: str
    code: str


class VoiceRequest(BaseModel):
    user_id: int


# =========================================================
# HELPERS
# =========================================================

def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat()


def parse_time(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def generate_code():
    chars = string.ascii_uppercase + string.digits
    return "".join(random.SystemRandom().choice(chars) for _ in range(CODE_LENGTH))


def player_is_online(user_id: int):
    con = db()

    row = con.execute(
        "SELECT * FROM players WHERE user_id = ?",
        (user_id,)
    ).fetchone()

    con.close()

    if not row:
        return False

    last_seen = parse_time(row["last_seen"])

    if not last_seen:
        return False

    return (now() - last_seen).total_seconds() <= PLAYER_TIMEOUT


def get_roblox_user(username: str):
    try:
        response = requests.post(
            "https://users.roblox.com/v1/usernames/users",
            json={
                "usernames": [username],
                "excludeBannedUsers": False
            },
            timeout=10
        )

        if response.status_code != 200:
            return None

        data = response.json()

        users = data.get("data", [])

        if not users:
            return None

        return users[0]

    except Exception:
        return None


def get_verification(user_id: int):
    con = db()

    row = con.execute(
        "SELECT * FROM verification WHERE user_id = ?",
        (user_id,)
    ).fetchone()

    con.close()

    return row


def clear_verification(user_id: int):
    con = db()

    con.execute(
        "DELETE FROM verification WHERE user_id = ?",
        (user_id,)
    )

    con.commit()
    con.close()


# =========================================================
# HEALTH
# =========================================================

@app.get("/health")
def health():
    return {
        "status": "CT Voice Server Online",
        "version": VERSION
    }


# =========================================================
# ROBLOX POSITION
# =========================================================

@app.post("/roblox/player")
def update_player(player: RobloxPlayer):

    current_time = iso(now())

    con = db()

    con.execute("""
        INSERT INTO players (
            user_id,
            username,
            x,
            y,
            z,
            last_seen
        )
        VALUES (?, ?, ?, ?, ?, ?)

        ON CONFLICT(user_id)
        DO UPDATE SET
            username = excluded.username,
            x = excluded.x,
            y = excluded.y,
            z = excluded.z,
            last_seen = excluded.last_seen
    """, (
        player.user_id,
        player.username,
        player.x,
        player.y,
        player.z,
        current_time
    ))

    con.commit()
    con.close()

    return {
        "success": True
    }


# =========================================================
# ROBLOX PLAYER CHECK
# =========================================================

@app.get("/roblox/player/{user_id}")
def check_player(user_id: int):

    con = db()

    row = con.execute(
        "SELECT * FROM players WHERE user_id = ?",
        (user_id,)
    ).fetchone()

    con.close()

    if not row:
        return {
            "online": False
        }

    last_seen = parse_time(row["last_seen"])

    online = False

    if last_seen:
        online = (
            now() - last_seen
        ).total_seconds() <= PLAYER_TIMEOUT

    return {
        "online": online,
        "user_id": user_id,
        "username": row["username"] if online else None
    }


# =========================================================
# AUTH REQUEST
# =========================================================

@app.post("/auth/request")
def auth_request(data: AuthRequest):

    username = data.username.strip()

    if not username:
        return {
            "success": False,
            "status": "invalid_username",
            "message": "اكتب اسم حساب Roblox."
        }

    roblox_user = get_roblox_user(username)

    # -----------------------------------------------------
    # الحساب غير موجود
    # -----------------------------------------------------

    if not roblox_user:
        return {
            "success": False,
            "status": "account_not_found",
            "message": "لم يتم العثور على حساب Roblox بهذا الاسم."
        }

    user_id = int(roblox_user["id"])
    real_username = roblox_user["name"]

    # -----------------------------------------------------
    # اللاعب غير موجود داخل الماب
    # -----------------------------------------------------

    if not player_is_online(user_id):

        return {
            "success": False,
            "status": "not_in_game",
            "message": "الحساب موجود، لكن يجب أن تكون داخل سيرفر CT."
        }

    # -----------------------------------------------------
    # فحص رفض آخر
    # -----------------------------------------------------

    old = get_verification(user_id)

    if old and old["declined_until"]:

        declined_until = parse_time(old["declined_until"])

        if declined_until and now() < declined_until:

            remaining = int(
                (declined_until - now()).total_seconds()
            )

            return {
                "success": False,
                "status": "declined_cooldown",
                "remaining": remaining,
                "message": "لقد رفضت تفعيل المايك. حاول مرة أخرى بعد انتهاء المدة."
            }

    # -----------------------------------------------------
    # إنشاء جلسة تحقق جديدة
    # -----------------------------------------------------

    code = generate_code()

    created = now()
    expires = created + timedelta(seconds=CODE_EXPIRE_SECONDS)

    con = db()

    con.execute("""
        INSERT INTO verification (
            user_id,
            username,
            code,
            created_at,
            expires_at,
            attempts,
            verified,
            declined_until
        )
        VALUES (?, ?, ?, ?, ?, 0, 0, NULL)

        ON CONFLICT(user_id)
        DO UPDATE SET
            username = excluded.username,
            code = excluded.code,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at,
            attempts = 0,
            verified = 0,
            declined_until = NULL
    """, (
        user_id,
        real_username,
        code,
        iso(created),
        iso(expires)
    ))

    con.commit()
    con.close()

    return {
        "success": True,
        "status": "found",
        "user_id": user_id,
        "username": real_username,
        "message": "تم العثور على حسابك وأنت داخل السيرفر.",
        "ask_microphone": True
    }


# =========================================================
# DECLINE
# =========================================================

@app.post("/auth/decline")
def auth_decline(data: AuthRequest):

    username = data.username.strip()

    roblox_user = get_roblox_user(username)

    if not roblox_user:
        return {
            "success": False,
            "message": "الحساب غير موجود."
        }

    user_id = int(roblox_user["id"])

    declined_until = now() + timedelta(
        seconds=NO_COOLDOWN_SECONDS
    )

    con = db()

    con.execute("""
        INSERT INTO verification (
            user_id,
            username,
            code,
            created_at,
            expires_at,
            attempts,
            verified,
            declined_until
        )
        VALUES (?, ?, '', ?, ?, 0, 0, ?)

        ON CONFLICT(user_id)
        DO UPDATE SET
            code = '',
            attempts = 0,
            verified = 0,
            declined_until = excluded.declined_until
    """, (
        user_id,
        roblox_user["name"],
        iso(now()),
        iso(now()),
        iso(declined_until)
    ))

    con.commit()
    con.close()

    return {
        "success": True,
        "status": "declined",
        "message": "تم إلغاء التفعيل."
    }


# =========================================================
# VERIFY CODE
# =========================================================

@app.post("/auth/verify")
def auth_verify(data: AuthVerify):

    username = data.username.strip()
    code = data.code.strip().upper()

    roblox_user = get_roblox_user(username)

    if not roblox_user:
        return {
            "success": False,
            "message": "حساب Roblox غير موجود."
        }

    user_id = int(roblox_user["id"])

    row = get_verification(user_id)

    if not row:
        return {
            "success": False,
            "message": "لا توجد جلسة تحقق."
        }

    if row["verified"]:
        return {
            "success": True,
            "status": "verified",
            "message": "تم التحقق مسبقًا."
        }

    expires_at = parse_time(row["expires_at"])

    if not expires_at or now() > expires_at:

        clear_verification(user_id)

        return {
            "success": False,
            "status": "expired",
            "message": "انتهت صلاحية الرمز. اطلب رمزًا جديدًا."
        }

    # -----------------------------------------------------
    # التأكد أن اللاعب ما زال داخل الماب
    # -----------------------------------------------------

    if not player_is_online(user_id):

        clear_verification(user_id)

        return {
            "success": False,
            "status": "not_in_game",
            "message": "خرجت من سيرفر CT. يجب إعادة التحقق."
        }

    # -----------------------------------------------------
    # المحاولات
    # -----------------------------------------------------

    attempts = int(row["attempts"])

    if attempts >= MAX_CODE_ATTEMPTS:

        clear_verification(user_id)

        return {
            "success": False,
            "status": "too_many_attempts",
            "message": "تم تجاوز عدد المحاولات. اطلب رمزًا جديدًا."
        }

    # -----------------------------------------------------
    # الرمز خطأ
    # -----------------------------------------------------

    if code != row["code"]:

        con = db()

        con.execute("""
            UPDATE verification
            SET attempts = attempts + 1
            WHERE user_id = ?
        """, (user_id,))

        con.commit()
        con.close()

        remaining = MAX_CODE_ATTEMPTS - attempts - 1

        return {
            "success": False,
            "status": "wrong_code",
            "remaining_attempts": remaining,
            "message": "رمز التحقق غير صحيح."
        }

    # -----------------------------------------------------
    # نجاح التحقق
    # -----------------------------------------------------

    con = db()

    con.execute("""
        UPDATE verification
        SET verified = 1
        WHERE user_id = ?
    """, (user_id,))

    con.commit()
    con.close()

    return {
        "success": True,
        "status": "verified",
        "user_id": user_id,
        "username": roblox_user["name"],
        "message": "تم التحقق بنجاح."
    }


# =========================================================
# VERIFICATION STATUS
# =========================================================

@app.get("/auth/status/{user_id}")
def auth_status(user_id: int):

    row = get_verification(user_id)

    if not row:
        return {
            "verified": False
        }

    if not row["verified"]:
        return {
            "verified": False
        }

    # إذا خرج من الماب تنتهي الجلسة
    if not player_is_online(user_id):

        clear_verification(user_id)

        return {
            "verified": False,
            "status": "left_game"
        }

    return {
        "verified": True,
        "user_id": user_id,
        "username": row["username"]
    }


# =========================================================
# LIVEKIT TOKEN
# =========================================================

@app.post("/voice/token")
def voice_token(data: VoiceRequest):

    if not LIVEKIT_URL:
        raise HTTPException(
            status_code=500,
            detail="LIVEKIT_URL is not configured"
        )

    if not LIVEKIT_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="LIVEKIT_API_KEY is not configured"
        )

    if not LIVEKIT_API_SECRET:
        raise HTTPException(
            status_code=500,
            detail="LIVEKIT_API_SECRET is not configured"
        )

    row = get_verification(data.user_id)

    if not row or not row["verified"]:
        raise HTTPException(
            status_code=403,
            detail="Player is not verified"
        )

    if not player_is_online(data.user_id):
        clear_verification(data.user_id)

        raise HTTPException(
            status_code=403,
            detail="Player is not inside the game"
        )

    identity = str(data.user_id)

    token = (
        api.AccessToken(
            LIVEKIT_API_KEY,
            LIVEKIT_API_SECRET
        )
        .with_identity(identity)
        .with_name(row["username"])
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=ROOM_NAME,
                can_publish=True,
                can_subscribe=True
            )
        )
    )

    jwt_token = token.to_jwt()

    return {
        "success": True,
        "token": jwt_token,
        "url": LIVEKIT_URL,
        "room": ROOM_NAME
    }


# =========================================================
# STATIC WEBSITE
# =========================================================

if STATIC_DIR.exists():

    app.mount(
        "/static",
        StaticFiles(directory=str(STATIC_DIR)),
        name="static"
    )


@app.get("/")
def homepage():

    if INDEX_FILE.exists():
        return FileResponse(INDEX_FILE)

    return {
        "status": "CT Voice Server Online",
        "message": "static/index.html is missing"
    }
