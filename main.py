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
VERSION = "2.0.1"

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"

DB_FILE = BASE_DIR / "ct_voice.db"


# =========================================================
# SETTINGS
# =========================================================

PLAYER_TIMEOUT = 5
POSITION_UPDATE_SECONDS = 1

CODE_LENGTH = 8
CODE_EXPIRE_SECONDS = 600
MAX_CODE_ATTEMPTS = 5

NO_COOLDOWN_SECONDS = 300

ROOM_NAME = "ct-voice"

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

CT_OWNER_USER_ID = os.getenv("CT_OWNER_USER_ID", "")


# =========================================================
# ADMIN ROLE HIERARCHY
# =========================================================

ROLE_LEVELS = {
    "MODERATOR": 1,
    "ADMIN": 2,
    "CO-OWNER": 3,
    "OWNER": 4
}


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

    con.execute("""
        CREATE TABLE IF NOT EXISTS admin_roles (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            role TEXT NOT NULL,
            assigned_by INTEGER,
            created_at TEXT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS mutes (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            muted_until TEXT,
            muted_by INTEGER,
            reason TEXT,
            created_at TEXT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS voice_state (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            connected INTEGER DEFAULT 0,
            mic_enabled INTEGER DEFAULT 1,
            speaking INTEGER DEFAULT 0,
            updated_at TEXT
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


class VoiceStateRequest(BaseModel):
    user_id: int
    username: str = ""
    connected: bool = True
    mic_enabled: bool = True
    speaking: bool = False


class AdminActionRequest(BaseModel):
    admin_user_id: int
    target_user_id: int


class AdminMuteRequest(BaseModel):
    admin_user_id: int
    target_user_id: int
    duration_minutes: int
    reason: str = ""


class AdminRoleRequest(BaseModel):
    admin_user_id: int
    target_user_id: int
    role: str


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

    return "".join(
        random.SystemRandom().choice(chars)
        for _ in range(CODE_LENGTH)
    )


# =========================================================
# ROBLOX API
# =========================================================

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


# =========================================================
# PLAYER ONLINE
# =========================================================

def get_player(user_id: int):

    con = db()

    row = con.execute(
        "SELECT * FROM players WHERE user_id = ?",
        (user_id,)
    ).fetchone()

    con.close()

    return row


def player_is_online(user_id: int):

    row = get_player(user_id)

    if not row:
        return False

    last_seen = parse_time(row["last_seen"])

    if not last_seen:
        return False

    return (
        now() - last_seen
    ).total_seconds() <= PLAYER_TIMEOUT


# =========================================================
# VERIFICATION
# =========================================================

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
# MUTE HELPERS
# =========================================================

def get_mute(user_id: int):

    con = db()

    row = con.execute(
        "SELECT * FROM mutes WHERE user_id = ?",
        (user_id,)
    ).fetchone()

    con.close()

    if not row:
        return None

    muted_until = parse_time(row["muted_until"])

    if not muted_until:
        return None

    if now() >= muted_until:

        con = db()

        con.execute(
            "DELETE FROM mutes WHERE user_id = ?",
            (user_id,)
        )

        con.commit()
        con.close()

        return None

    return row


def is_muted(user_id: int):

    return get_mute(user_id) is not None


# =========================================================
# ADMIN HELPERS
# =========================================================

def get_admin_role(user_id: int):

    if CT_OWNER_USER_ID:

        try:

            if int(CT_OWNER_USER_ID) == int(user_id):
                return "OWNER"

        except Exception:
            pass

    con = db()

    row = con.execute(
        """
        SELECT role
        FROM admin_roles
        WHERE user_id = ?
        """,
        (user_id,)
    ).fetchone()

    con.close()

    if not row:
        return None

    return row["role"]


def admin_level(user_id: int):

    role = get_admin_role(user_id)

    if not role:
        return 0

    return ROLE_LEVELS.get(role, 0)


def can_manage(admin_user_id: int, target_user_id: int):

    admin_level_value = admin_level(admin_user_id)

    target_level_value = admin_level(target_user_id)

    if admin_level_value <= 0:
        return False

    if target_level_value >= admin_level_value:
        return False

    return True


def can_assign_role(admin_user_id: int, role: str):

    level = admin_level(admin_user_id)

    target_level = ROLE_LEVELS.get(role)

    if not target_level:
        return False

    if target_level >= ROLE_LEVELS["CO-OWNER"]:
        return level >= ROLE_LEVELS["OWNER"]

    return level > target_level


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
# DEBUG ROUTES
# =========================================================

@app.get("/debug/routes")
def debug_routes():

    routes = []

    for route in app.routes:

        path = getattr(route, "path", "")

        methods = list(
            getattr(route, "methods", []) or []
        )

        routes.append({
            "path": path,
            "methods": methods
        })

    roblox_player_endpoint = any(
        route["path"] == "/roblox/player"
        and "POST" in route["methods"]
        for route in routes
    )

    return {
        "success": True,
        "version": VERSION,
        "roblox_player_endpoint": roblox_player_endpoint,
        "routes": routes
    }


# =========================================================
# ROBLOX PLAYER UPDATE
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
        "success": True,
        "user_id": player.user_id,
        "username": player.username,
        "last_seen": current_time
    }


# =========================================================
# ROBLOX PLAYER LEAVE
# =========================================================

@app.post("/roblox/player/leave")
def player_leave(data: VoiceRequest):

    user_id = data.user_id

    con = db()

    con.execute(
        "DELETE FROM players WHERE user_id = ?",
        (user_id,)
    )

    con.execute(
        "DELETE FROM verification WHERE user_id = ?",
        (user_id,)
    )

    con.execute(
        "DELETE FROM voice_state WHERE user_id = ?",
        (user_id,)
    )

    con.commit()
    con.close()

    return {
        "success": True,
        "status": "left_game"
    }


# =========================================================
# PLAYER CHECK
# =========================================================

@app.get("/roblox/player/{user_id}")
def check_player(user_id: int):

    row = get_player(user_id)

    if not row:

        return {
            "online": False
        }

    online = player_is_online(user_id)

    return {
        "online": online,
        "user_id": user_id,
        "username": row["username"] if online else None,
        "x": row["x"] if online else None,
        "y": row["y"] if online else None,
        "z": row["z"] if online else None
    }


# =========================================================
# ROBLOX VERIFICATION
# =========================================================

@app.get("/roblox/verification/{user_id}")
def roblox_verification(user_id: int):

    row = get_verification(user_id)

    if not row:

        return {
            "active": False,
            "verified": False,
            "code": None
        }

    expires_at = parse_time(row["expires_at"])

    if (
        row["code"]
        and expires_at
        and now() > expires_at
    ):

        clear_verification(user_id)

        return {
            "active": False,
            "verified": False,
            "code": None
        }

    return {
        "active": True,
        "verified": bool(row["verified"]),
        "code": row["code"] if not row["verified"] else None,
        "username": row["username"]
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

    if not roblox_user:

        return {
            "success": False,
            "status": "account_not_found",
            "message": "لم يتم العثور على حساب Roblox بهذا الاسم."
        }

    user_id = int(roblox_user["id"])

    real_username = roblox_user["name"]

    if not player_is_online(user_id):

        return {
            "success": False,
            "status": "not_in_game",
            "message": "الحساب موجود، لكن يجب أن تكون داخل سيرفر CT."
        }

    old = get_verification(user_id)

    if old and old["declined_until"]:

        declined_until = parse_time(
            old["declined_until"]
        )

        if (
            declined_until
            and now() < declined_until
        ):

            remaining = int(
                (
                    declined_until - now()
                ).total_seconds()
            )

            return {
                "success": False,
                "status": "declined_cooldown",
                "remaining": remaining,
                "message": "لقد رفضت تفعيل المايك. حاول مرة أخرى بعد انتهاء المدة."
            }

    code = generate_code()

    created = now()

    expires = created + timedelta(
        seconds=CODE_EXPIRE_SECONDS
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
# DECLINE MICROPHONE
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

    current = now()

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
            username = excluded.username,
            code = '',
            created_at = excluded.created_at,
            expires_at = excluded.expires_at,
            attempts = 0,
            verified = 0,
            declined_until = excluded.declined_until
    """, (
        user_id,
        roblox_user["name"],
        iso(current),
        iso(current),
        iso(declined_until)
    ))

    con.commit()
    con.close()

    return {
        "success": True,
        "status": "declined"
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
            "user_id": user_id,
            "username": row["username"],
            "message": "تم التحقق مسبقًا."
        }

    expires_at = parse_time(row["expires_at"])

    if (
        not expires_at
        or now() > expires_at
    ):

        clear_verification(user_id)

        return {
            "success": False,
            "status": "expired",
            "message": "انتهت صلاحية الرمز. اطلب رمزًا جديدًا."
        }

    if not player_is_online(user_id):

        clear_verification(user_id)

        return {
            "success": False,
            "status": "not_in_game",
            "message": "خرجت من سيرفر CT. يجب إعادة التحقق."
        }

    attempts = int(row["attempts"])

    if attempts >= MAX_CODE_ATTEMPTS:

        clear_verification(user_id)

        return {
            "success": False,
            "status": "too_many_attempts",
            "message": "تم تجاوز عدد المحاولات. اطلب رمزًا جديدًا."
        }

    if code != row["code"]:

        con = db()

        con.execute("""
            UPDATE verification
            SET attempts = attempts + 1
            WHERE user_id = ?
        """, (user_id,))

        con.commit()
        con.close()

        remaining = (
            MAX_CODE_ATTEMPTS
            - attempts
            - 1
        )

        return {
            "success": False,
            "status": "wrong_code",
            "remaining_attempts": remaining,
            "message": "رمز التحقق غير صحيح."
        }

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
# AUTH STATUS
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
# VOICE STATE
# =========================================================

