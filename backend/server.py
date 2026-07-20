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

from questions import CATEGORIES, FLAGS_CATEGORIES, QUESTIONS
from image_questions import IMAGE_QUESTIONS
from stats import save_game_result, get_hall_of_fame, get_recent_games
from football_data import FOOTBALL_CATEGORIES, FOOTBALL_QUESTIONS
FOOTBALL_CATEGORY_IDS = {c["id"] for c in FOOTBALL_CATEGORIES}
for _fc_id, _fc_qs in FOOTBALL_QUESTIONS.items():
    QUESTIONS.setdefault(_fc_id, [])
    QUESTIONS[_fc_id].extend(_fc_qs)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

GAMES: Dict[str, dict] = {}

GRID_SIZE = 6
DUEL_TIMEOUT_MS = 45000
FAST_DUEL_TIMEOUT_MS = 6000
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


def neighbors(r, c, gs=6):
    result = []
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < gs and 0 <= nc < gs:
            result.append((nr, nc))
    return result


def find_free_cell(game):
    gs = game.get("grid_size", 6)
    cells = [(r, c) for r in range(gs) for c in range(gs) if game["grid"][r][c] is None]
    random.shuffle(cells)
    return cells[0] if cells else None


def player_cells(game, pid):
    gs = game.get("grid_size", 6)
    return [(r, c) for r in range(gs) for c in range(gs) if game["grid"][r][c] == pid]


def can_attack(game, attacker_id, target_r, target_c):
    target = game["grid"][target_r][target_c]
    if target == attacker_id:
        return False
    for r, c in player_cells(game, attacker_id):
        if (target_r, target_c) in neighbors(r, c, game.get("grid_size", 6)):
            return True
    return False


def _pick_avoiding_repeats(pool, asked_set, key_fn):
    """يختار عنصراً لم يُطرح مؤخراً؛ إذا استُنفدت كلها يعيد التدوير."""
    if not pool:
        return None
    fresh = [x for x in pool if key_fn(x) not in asked_set]
    if not fresh:
        # استُنفدت كل الأسئلة: صفّر الذاكرة لهذه الفئة وأعد التدوير
        for x in pool:
            asked_set.discard(key_fn(x))
        fresh = pool
    chosen = random.choice(fresh)
    asked_set.add(key_fn(chosen))
    return chosen


def get_random_question(category_id, custom_questions=None, force_image=False, game=None):
    imgs = IMAGE_QUESTIONS.get(category_id, [])
    customs = (custom_questions or {}).get(category_id, [])
    # ذاكرة الأسئلة المطروحة لكل غرفة (تمنع التكرار السريع)
    asked = None
    if game is not None:
        asked = game.setdefault("_asked_questions", {}).setdefault(category_id, set())

    def _q_key(q):
        return q.get("q", "") if isinstance(q, dict) else str(q)

    if force_image and imgs:
        return _pick_avoiding_repeats(imgs, asked, _q_key) if asked is not None else random.choice(imgs)
    if imgs and random.random() < 0.25:
        return _pick_avoiding_repeats(imgs, asked, _q_key) if asked is not None else random.choice(imgs)
    if customs and random.random() < 0.20:
        return _pick_avoiding_repeats(customs, asked, _q_key) if asked is not None else random.choice(customs)
    qs = QUESTIONS.get(category_id, [])
    if not qs:
        if imgs:
            return _pick_avoiding_repeats(imgs, asked, _q_key) if asked is not None else random.choice(imgs)
        return None
    return _pick_avoiding_repeats(qs, asked, _q_key) if asked is not None else random.choice(qs)


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


def _duel_current_remaining(d):
    """الوقت المتبقي لصاحب الدور الحالي بالثواني."""
    now_sec = now_ms() / 1000.0
    turn = d.get("turn")
    stored = d.get(f"{turn}_stored_time", 0) if turn else 0
    return max(0.0, stored - (now_sec - d.get("turn_start_ts", now_sec)))


