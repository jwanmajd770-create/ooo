from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from RtcTokenBuilder2 import RtcTokenBuilder, Role_Publisher
import os
import logging
import random
import string
import zlib
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timezone
import time

from questions import CATEGORIES, QUESTIONS
from image_questions import IMAGE_QUESTIONS, QUOTE_QUESTIONS
from stats import save_game_result, get_hall_of_fame, get_recent_games

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Make mongo client optional so tests can import server without env
mongo_url = os.environ.get('MONGO_URL')
if mongo_url:
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ.get('DB_NAME', 'test_db')]
else:
    client = None
    db = None

app = FastAPI()
api_router = APIRouter(prefix="/api")

GAMES: Dict[str, dict] = {}

GRID_SIZE = 6
DUEL_TIMEOUT_MS = 12000
FAST_DUEL_TIMEOUT_MS = 6000
FLOOR_DUEL_INIT_TIME = 30.0  # seconds per player in stored-clock duel
MAX_SPECTATORS = 100
ROOM_TTL_MS = 6 * 60 * 60 * 1000        # any room dies after 6h
FINISHED_TTL_MS = 20 * 60 * 1000        # finished rooms die after 20min
IDLE_TTL_MS = 2 * 60 * 60 * 1000        # no activity for 2h -> die


def cleanup_rooms():
    now = now_ms()
    dead = []
    for code, g in GAMES.items():
        age = now - g.get("created_at", now)
        idle = now - g.get("last_activity", g.get("created_at", now))
        if age > ROOM_TTL_MS or idle > IDLE_TTL_MS or (g.get("state") == "finished" and idle > FINISHED_TTL_MS):
            dead.append(code)
    for code in dead:
        GAMES.pop(code, None)


def touch(game):
    game["last_activity"] = now_ms()
POWERUP_COLORS = ["#00F0FF", "#FF007F", "#39FF14", "#FFFF00", "#FF4500", "#9D4CDD", "#FF3B30", "#00BFFF", "#FF69B4", "#ADFF2F", "#FFA500", "#DA70D6"]


def gen_pin() -> str:
    return ''.join(random.choices(string.digits, k=6))


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def neighbors(r, c):
    result = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < GRID_SIZE and 0 <= nc < GRID_SIZE:
            result.append((nr, nc))
    return result


def find_free_cell(game):
    cells = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE) if game["grid"][r][c] is None]
    random.shuffle(cells)
    return cells[0] if cells else None


def player_cells(game, pid):
    return [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE) if game["grid"][r][c] == pid]


def effective_remaining(d, role):
    """Return remaining seconds for role ('attacker' or 'defender')."""
    key = f"{role}_stored_time"
    stored = d.get(key, FLOOR_DUEL_INIT_TIME)
    # only the active turn is ticking
    if d.get("turn") == role:
        elapsed = time.time() - d.get("turn_start_ts", time.time())
        return max(0.0, stored - elapsed)
    return float(stored)