@app.post("/voice/state")
def update_voice_state(data: VoiceStateRequest):

    if not player_is_online(data.user_id):

        return {
            "success": False,
            "status": "not_in_game"
        }

    muted = is_muted(data.user_id)

    mic_enabled = (
        data.mic_enabled
        and not muted
    )

    con = db()

    con.execute("""
        INSERT INTO voice_state (
            user_id,
            username,
            connected,
            mic_enabled,
            speaking,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)

        ON CONFLICT(user_id)
        DO UPDATE SET
            username = excluded.username,
            connected = excluded.connected,
            mic_enabled = excluded.mic_enabled,
            speaking = excluded.speaking,
            updated_at = excluded.updated_at
    """, (
        data.user_id,
        data.username,
        int(data.connected),
        int(mic_enabled),
        int(data.speaking),
        iso(now())
    ))

    con.commit()
    con.close()

    return {
        "success": True,
        "mic_enabled": mic_enabled,
        "muted": muted
    }


# =========================================================
# VOICE STATE CHECK
# =========================================================

@app.get("/voice/state/{user_id}")
def voice_state(user_id: int):

    row = get_verification(user_id)

    if not row or not row["verified"]:

        return {
            "connected": False,
            "mic_enabled": False
        }

    muted = is_muted(user_id)

    con = db()

    state = con.execute(
        """
        SELECT *
        FROM voice_state
        WHERE user_id = ?
        """,
        (user_id,)
    ).fetchone()

    con.close()

    if not state:

        return {
            "connected": False,
            "mic_enabled": not muted,
            "muted": muted
        }

    return {
        "connected": bool(state["connected"]),
        "mic_enabled": bool(state["mic_enabled"]) and not muted,
        "speaking": bool(state["speaking"]),
        "muted": muted
    }


