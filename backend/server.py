from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import string
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timezone

from questions import CATEGORIES, QUESTIONS
from image_questions import IMAGE_QUESTIONS
from stats import save_game_result, get_hall_of_fame, get_recent_games

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

GAMES: Dict[str, dict] = {}

GRID_SIZE = 6
DUEL_TIMEOUT_MS = 12000
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


def can_attack(game, attacker_id, target_r, target_c):
    target = game["grid"][target_r][target_c]
    if target == attacker_id:
        return False
    for r, c in player_cells(game, attacker_id):
        if (target_r, target_c) in neighbors(r, c):
            return True
    return False


def get_random_question(category_id):
    # 30% chance to pick an image question if available for this category
    imgs = IMAGE_QUESTIONS.get(category_id, [])
    if imgs and random.random() < 0.3:
        return random.choice(imgs)
    qs = QUESTIONS.get(category_id, [])
    if not qs:
        # fallback to image if only imgs exist
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
        "duel_timeout_ms": DUEL_TIMEOUT_MS,
    }
    if game.get("duel"):
        d = game["duel"]
        if d.get("resolved"):
            g["duel"] = {
                "attacker_id": d["attacker_id"],
                "defender_id": d.get("defender_id"),
                "target": d["target"],
                "category": d["category"],
                "question": d["question"],
                "started_at": d["started_at"],
                "resolved": True,
                "attacker_answer": d.get("attacker_answer"),
                "defender_answer": d.get("defender_answer"),
                "winner_id": d.get("winner_id"),
            }
        else:
            q_pub = {"q": d["question"]["q"], "opts": d["question"]["opts"]}
            if d["question"].get("img"):
                q_pub["img"] = d["question"]["img"]
            g["duel"] = {
                "attacker_id": d["attacker_id"],
                "defender_id": d.get("defender_id"),
                "target": d["target"],
                "category": d["category"],
                "question": q_pub,
                "started_at": d["started_at"],
                "resolved": False,
                "attacker_answered": d.get("attacker_answer") is not None,
                "defender_answered": d.get("defender_answer") is not None,
            }
    return g


class CreateRoomReq(BaseModel):
    host_name: str = "المقدم"


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
        "winner": None,
        "sudden_death": False,
        "last_action": None,
        "pending_action": None,
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
    return {"player_id": pid, "token": token, "color": color}


@api_router.post("/rooms/spectate")
async def spectate(req: SpectateReq):
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404, "الغرفة غير موجودة")
    sid = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    game["spectators"].append({"id": sid, "name": req.name, "joined_at": now_ms()})
    return {"spectator_id": sid}


@api_router.get("/rooms/{code}/state")
async def get_state(code: str, token: Optional[str] = None):
    game = GAMES.get(code)
    if not game:
        raise HTTPException(404, "الغرفة غير موجودة")
    # auto-resolve duel on timeout
    if game.get("duel") and not game["duel"].get("resolved"):
        if now_ms() - game["duel"]["started_at"] > DUEL_TIMEOUT_MS:
            resolve_duel_if_ready(game)
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
        category = me["category_id"]
    else:
        defender = next(p for p in game["players"] if p["id"] == target_owner)
        defender_id = defender["id"]
        category = defender["category_id"]
    question = get_random_question(category)
    if not question:
        raise HTTPException(500, "لا توجد أسئلة")
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
    }
    game["state"] = "duel"
    return {"ok": True}


def resolve_duel_if_ready(game):
    d = game.get("duel")
    if not d or d.get("resolved"):
        return
    solo = d["defender_id"] is None
    now = now_ms()
    elapsed = now - d["started_at"]
    timed_out = elapsed >= DUEL_TIMEOUT_MS
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
    elapsed = now_ms() - d["started_at"]
    if elapsed > DUEL_TIMEOUT_MS:
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
    return {"ok": True}


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

    if pu == "skip":
        if not d or d.get("resolved"):
            raise HTTPException(400, "استخدم أثناء المبارزة")
        d["question"] = get_random_question(d["category"])
        d["attacker_answer"] = None
        d["defender_answer"] = None
        d["attacker_time"] = None
        d["defender_time"] = None
        d["started_at"] = now_ms()
        me["powerups"][pu] -= 1
    elif pu == "time":
        if not d or d.get("resolved"):
            raise HTTPException(400)
        d["started_at"] += 5000
        me["powerups"][pu] -= 1
    elif pu == "eye":
        # give a hint - remove one wrong option (marked in response only for this player)
        if not d or d.get("resolved"):
            raise HTTPException(400)
        d.setdefault("eye_hints", {})
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


@api_router.post("/rooms/tick")
async def tick(code: str):
    game = GAMES.get(code)
    if not game:
        raise HTTPException(404)
    if game.get("duel") and not game["duel"].get("resolved"):
        if now_ms() - game["duel"]["started_at"] > DUEL_TIMEOUT_MS:
            resolve_duel_if_ready(game)
    # auto-clear duel review after grace period
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