def check_stored_clock_sudden_death(game):
    d = game.get("duel")
    if not d or d.get("resolved"):
        return False
    active = d.get("turn")
    if active not in ("attacker", "defender"):
        return False
    rem = effective_remaining(d, active)
    if rem <= 0:
        # active player lost by timeout
        loser_id = d["attacker_id"] if active == "attacker" else d.get("defender_id")
        winner_id = d.get("defender_id") if active == "attacker" else d["attacker_id"]
        d["resolved"] = True
        d["winner_id"] = winner_id
        tr, tc = d["target"]
        if winner_id == d["attacker_id"]:
            game["grid"][tr][tc] = d["attacker_id"]
            attacker = next(p for p in game["players"] if p["id"] == d["attacker_id"])
            attacker["wins"] += 1
            if attacker["wins"] % 3 == 0:
                keys = list(attacker["powerups"].keys())
                random.shuffle(keys)
                for k in keys:
                    if attacker["powerups"][k] < 2:
                        attacker["powerups"][k] += 1
                        break
            if d.get("defender_id"):
                eliminate_check(game, d["defender_id"])
        game["last_action"] = {
            "type": "duel_resolved",
            "winner_id": winner_id,
            "attacker_correct": None,
            "defender_correct": None,
            "correct_idx": None,
            "target": d["target"],
        }
        game["state"] = "active"
        alive = [p for p in game["players"] if not p["eliminated"]]
        if len(alive) <= 3 and not game.get("sudden_death"):
            game["sudden_death"] = True
        if len(alive) <= 1:
            game["state"] = "finished"
            game["winner"] = alive[0]["id"] if alive else None
            if not game.get("_stats_saved"):
                game["_stats_saved"] = True
                import asyncio
                try:
                    asyncio.create_task(save_game_result(db, game))
                except Exception:
                    pass
        game["pending_action"] = {"type": "duel_review", "until": int(time.time() * 1000) + 3800}
        return True
    return False


def can_attack(game, attacker_id, target_r, target_c):
    target = game["grid"][target_r][target_c]
    if target == attacker_id:
        return False
    for r, c in player_cells(game, attacker_id):
        if (target_r, target_c) in neighbors(r, c):
            return True
    return False


def get_random_question(category_id, custom_questions=None, force_image=False):
    imgs = IMAGE_QUESTIONS.get(category_id, [])
    quotes = QUOTE_QUESTIONS.get(category_id, [])
    customs = (custom_questions or {}).get(category_id, [])
    if force_image and imgs:
        return random.choice(imgs)
    if imgs and random.random() < 0.25:
        return random.choice(imgs)
    # 15% quote if available
    if quotes and random.random() < 0.15:
        return random.choice(quotes)
    # 20% custom if available
    if customs and random.random() < 0.20:
        return random.choice(customs)
    qs = QUESTIONS.get(category_id, [])
    if not qs:
        if imgs:
            return random.choice(imgs)
        return None
    return random.choice(qs)


def next_turn(game):
    alive = [p for p in game["players"] if not p["eliminated"]]
    if len(alive) <= 1:
        game["state"] = "finished"
        game["winner"] = alive[0]["id"] if alive else None
        if not game.get("_stats_saved"):
            game["_stats_saved"] = True
            import asyncio
            try:
                asyncio.create_task(save_game_result(db, game))
            except Exception:
                pass
        return
    idx = game.get("turn_idx", 0)
    for _ in range(len(game["players"])):
        idx = (idx + 1) % len(game["players"])
        p = game["players"][idx]
        if not p["eliminated"]:
            game["turn_idx"] = idx
            game["current_player"] = p["id"]
            game["turn_started_at"] = now_ms()
            game["last_action"] = None
            game["pending_action"] = None
            return


def eliminate_check(game, pid):
    if not player_cells(game, pid):
        for p in game["players"]:
            if p["id"] == pid:
                p["eliminated"] = True