# =========================================================
# VOICE PLAYERS
# =========================================================

@app.get("/voice/players/{user_id}")
def voice_players(user_id: int):

    row = get_verification(user_id)

    if not row or not row["verified"]:

        raise HTTPException(
            status_code=403,
            detail="Player is not verified"
        )

    con = db()

    players = con.execute("""
        SELECT
            p.user_id,
            p.username,
            p.x,
            p.y,
            p.z,
            v.connected,
            v.mic_enabled,
            v.speaking
        FROM players p
        INNER JOIN verification ver
            ON ver.user_id = p.user_id
            AND ver.verified = 1
        LEFT JOIN voice_state v
            ON v.user_id = p.user_id
        WHERE p.last_seen IS NOT NULL
    """).fetchall()

    con.close()

    result = []

    for player in players:

        if not player_is_online(player["user_id"]):
            continue

        muted = is_muted(player["user_id"])

        result.append({
            "user_id": player["user_id"],
            "username": player["username"],
            "x": player["x"],
            "y": player["y"],
            "z": player["z"],
            "connected": (
                bool(player["connected"])
                if player["connected"] is not None
                else False
            ),
            "mic_enabled": (
                bool(player["mic_enabled"])
                and not muted
            ),
            "speaking": (
                bool(player["speaking"])
                and not muted
            ),
            "muted": muted
        })

    return {
        "success": True,
        "players": result
    }