def _duel_bank(d, who):
    """رصيد لاعب: إن كان صاحب الدور احسب المتبقي الحيّ، وإلا الرصيد المخزّن."""
    if d.get("turn") == who:
        return _duel_current_remaining(d)
    return d.get(f"{who}_stored_time", 0)


def finish_duel(game, loser_id):
    """ينهي المبارزة: الطرف الآخر يفوز ويستحوذ على أرض الخاسر."""
    d = game["duel"]
    att, dfn = d["attacker_id"], d.get("defender_id")
    # في هجوم خانة فارغة (لا مدافع): الفوز = إجابة المهاجم الأولى الصحيحة
    if dfn is None:
        winner_id = att if loser_id != att else None
    else:
        winner_id = dfn if loser_id == att else att
    d["resolved"] = True
    d["winner_id"] = winner_id
    tr, tc = d["target"]

    if winner_id == att:
        # المهاجم يفوز: يأخذ الخانة الهدف
        game["grid"][tr][tc] = att
        attacker = next(p for p in game["players"] if p["id"] == att)
        attacker["wins"] += 1
        if attacker["wins"] % 3 == 0:
            keys = list(attacker["powerups"].keys())
            random.shuffle(keys)
            for k in keys:
                if attacker["powerups"][k] < 2:
                    attacker["powerups"][k] += 1
                    break
        # الاستحواذ الكامل على أرض الخاسر (المدافع)
        if dfn is not None and loser_id == dfn:
            _gs = game.get("grid_size", 6)
            for r in range(_gs):
                for c in range(_gs):
                    if game["grid"][r][c] == dfn:
                        game["grid"][r][c] = att
            eliminate_check(game, dfn)
    elif winner_id == dfn and dfn is not None:
        # المدافع يفوز: يستحوذ على أرض المهاجم الخاسر
        _gs = game.get("grid_size", 6)
        for r in range(_gs):
            for c in range(_gs):
                if game["grid"][r][c] == att:
                    game["grid"][r][c] = dfn
        defender = next(p for p in game["players"] if p["id"] == dfn)
        defender["wins"] += 1
        eliminate_check(game, att)

    game["last_action"] = {
        "type": "duel_resolved",
        "winner_id": winner_id,
        "loser_id": loser_id,
        "correct_idx": d["question"]["a"],
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

    game["pending_action"] = {"type": "duel_review", "until": now_ms() + 3800}


def check_duel_timeout(game):
    """يتحقق إن انتهى وقت المبارزة الكلي أو تم تلقي إجابتين."""
    d = game.get("duel")
    if not d or d.get("resolved"):
        return
    if now_ms() - d.get("started_at", now_ms()) < 3800:
        return
    if not d.get("defender_id"):
        return
    if now_ms() - d.get("started_at", now_ms()) >= d.get("timeout_ms", DUEL_TIMEOUT_MS):
        resolve_duel_if_ready(game)


def public_game(game):
    g = {
        "code": game["code"],
        "state": game["state"],
        "grid": game["grid"],
        "grid_size": game.get("grid_size", 6),
        "players": [{k: v for k, v in p.items() if k != "token"} for p in game["players"]],
        "spectators": game.get("spectators", []),
        "current_player": game.get("current_player"),
        "turn_idx": game.get("turn_idx", 0),
        "winner": game.get("winner"),
        "pending_action": game.get("pending_action"),
        "duel": None,
        "last_action": game.get("last_action"),
        "sudden_death": game.get("sudden_death", False),
        "final_duel": {
            "active": game.get("final_duel_active", False),
            "round": game.get("final_duel_round", 0),
            "scores": game.get("final_duel_scores", {}),
            "players": game.get("final_duel_players", []),
        } if game.get("final_duel_active") else None,
        "duel_timeout_ms": DUEL_TIMEOUT_MS,
        "mode": game.get("mode", "classic"),
    }
    if game.get("duel"):
        d = game["duel"]
        active_timeout = d.get("timeout_ms", DUEL_TIMEOUT_MS)
        if d.get("resolved"):
            g["duel"] = {
                "attacker_id": d["attacker_id"],
                "defender_id": d.get("defender_id"),
                "target": d["target"],
                "category": d["category"],
                "question": d["question"],
                "started_at": d["started_at"],
                "resolved": True,
                "winner_id": d.get("winner_id"),
                "timeout_ms": active_timeout,
                "attacker_stored_time": d.get("attacker_stored_time"),
                "defender_stored_time": d.get("defender_stored_time"),
                "turn": d.get("turn"),
                "turn_start_ts": d.get("turn_start_ts"),
            }
        else:
            q_pub = {"q": d["question"]["q"], "opts": d["question"]["opts"]}
            if d["question"].get("img"):
                q_pub["img"] = d["question"]["img"]
            if d["question"].get("opts_img"):
                q_pub["opts_img"] = d["question"]["opts_img"]
            g["duel"] = {
                "attacker_id": d["attacker_id"],
                "defender_id": d.get("defender_id"),
                "target": d["target"],
                "category": d["category"],
                "question": q_pub,
                "started_at": d["started_at"],
                "resolved": False,
                "timeout_ms": active_timeout,
                # حقول نظام التناوب
                "attacker_stored_time": d.get("attacker_stored_time"),
                "defender_stored_time": d.get("defender_stored_time"),
                "turn": d.get("turn"),
                "turn_start_ts": d.get("turn_start_ts"),
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


class VoiceTokenReq(BaseModel):
    room_id: str
    player_id: str


def _uid_from_player(player_id: str) -> int:
    import zlib
    return zlib.crc32(player_id.encode("utf-8")) & 0x7FFFFFFF


@api_router.post("/voice/token")
async def get_voice_token(req: VoiceTokenReq):
    try:
        channel = (req.room_id or "").strip()
        uid = _uid_from_player((req.player_id or "").strip())
        app_id = (os.environ.get("AGORA_APP_ID") or "").strip()
        app_cert = (os.environ.get("AGORA_APP_CERT") or os.environ.get("AGORA_APP_CERTIFICATE") or "").strip()
        if not app_id or not app_cert:
            raise HTTPException(status_code=500, detail="Agora credentials not configured")
        from agora_token_builder import RtcTokenBuilder
        import time
        expire = int(time.time()) + 3600
        token = RtcTokenBuilder.buildTokenWithUid(app_id, app_cert, channel, uid, 1, expire)
        return {"token": token, "app_id": app_id, "channel": channel, "uid": uid}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("VOICE TOKEN ERROR:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/")
async def root():
    return {"message": "Arena Game API"}


@api_router.get("/categories")
async def get_categories(mode: str = "classic"):
    if mode == "football":
        return {"categories": FOOTBALL_CATEGORIES}
    if mode == "flags_only":
        return {"categories": FLAGS_CATEGORIES}
    return {"categories": [c for c in CATEGORIES if c["id"] not in {"players_img", "actors_img", "anime_img", "brands_img", "clubs_img"}]}


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
        "grid_size": 6,
        "grid": [[None for _ in range(6)] for _ in range(6)],
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
    # تحقق أن الفئة تنتمي لوضع الغرفة (كرة القدم لها فئاتها الخاصة)
    room_mode = game.get("mode", "classic")
    if room_mode == "football":
        cat = next((c for c in FOOTBALL_CATEGORIES if c["id"] == req.category_id), None)
        if not cat:
            raise HTTPException(400, "هذه الغرفة لوضع كرة القدم — اختر فئة كروية")
    elif room_mode == "flags_only":
        cat = next((c for c in FLAGS_CATEGORIES if c["id"] == req.category_id), None)
        if not cat:
            raise HTTPException(400, "فئة غير صالحة لهذا الوضع")
    else:
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
    # auto-resolve duel on timeout (respect per-duel timeout, e.g. fast mode)
    if game.get("duel") and not game["duel"].get("resolved"):
        check_duel_timeout(game)
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
    # توزيع اللاعبين في مواقع متقابلة قطرياً
    # للاعبين: (0,0) و(5,5) — أقصى زاويتين
    # للأربعة: الزوايا الأربع
    # لأكثر: زوايا + منتصف الأضلاع
    gs = game.get("grid_size", 6)
    corner_positions = [
        (0, gs-1),        # زاوية علوية يمين (مربع 6 تقريباً)
        (gs-1, 0),        # زاوية سفلية يسار (مربع 31 تقريباً)
        (0, 0),           # زاوية علوية يسار
        (gs-1, gs-1),     # زاوية سفلية يمين
        (gs//2, 0),       # منتصف يسار
        (gs//2, gs-1),    # منتصف يمين
        (0, gs//2),       # منتصف أعلى
        (gs-1, gs//2),    # منتصف أسفل
    ]
    used = set()
    for i, p in enumerate(game["players"]):
        placed = False
        for pos in corner_positions:
            if pos not in used and game["grid"][pos[0]][pos[1]] is None:
                game["grid"][pos[0]][pos[1]] = p["id"]
                used.add(pos)
                placed = True
                break
        if not placed:
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
    _gs = game.get("grid_size", 6)
    if not (0 <= req.row < _gs and 0 <= req.col < _gs):
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
    flags_allowed_ids = {c["id"] for c in FLAGS_CATEGORIES}
    if target_owner is None:
        defender_id = None
        if game.get("mode") == "flags_only":
            category = me["category_id"] if me["category_id"] in flags_allowed_ids else "capitals"
        else:
            category = me["category_id"]
    else:
        defender = next(p for p in game["players"] if p["id"] == target_owner)
        defender_id = defender["id"]
        if game.get("mode") == "flags_only":
            category = defender["category_id"] if defender["category_id"] in flags_allowed_ids else "capitals"
        else:
            category = defender["category_id"]

    # المبارزة النهائية: تحديد الفئة حسب الجولة
    if game.get("final_duel_active") and game.get("mode") != "flags_only":
        fd_round = game.get("final_duel_round", 0)
        fd_players = game.get("final_duel_players", [])
        alive = [p for p in game["players"] if not p["eliminated"]]
        if len(fd_players) == 2:
            p0 = next((p for p in game["players"] if p["id"] == fd_players[0]), None)
            p1 = next((p for p in game["players"] if p["id"] == fd_players[1]), None)
            if fd_round == 0 and p0:
                category = p0["category_id"]
            elif fd_round == 1 and p1:
                category = p1["category_id"]
            else:
                # جولة عشوائية
                import random as _r
                all_cats = [c["id"] for c in CATEGORIES if c["id"] not in ("football",)]
                category = _r.choice(all_cats) if all_cats else category

    question = get_random_question(category, game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"), game=game)
    if not question:
        raise HTTPException(500, "لا توجد أسئلة")
    timeout = DUEL_TIMEOUT_MS
    bank_sec = timeout / 1000.0  # رصيد كل لاعب بالثواني
    now = now_ms()
    game["duel"] = {
        "attacker_id": me["id"],
        "defender_id": defender_id,
        "target": [req.row, req.col],
        "category": category,
        "question": question,
        "started_at": now,
        "timeout_ms": timeout,
        # نظام التناوب: كل لاعب له رصيد وقت خاص
        "attacker_stored_time": bank_sec,
        "defender_stored_time": bank_sec,
        "turn": "attacker",              # المهاجم يبدأ
        "turn_start_ts": now / 1000.0,   # لحظة بدء دور اللاعب الحالي (بالثواني)
        "attacker_correct_count": 0,
        "defender_correct_count": 0,
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
    print(f"RESOLVE_CHECK: timed_out={timed_out}, elapsed={elapsed}, resolved={d.get('resolved')}")
    print(f"RESOLVE_DETAIL: elapsed={elapsed}, timeout_ms={d.get('timeout_ms')}, timed_out={timed_out}, started_at={d.get('started_at')}, now={now_ms()}")
    if not timed_out:
        return

    correct = d["question"]["a"]
    a_correct = False
    d_correct = False

    if solo:
        winner_id = d["attacker_id"] if a_correct else None
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
    elif len(alive) == 2 and not game.get("final_duel_active"):
        # المبارزة النهائية: لاعبان فقط → 3 جولات حاسمة
        game["final_duel_active"] = True
        game["final_duel_round"] = 0  # 0=فئة A، 1=فئة B، 2=عشوائية
        game["final_duel_scores"] = {alive[0]["id"]: 0, alive[1]["id"]: 0}
        game["final_duel_players"] = [alive[0]["id"], alive[1]["id"]]

    # تحديث نقاط المبارزة النهائية
    if game.get("final_duel_active") and winner_id:
        fd_scores = game.get("final_duel_scores", {})
        if winner_id in fd_scores:
            fd_scores[winner_id] = fd_scores.get(winner_id, 0) + 1
        fd_round = game.get("final_duel_round", 0)
        game["final_duel_round"] = fd_round + 1
        # تحقق: هل فاز أحد بجولتين أو انتهت الجولات الثلاث
        fd_players = game.get("final_duel_players", [])
        if fd_players:
            s0 = fd_scores.get(fd_players[0], 0)
            s1 = fd_scores.get(fd_players[1], 0)
            total_rounds = fd_round + 1
            fd_winner = None
            if s0 >= 2:
                fd_winner = fd_players[0]
            elif s1 >= 2:
                fd_winner = fd_players[1]
            elif total_rounds >= 3:
                fd_winner = fd_players[0] if s0 > s1 else (fd_players[1] if s1 > s0 else None)
            if fd_winner:
                game["state"] = "finished"
                game["winner"] = fd_winner
                game["final_duel_active"] = False
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

    turn = d.get("turn")
    turn_id = d["attacker_id"] if turn == "attacker" else d.get("defender_id")
    if me["id"] != turn_id:
        raise HTTPException(400, "ليس دورك في المبارزة")

    is_solo = not d.get("defender_id")  # خانة فارغة: بلا حدّ زمني
    correct = d["question"]["a"]
    is_correct = (req.answer_idx == correct)
    now_sec = now_ms() / 1000.0
    print(f"ANSWER: turn={d.get('turn')}, correct={correct}, is_solo={is_solo}")

    if is_correct:
        d[f"{turn}_stored_time"] = d.get(f"{turn}_stored_time", 0.0)
        d[f"{turn}_correct_count"] = d.get(f"{turn}_correct_count", 0) + 1
        if is_solo:
            finish_duel(game, None)
            touch(game)
            return {"ok": True, "correct": True}
        other = "defender" if turn == "attacker" else "attacker"
        d["turn"] = other
        d["turn_start_ts"] = now_sec
        newq = get_random_question(d["category"], game.get("custom_questions"),
                                   force_image=(game.get("mode") == "flags_only"), game=game)
        if newq:
            d["question"] = newq
        touch(game)
        return {"ok": True, "correct": True, "switched": True}
    else:
        if is_solo:
            finish_duel(game, d["attacker_id"])
            touch(game)
            return {"ok": True, "correct": False}
        # Deduct 3 seconds for wrong answer; reaching zero still keeps the duel alive
        current_stored = d.get(f"{turn}_stored_time", 0)
        d[f"{turn}_stored_time"] = max(0.0, current_stored - 3.0)
        d["turn_start_ts"] = now_sec
        print(f"WRONG: stored_time={d.get(f'{turn}_stored_time')}, resolved={d.get('resolved')}")
        newq = get_random_question(d["category"], game.get("custom_questions"),
                                   force_image=(game.get("mode") == "flags_only"), game=game)
        if newq:
            d["question"] = newq
        print(f"ANSWER_END: resolved={d.get('resolved')}, turn={d.get('turn')}")
        touch(game)
        return {"ok": True, "correct": False}


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
        opp_answer = d.get("defender_answer") if me["id"] == d["attacker_id"] else d.get("attacker_answer")
        if opp_answer is not None:
            raise HTTPException(400, "لا يمكن التخطي بعد إجابة الخصم")
        d["question"] = get_random_question(d["category"], game.get("custom_questions"), force_image=(game.get("mode") == "flags_only"), game=game)
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
            check_duel_timeout(game)
        game["duel"] = None
        game["pending_action"] = None
    if game["state"] == "duel":
        game["state"] = "active"
    if game["state"] != "finished":
        next_turn(game)
    return {"ok": True}


class KickReq(BaseModel):
    code: str
    host_token: str
    player_id: str


@api_router.post("/rooms/kick")
async def kick_player(req: KickReq):
    """المقدم يطرد لاعباً"""
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    if game["host_token"] != req.host_token:
        raise HTTPException(403)
    player = next((p for p in game["players"] if p["id"] == req.player_id), None)
    if not player:
        raise HTTPException(404, "اللاعب غير موجود")

    if game["state"] == "lobby":
        # في اللوبي: احذف اللاعب نهائياً
        game["players"] = [p for p in game["players"] if p["id"] != req.player_id]
    else:
        # أثناء اللعب
        alive = [p for p in game["players"] if not p.get("eliminated")]
        alive_others = [p for p in alive if p["id"] != req.player_id]

        # أنهِ أي مبارزة جارية مع المطرود
        d = game.get("duel")
        if d and not d.get("resolved") and req.player_id in (d.get("attacker_id"), d.get("defender_id")):
            # لو المطرود مهاجم → المدافع يكسب (الخانة تبقى)
            # لو المطرود مدافع → المهاجم يكسب
            target = d.get("target")
            if target and d.get("defender_id") == req.player_id:
                game["grid"][target[0]][target[1]] = d.get("attacker_id")
            game["duel"] = None
            game["pending_action"] = None

        if len(alive_others) <= 1:
            # لاعب واحد متبقٍ → اللعبة تنتهي
            game["players"] = [p for p in game["players"] if p["id"] != req.player_id]
            winner = alive_others[0]["id"] if alive_others else None
            game["state"] = "finished"
            game["winner"] = winner
        else:
            # أكثر من لاعب → مربعات المطرود تصبح فارغة
            _gs = game.get("grid_size", 6)
            for r in range(_gs):
                for c in range(_gs):
                    if game["grid"][r][c] == req.player_id:
                        game["grid"][r][c] = None
            game["players"] = [p for p in game["players"] if p["id"] != req.player_id]
            # لو كان دوره، انتقل للتالي
            if game.get("current_player") == req.player_id:
                next_turn(game)

    touch(game)
    return {"ok": True, "kicked": req.player_id}


class MuteReq(BaseModel):
    code: str
    host_token: str
    player_id: str
    mute: bool  # True=كتم، False=فك الكتم


@api_router.post("/rooms/mute")
async def mute_player(req: MuteReq):
    """المقدم يكتم أو يفكّ كتم صوت لاعب"""
    game = GAMES.get(req.code)
    if not game:
        raise HTTPException(404)
    if game["host_token"] != req.host_token:
        raise HTTPException(403)
    player = next((p for p in game["players"] if p["id"] == req.player_id), None)
    if not player:
        raise HTTPException(404, "اللاعب غير موجود")
    player["muted_by_host"] = req.mute
    touch(game)
    return {"ok": True, "player_id": req.player_id, "muted": req.mute}



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
        check_duel_timeout(game)
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