def public_game(game):
    g = {
        "code": game["code"],
        "state": game["state"],
        "grid": game["grid"],
        "grid_size": GRID_SIZE,
        "players": [{k: v for k, v in p.items() if k != "token"} for p in game["players"]],
        "spectators": game.get("spectators", []),
        "current_player": game.get("current_player"),
        "turn_idx": game.get("turn_idx", 0),
        "winner": game.get("winner"),
        "pending_action": game.get("pending_action"),
        "duel": None,
        "last_action": game.get("last_action"),
        "sudden_death": game.get("sudden_death", False),
        "duel_timeout_ms": FAST_DUEL_TIMEOUT_MS if game.get("mode") == "flags_only" else DUEL_TIMEOUT_MS,
        "mode": game.get("mode", "classic"),
    }
    if game.get("duel"):
        d = game["duel"]
        # expose duel in stored-clock format
        if d.get("resolved"):
            g["duel"] = {
                "attacker_id": d["attacker_id"],
                "defender_id": d.get("defender_id"),
                "target": d["target"],
                "category": d["category"],
                "question": d["question"],
                "resolved": True,
                "winner_id": d.get("winner_id"),
            }
        else:
            q_pub = {"q": d["question"]["q"], "opts": d["question"]["opts"]}
            if d["question"].get("img"):
                q_pub["img"] = d["question"]["img"]
            if d["question"].get("opts_img"):
                q_pub["opts_img"] = d["question"].get("opts_img")
            g["duel"] = {
                "attacker_id": d["attacker_id"],
                "defender_id": d.get("defender_id"),
                "target": d["target"],
                "category": d["category"],
                "question": q_pub,
                "turn": d.get("turn"),
                "turn_start_ts": d.get("turn_start_ts"),
                "attacker_stored_time": d.get("attacker_stored_time"),
                "defender_stored_time": d.get("defender_stored_time"),
                "resolved": False,
                "attacker_answered": d.get("attacker_answer") is not None,
                "defender_answered": d.get("defender_answer") is not None,
            }
    return g


class CreateRoomReq(BaseModel):
    host_name: str = "المقدم"
    mode: str = "classic"  # classic | flags_only


class JoinReq(BaseModel):
    code: str
    name: str
    category_id: str


class SpectateReq(BaseModel):
    code: str
    name: str


class StartGameReq(BaseModel):
    code: str
    host_token: str


class AttackReq(BaseModel):
    code: str
    player_token: str
    row: int
    col: int


class AnswerReq(BaseModel):
    code: str
    player_token: str
    answer_idx: int


class PowerUpReq(BaseModel):
    code: str
    player_token: str
    powerup: str
    target_row: Optional[int] = None
    target_col: Optional[int] = None


class NextTurnReq(BaseModel):
    code: str
    host_token: str


class CustomQuestionReq(BaseModel):
    code: str
    host_token: str
    category_id: str
    q: str
    opts: list
    a: int


class DuelPassReq(BaseModel):
    code: str
    player_token: str


class VoiceTokenReq(BaseModel):
    room_id: str
    player_id: str


@api_router.post("/voice/token")
async def voice_token(req: VoiceTokenReq):
    app_id = os.environ.get("AGORA_APP_ID")
    app_cert = os.environ.get("AGORA_APP_CERT")
    if not app_id or not app_cert:
        raise HTTPException(
            503,
            "Agora voice chat is not available. Missing AGORA_APP_ID or AGORA_APP_CERT in environment variables.",
        )
    channel = f"floor_{req.room_id}"
    expire_ts = int(time.time()) + 3600
    uid = zlib.crc32(str(req.player_id).encode("utf-8")) % 4294967295
    if uid == 0:
        uid = 1

    try:
        token = RtcTokenBuilder.build_token_with_uid(app_id, app_cert, channel, uid, Role_Publisher, 3600, 3600)
    except Exception as exc:
        logging.exception("Failed to build Agora AccessToken2 token")
        raise HTTPException(500, f"Failed to build Agora token: {exc}")
    return {"token": token, "app_id": app_id, "channel": channel, "uid": uid}


@api_router.get("/")
async def root():
    return {"message": "Arena Game API"}


@api_router.get("/categories")
async def get_categories():
    return {"categories": CATEGORIES}


@api_router.get("/stats/leaderboard")
async def stats_leaderboard(limit: int = 20):
    return {"players": await get_hall_of_fame(db, limit)}


@api_router.get("/stats/recent")
async def stats_recent(limit: int = 10):
    return {"games": await get_recent_games(db, limit)}