# =========================================================
# LEAVE VOICE
# =========================================================

@app.post("/voice/leave")
def voice_leave(data: VoiceRequest):

    con = db()

    con.execute(
        "DELETE FROM voice_state WHERE user_id = ?",
        (data.user_id,)
    )

    con.commit()
    con.close()

    return {
        "success": True
    }


# =========================================================
# ADMIN STATUS
# =========================================================

@app.get("/admin/status/{user_id}")
def admin_status(user_id: int):

    role = get_admin_role(user_id)

    return {
        "success": True,
        "is_admin": role is not None,
        "role": role,
        "level": ROLE_LEVELS.get(role, 0)
    }


# =========================================================
# ADMIN PLAYERS
# =========================================================

@app.get("/admin/players/{admin_user_id}")
def admin_players(admin_user_id: int):

    role = get_admin_role(admin_user_id)

    if not role:

        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    con = db()

    players = con.execute("""
        SELECT
            p.user_id,
            p.username,
            p.x,
            p.y,
            p.z,
            p.last_seen,
            v.connected,
            v.mic_enabled,
            v.speaking,
            a.role AS admin_role
        FROM players p
        LEFT JOIN voice_state v
            ON v.user_id = p.user_id
        LEFT JOIN admin_roles a
            ON a.user_id = p.user_id
    """).fetchall()

    con.close()

    result = []

    for player in players:

        if not player_is_online(player["user_id"]):
            continue

        mute = get_mute(player["user_id"])

        result.append({
            "user_id": player["user_id"],
            "username": player["username"],
            "x": player["x"],
            "y": player["y"],
            "z": player["z"],
            "connected": (
                bool(player["connected"])
                if player["connected"] is not None
                else False
            ),
            "mic_enabled": (
                bool(player["mic_enabled"])
                if player["mic_enabled"] is not None
                else False
            ),
            "speaking": (
                bool(player["speaking"])
                if player["speaking"] is not None
                else False
            ),
            "muted": mute is not None,
            "muted_until": (
                mute["muted_until"]
                if mute else None
            ),
            "admin_role": player["admin_role"]
        })

    return {
        "success": True,
        "role": role,
        "players": result
    }


# =========================================================
# ADMIN MUTE
# =========================================================

@app.post("/admin/mute")
def admin_mute(data: AdminMuteRequest):

    if not can_manage(
        data.admin_user_id,
        data.target_user_id
    ):

        raise HTTPException(
            status_code=403,
            detail="You cannot manage this player"
        )

    allowed_durations = {
        5,
        15,
        30,
        60,
        300,
        720
    }

    if data.duration_minutes not in allowed_durations:

        raise HTTPException(
            status_code=400,
            detail="Invalid mute duration"
        )

    target = get_player(data.target_user_id)

    username = (
        target["username"]
        if target
        else str(data.target_user_id)
    )

    muted_until = (
        now()
        + timedelta(
            minutes=data.duration_minutes
        )
    )

    con = db()

    con.execute("""
        INSERT INTO mutes (
            user_id,
            username,
            muted_until,
            muted_by,
            reason,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)

        ON CONFLICT(user_id)
        DO UPDATE SET
            username = excluded.username,
            muted_until = excluded.muted_until,
            muted_by = excluded.muted_by,
            reason = excluded.reason,
            created_at = excluded.created_at
    """, (
        data.target_user_id,
        username,
        iso(muted_until),
        data.admin_user_id,
        data.reason,
        iso(now())
    ))

    con.execute("""
        UPDATE voice_state
        SET mic_enabled = 0,
            speaking = 0,
            updated_at = ?
        WHERE user_id = ?
    """, (
        iso(now()),
        data.target_user_id
    ))

    con.commit()
    con.close()

    return {
        "success": True,
        "muted_until": iso(muted_until)
    }