@api_router.post("/rooms/create")
async def create_room(req: CreateRoomReq):
    cleanup_rooms()
    code = gen_pin()
    while code in GAMES:
        code = gen_pin()
    host_token = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
    GAMES[code] = {
        "code": code,
        "state": "lobby",
        "host_token": host_token,
        "host_name": req.host_name,
        "grid": [[None for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)],
        "players": [],
        "spectators": [],
        "current_player": None,
        "turn_idx": 0,
        "duel": None,
        "created_at": now_ms(),
        "last_activity": now_ms(),
        "winner": None,
        "sudden_death": False,
        "last_action": None,
        "pending_action": None,
        "custom_questions": {},
        "mode": req.mode,
    }
    return {"code": code, "host_token": host_token}


@api_router.post("/rooms/join")
async def join_room(req: JoinReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404, "الغرفة غير موجودة")
    if game["state"] != "lobby":
        raise HTTPException(400, "اللعبة بدأت بالفعل")
    if len(game["players"]) >= 12:
        raise HTTPException(400, "الغرفة ممتلئة")
    cat = next((c for c in CATEGORIES if c["id"] == req.category_id), None)
    if not cat:
        raise HTTPException(400, "فئة غير صالحة")
    token = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
    pid = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    color = POWERUP_COLORS[len(game["players"]) % len(POWERUP_COLORS)]
    player = {
        "id": pid,
        "token": token,
        "name": req.name,
        "category_id": req.category_id,
        "category_name": cat["name"],
        "icon": cat["icon"],
        "color": color,
        "wins": 0,
        "eliminated": False,
        "powerups": {"skip": 1, "time": 1, "eye": 1, "shield": 1},
        "shield_on": None,
    }
    game["players"].append(player)
    touch(game)
    return {"player_id": pid, "token": token, "color": color}


@api_router.post("/rooms/spectate")
async def spectate(req: SpectateReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404, "الغرفة غير موجودة")
    if len(game.get("spectators", [])) >= MAX_SPECTATORS:
        raise HTTPException(400, "وصلت الغرفة للحد الأقصى من المشاهدين")
    sid = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    game["spectators"].append({"id": sid, "name": req.name, "joined_at": now_ms()})
    return {"spectator_id": sid}


@api_router.get("/rooms/{code}/state")
async def get_state(code: str, token: Optional[str] = None):
    game = GAMES.get(code)
    if not game:
        raise HTTPException(404, "الغرفة غير موجودة")
    # auto-resolve duel on timeout or stored-clock sudden death
    if game.get("duel") and not game["duel"].get("resolved"):
        d = game["duel"]
        # stored-clock duel uses 'turn' field
        if d.get("turn"):
            check_stored_clock_sudden_death(game)
        else:
            if now_ms() - d["started_at"] > d.get("timeout_ms", DUEL_TIMEOUT_MS):
                resolve_duel_if_ready(game)
    # auto-advance turn after duel review grace period
    if game.get("pending_action") and game["pending_action"].get("type") == "duel_review":
        if now_ms() > game["pending_action"]["until"]:
            game["duel"] = None
            game["pending_action"] = None
            if game["state"] != "finished":
                next_turn(game)
    g = public_game(game)
    if token:
        me_full = next((p for p in game["players"] if p["token"] == token), None)
        if me_full:
            g["me"] = {
                "id": me_full["id"],
                "name": me_full["name"],
                "category_id": me_full["category_id"],
                "color": me_full["color"],
                "wins": me_full["wins"],
                "powerups": me_full["powerups"],
                "eliminated": me_full["eliminated"],
                "shield_on": me_full.get("shield_on"),
            }
            d = game.get("duel")
            if d and not d.get("resolved"):
                g["me"]["eye_hint"] = d.get("eye_hints", {}).get(me_full["id"])
        elif token == game["host_token"]:
            g["is_host"] = True
    return g