# =========================================================
# ADMIN UNMUTE
# =========================================================

@app.post("/admin/unmute")
def admin_unmute(data: AdminActionRequest):

    if not can_manage(
        data.admin_user_id,
        data.target_user_id
    ):

        raise HTTPException(
            status_code=403,
            detail="You cannot manage this player"
        )

    con = db()

    con.execute(
        "DELETE FROM mutes WHERE user_id = ?",
        (data.target_user_id,)
    )

    con.commit()
    con.close()

    return {
        "success": True
    }


# =========================================================
# GIVE ADMIN ROLE
# =========================================================

@app.post("/admin/role/give")
def give_admin_role(data: AdminRoleRequest):

    role = data.role.strip().upper()

    if role not in ROLE_LEVELS:

        raise HTTPException(
            status_code=400,
            detail="Invalid role"
        )

    if not can_assign_role(
        data.admin_user_id,
        role
    ):

        raise HTTPException(
            status_code=403,
            detail="You cannot assign this role"
        )

    if (
        CT_OWNER_USER_ID
        and str(data.target_user_id)
        == str(CT_OWNER_USER_ID)
    ):

        raise HTTPException(
            status_code=403,
            detail="The main owner cannot be changed"
        )

    target = get_player(data.target_user_id)

    username = (
        target["username"]
        if target
        else str(data.target_user_id)
    )

    con = db()

    con.execute("""
        INSERT INTO admin_roles (
            user_id,
            username,
            role,
            assigned_by,
            created_at
        )
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(user_id)
        DO UPDATE SET
            username = excluded.username,
            role = excluded.role,
            assigned_by = excluded.assigned_by,
            created_at = excluded.created_at
    """, (
        data.target_user_id,
        username,
        role,
        data.admin_user_id,
        iso(now())
    ))

    con.commit()
    con.close()

    return {
        "success": True,
        "user_id": data.target_user_id,
        "role": role
    }


# =========================================================
# REMOVE ADMIN ROLE
# =========================================================

@app.post("/admin/role/remove")
def remove_admin_role(data: AdminActionRequest):

    if not can_manage(
        data.admin_user_id,
        data.target_user_id
    ):

        raise HTTPException(
            status_code=403,
            detail="You cannot remove this role"
        )

    if (
        CT_OWNER_USER_ID
        and str(data.target_user_id)
        == str(CT_OWNER_USER_ID)
    ):

        raise HTTPException(
            status_code=403,
            detail="The main owner cannot be removed"
        )

    con = db()

    con.execute(
        "DELETE FROM admin_roles WHERE user_id = ?",
        (data.target_user_id,)
    )

    con.commit()
    con.close()

    return {
        "success": True
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

    muted = is_muted(data.user_id)

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
                can_publish=not muted,
                can_subscribe=True
            )
        )
    )

    jwt_token = token.to_jwt()

    return {
        "success": True,
        "token": jwt_token,
        "url": LIVEKIT_URL,
        "room": ROOM_NAME,
        "muted": muted
    }


# =========================================================
# STATIC WEBSITE
# =========================================================

if STATIC_DIR.exists():

    app.mount(
        "/static",
        StaticFiles(
            directory=str(STATIC_DIR)
        ),
        name="static"
    )


@app.get("/")
def homepage():

    if INDEX_FILE.exists():

        return FileResponse(
            INDEX_FILE
        )

    return {
        "status": "CT Voice Server Online",
        "message": "static/index.html is missing"
    }