@api_router.post("/rooms/start")
async def start_game(req: StartGameReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    if game["host_token"] != req.host_token:
        raise HTTPException(403)
    if len(game["players"]) < 2:
        raise HTTPException(400, "يجب أن يوجد لاعبان على الأقل")
    for p in game["players"]:
        cell = find_free_cell(game)
        if cell:
            game["grid"][cell[0]][cell[1]] = p["id"]
    game["state"] = "active"
    game["turn_idx"] = -1
    next_turn(game)
    touch(game)
    return {"ok": True}


@api_router.post("/rooms/attack")
async def attack(req: AttackReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    me = next((p for p in game["players"] if p["token"] == req.player_token), None)
    if not me:
        raise HTTPException(403)
    if game["state"] != "active":
        raise HTTPException(400, "اللعبة ليست في مرحلة الهجوم")
    if game["current_player"] != me["id"]:
        raise HTTPException(400, "ليس دورك")
    if not (0 <= req.row < GRID_SIZE and 0 <= req.col < GRID_SIZE):
        raise HTTPException(400, "خانة خارج الحدود")
    if not can_attack(game, me["id"], req.row, req.col):
        raise HTTPException(400, "يجب أن تكون الخانة مجاورة لأرضك")
    target_owner = game["grid"][req.row][req.col]
    if target_owner and target_owner != me["id"]:
        defender = next(p for p in game["players"] if p["id"] == target_owner)
        if defender.get("shield_on") and tuple(defender["shield_on"]) == (req.row, req.col):
            defender["shield_on"] = None
            game["last_action"] = {"type": "shield_blocked", "attacker": me["name"], "defender": defender["name"]}
            next_turn(game)
            return {"ok": True, "blocked": True}
    if target_owner is None:
        defender_id = None
        category = "capitals" if game.get("mode") == "flags_only" else me["category_id"]
    else:
        defender = next(p for p in game["players"] if p["id"] == target_owner)
        defender_id = defender["id"]
        category = "capitals" if game.get("mode") == "flags_only" else defender["category_id"]
    question = get_random_question(category, game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"))
    if not question:
        raise HTTPException(500, "لا توجد أسئلة")
    # If attacking an empty cell, keep the legacy single-question flow
    if defender_id is None:
        timeout = FAST_DUEL_TIMEOUT_MS if game.get("mode") == "flags_only" else DUEL_TIMEOUT_MS
        game["duel"] = {
            "attacker_id": me["id"],
            "defender_id": defender_id,
            "target": [req.row, req.col],
            "category": category,
            "question": question,
            "started_at": now_ms(),
            "attacker_answer": None,
            "defender_answer": None,
            "attacker_time": None,
            "defender_time": None,
            "resolved": False,
            "winner_id": None,
            "timeout_ms": timeout,
        }
        game["state"] = "duel"
        touch(game)
        return {"ok": True}

    # For occupied cells start stored-clock rapid duel (The Floor)
    now_ts = time.time()
    game["duel"] = {
        "attacker_id": me["id"],
        "defender_id": defender_id,
        "target": [req.row, req.col],
        "category": category,
        "question": question,
        "turn": "attacker",
        "turn_start_ts": now_ts,
        "attacker_stored_time": FLOOR_DUEL_INIT_TIME,
        "defender_stored_time": FLOOR_DUEL_INIT_TIME,
        "attacker_answer": None,
        "defender_answer": None,
        "resolved": False,
        "winner_id": None,
    }
    game["state"] = "duel"
    touch(game)
    return {"ok": True}


def resolve_duel_if_ready(game):
    d = game.get("duel")
    if not d or d.get("resolved"):
        return
    solo = d["defender_id"] is None
    now = now_ms()
    elapsed = now - d["started_at"]
    timed_out = elapsed >= d.get("timeout_ms", DUEL_TIMEOUT_MS)
    a_ans = d.get("attacker_answer")
    de_ans = d.get("defender_answer")
    if solo:
        if a_ans is None and not timed_out:
            return
    else:
        if not timed_out and (a_ans is None or de_ans is None):
            return

    correct = d["question"]["a"]
    a_correct = a_ans == correct
    d_correct = de_ans == correct

    if solo:
        winner_id = d["attacker_id"] if a_correct else None
    else:
        if a_correct and d_correct:
            winner_id = d["attacker_id"] if (d["attacker_time"] or 999999) <= (d["defender_time"] or 999999) else d["defender_id"]
        elif a_correct:
            winner_id = d["attacker_id"]
        elif d_correct:
            winner_id = d["defender_id"]
        else:
            winner_id = d["defender_id"]

    d["resolved"] = True
    d["winner_id"] = winner_id
    tr, tc = d["target"]

    if winner_id == d["attacker_id"]:
        game["grid"][tr][tc] = d["attacker_id"]
        attacker = next(p for p in game["players"] if p["id"] == d["attacker_id"])
        attacker["wins"] += 1
        if attacker["wins"] % 3 == 0:
            keys = list(attacker["powerups"].keys())
            random.shuffle(keys)
            for k in keys:
                if attacker["powerups"][k] < 2:
                    attacker["powerups"][k] += 1
                    break
        if not solo:
            eliminate_check(game, d["defender_id"])

    game["last_action"] = {
        "type": "duel_resolved",
        "winner_id": winner_id,
        "attacker_correct": a_correct,
        "defender_correct": d_correct if not solo else None,
        "correct_idx": correct,
        "target": d["target"],
    }
    game["state"] = "active"

    alive = [p for p in game["players"] if not p["eliminated"]]
    if len(alive) <= 3 and not game.get("sudden_death"):
        game["sudden_death"] = True
    if len(alive) <= 1:
        game["state"] = "finished"
        game["winner"] = alive[0]["id"] if alive else None
        # persist stats
        if not game.get("_stats_saved"):
            game["_stats_saved"] = True
            import asyncio
            try:
                asyncio.create_task(save_game_result(db, game))
            except Exception:
                pass

    game["pending_action"] = {"type": "duel_review", "until": now + 3800}


@api_router.post("/rooms/answer")
async def answer(req: AnswerReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    d = game.get("duel")
    if not d or d.get("resolved"):
        raise HTTPException(400, "لا توجد مبارزة نشطة")
    me = next((p for p in game["players"] if p["token"] == req.player_token), None)
    if not me:
        raise HTTPException(403)
    # Stored-clock duel flow
    if d.get("turn"):
        # check sudden death first
        check_stored_clock_sudden_death(game)
        if d.get("resolved"):
            raise HTTPException(400, "انتهت المبارزة")
        role = None
        if me["id"] == d["attacker_id"]:
            role = "attacker"
        elif me["id"] == d.get("defender_id"):
            role = "defender"
        else:
            raise HTTPException(400, "لست جزءاً من هذه المبارزة")
        # only active player may answer
        if d.get("turn") != role:
            raise HTTPException(400, "ليس دورك")
        now_ts = time.time()
        elapsed = now_ts - d.get("turn_start_ts", now_ts)
        remaining_before = max(0.0, d.get(f"{role}_stored_time", FLOOR_DUEL_INIT_TIME) - elapsed)
        if remaining_before <= 0:
            # they lost by timeout
            check_stored_clock_sudden_death(game)
            raise HTTPException(400, "انتهى الوقت")
        correct_idx = d["question"]["a"]
        if req.answer_idx == correct_idx:
            # save remaining and switch turn
            d[f"{role}_stored_time"] = remaining_before
            # switch to opponent
            opp = "defender" if role == "attacker" else "attacker"
            d["turn"] = opp
            d["turn_start_ts"] = now_ts
            # serve next question instantly
            d["question"] = get_random_question(d["category"], game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"))
            touch(game)
            return {"ok": True, "correct": True}
        else:
            # wrong answer, keep same question and continue timing
            touch(game)
            return {"ok": True, "correct": False}

    # legacy single-question duel flow
    elapsed = now_ms() - d["started_at"]
    if elapsed > d.get("timeout_ms", DUEL_TIMEOUT_MS):
        resolve_duel_if_ready(game)
        raise HTTPException(400, "انتهى الوقت")
    if me["id"] == d["attacker_id"] and d.get("attacker_answer") is None:
        d["attacker_answer"] = req.answer_idx
        d["attacker_time"] = elapsed
    elif me["id"] == d.get("defender_id") and d.get("defender_answer") is None:
        d["defender_answer"] = req.answer_idx
        d["defender_time"] = elapsed
    else:
        raise HTTPException(400, "لست جزءاً من هذه المبارزة أو أجبت مسبقاً")
    resolve_duel_if_ready(game)
    touch(game)
    return {"ok": True}


@api_router.post("/rooms/duel_pass")
async def duel_pass(req: DuelPassReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    me = next((p for p in game["players"] if p["token"] == req.player_token), None)
    if not me:
        raise HTTPException(403)
    d = game.get("duel")
    if not d or d.get("resolved") or not d.get("turn"):
        raise HTTPException(400, "لا توجد مبارزة سارية قابلة للتمرير")
    # only active player may pass
    role = "attacker" if me["id"] == d["attacker_id"] else "defender" if me["id"] == d.get("defender_id") else None
    if role is None:
        raise HTTPException(400, "لست جزءاً من هذه المبارزة")
    if d.get("turn") != role:
        raise HTTPException(400, "ليس دورك")
    now_ts = time.time()
    elapsed = now_ts - d.get("turn_start_ts", now_ts)
    remaining = max(0.0, d.get(f"{role}_stored_time", FLOOR_DUEL_INIT_TIME) - elapsed - 3.0)
    d[f"{role}_stored_time"] = remaining
    # check sudden death
    if remaining <= 0:
        check_stored_clock_sudden_death(game)
        touch(game)
        return {"ok": True, "passed": True, "sudden_death": True}
    # switch turn to opponent and serve new question
    opp = "defender" if role == "attacker" else "attacker"
    d["turn"] = opp
    d["turn_start_ts"] = now_ts
    d["question"] = get_random_question(d["category"], game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"))
    touch(game)
    return {"ok": True, "passed": True}


@api_router.post("/rooms/powerup")
async def use_powerup(req: PowerUpReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    me = next((p for p in game["players"] if p["token"] == req.player_token), None)
    if not me:
        raise HTTPException(403)
    pu = req.powerup
    if pu not in me["powerups"] or me["powerups"][pu] <= 0:
        raise HTTPException(400, "لا تملك هذه القدرة")
    d = game.get("duel")

    def in_duel():
        return d and not d.get("resolved") and me["id"] in (d["attacker_id"], d.get("defender_id"))

    if pu == "skip":
        if not in_duel():
            raise HTTPException(400, "القدرة متاحة فقط لأطراف المبارزة")
        # prevent abuse: can't skip after the opponent already answered
        # If stored-clock duel, allow skip only if opponent hasn't just answered (we track answers per-question)
        if d.get("turn"):
            opp = d.get("defender_answer") if me["id"] == d["attacker_id"] else d.get("attacker_answer")
            if opp is not None:
                raise HTTPException(400, "لا يمكن التخطي بعد إجابة الخصم")
            d["question"] = get_random_question(d["category"], game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"))
            d["attacker_answer"] = None
            d["defender_answer"] = None
            d["eye_hints"] = {}
            # keep turn and turn_start_ts (question changed instantly)
            d["turn_start_ts"] = time.time()
            me["powerups"][pu] -= 1
        else:
            opp_answer = d.get("defender_answer") if me["id"] == d["attacker_id"] else d.get("attacker_answer")
            if opp_answer is not None:
                raise HTTPException(400, "لا يمكن التخطي بعد إجابة الخصم")
            d["question"] = get_random_question(d["category"], game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"))
            d["attacker_answer"] = None
            d["defender_answer"] = None
            d["attacker_time"] = None
            d["defender_time"] = None
            d["started_at"] = now_ms()
            d["eye_hints"] = {}  # new question -> old hints invalid
            me["powerups"][pu] -= 1
    elif pu == "time":
        if not in_duel():
            raise HTTPException(400, "القدرة متاحة فقط لأطراف المبارزة")
        if d.get("turn"):
            # add 5 seconds to this player's stored time
            role = "attacker" if me["id"] == d["attacker_id"] else "defender"
            d[f"{role}_stored_time"] = d.get(f"{role}_stored_time", FLOOR_DUEL_INIT_TIME) + 5.0
        else:
            d["started_at"] += 5000
        me["powerups"][pu] -= 1
    elif pu == "eye":
        # give a hint - remove one wrong option (visible only to this player)
        if not in_duel():
            raise HTTPException(400, "القدرة متاحة فقط لأطراف المبارزة")
        d.setdefault("eye_hints", {})
        if me["id"] in d["eye_hints"]:
            return {"ok": True, "eye_hint": d["eye_hints"][me["id"]]}
        wrong_idxs = [i for i in range(len(d["question"]["opts"])) if i != d["question"]["a"]]
        random.shuffle(wrong_idxs)
        d["eye_hints"][me["id"]] = wrong_idxs[0]
        me["powerups"][pu] -= 1
    elif pu == "shield":
        if req.target_row is None or req.target_col is None:
            raise HTTPException(400, "اختر خانة للدرع")
        if game["grid"][req.target_row][req.target_col] != me["id"]:
            raise HTTPException(400, "الخانة ليست لك")
        me["shield_on"] = [req.target_row, req.target_col]
        me["powerups"][pu] -= 1
    else:
        raise HTTPException(400)
    return {"ok": True, "eye_hint": (game.get("duel") or {}).get("eye_hints", {}).get(me["id"]) if pu == "eye" else None}


@api_router.post("/rooms/next_turn")
async def next_turn_ep(req: NextTurnReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    if game["host_token"] != req.host_token:
        raise HTTPException(403)
    if game.get("duel"):
        if not game["duel"].get("resolved"):
            resolve_duel_if_ready(game)
        game["duel"] = None
        game["pending_action"] = None
    if game["state"] == "duel":
        game["state"] = "active"
    if game["state"] != "finished":
        next_turn(game)
    return {"ok": True}


@api_router.post("/rooms/custom_question")
async def add_custom_question(req: CustomQuestionReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    if game["host_token"] != req.host_token:
        raise HTTPException(403)
    if game["state"] != "lobby":
        raise HTTPException(400, "يمكن الإضافة قبل بدء المباراة فقط")
    if len(req.opts) != 4 or req.a < 0 or req.a > 3 or not req.q.strip():
        raise HTTPException(400, "سؤال غير صالح")
    game["custom_questions"].setdefault(req.category_id, []).append({"q": req.q, "opts": req.opts, "a": req.a})
    total = sum(len(v) for v in game["custom_questions"].values())
    return {"ok": True, "total_custom": total}


@api_router.post("/rooms/tick")
async def tick(code: str):
    game = GAMES.get(code)
    if not game:
        raise HTTPException(404)
    if game.get("duel") and not game["duel"].get("resolved"):
        d = game["duel"]
        if d.get("turn"):
            check_stored_clock_sudden_death(game)
        else:
            if now_ms() - d["started_at"] > d.get("timeout_ms", DUEL_TIMEOUT_MS):
                resolve_duel_if_ready(game)
    # auto-clear duel review after grace period AND auto-advance turn
    if game.get("pending_action") and game["pending_action"].get("type") == "duel_review":
        if now_ms() > game["pending_action"]["until"]:
            game["duel"] = None
            game["pending_action"] = None
            if game["state"] != "finished":
                next_turn(game)
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
