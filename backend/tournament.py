from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Optional
import random
import string
from datetime import datetime, timezone

from questions import CATEGORIES, FLAGS_CATEGORIES, QUESTIONS
from image_questions import IMAGE_QUESTIONS
from football_data import FOOTBALL_CATEGORIES, FOOTBALL_QUESTIONS

for _fc_id, _fc_qs in FOOTBALL_QUESTIONS.items():
    QUESTIONS.setdefault(_fc_id, [])
    QUESTIONS[_fc_id].extend(_fc_qs)

router = APIRouter(prefix="/api/tournament")
TOURNAMENTS: Dict[str, dict] = {}


class CreateTournamentReq(BaseModel):
    host_name: Optional[str] = "المقدم"
    mode: str = "classic"


class JoinTournamentReq(BaseModel):
    code: str
    name: str
    category_id: str


class StartTournamentReq(BaseModel):
    code: str
    host_token: str


class StartMatchReq(BaseModel):
    code: str
    host_token: str
    match_id: str


class AnswerTournamentReq(BaseModel):
    code: str
    player_token: str
    answer_idx: int


def now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def gen_pin() -> str:
    return "".join(random.choices(string.digits, k=6))


def _categories_for_mode(mode: str):
    if mode == "flags_only":
        return FLAGS_CATEGORIES
    if mode == "football":
        return FOOTBALL_CATEGORIES
    return CATEGORIES


def _pick_question(category_id: str):
    imgs = IMAGE_QUESTIONS.get(category_id, [])
    if imgs and random.random() < 0.3:
        return random.choice(imgs)
    qs = QUESTIONS.get(category_id, [])
    if qs:
        return random.choice(qs)
    if imgs:
        return random.choice(imgs)
    return {"q": "ما هو الجواب؟", "opts": ["أ", "ب", "ج", "د"], "a": 0}


def _make_match(match_id: str, players: List[str], label: str = "مباراة"):
    return {
        "id": match_id,
        "label": label,
        "players": players,
        "status": "pending",
        "winner_id": None,
        "scores": {},
        "current_round": 1,
        "active_player_id": None,
        "question": None,
        "round_results": [],
        "category_name": None,
    }


def _player_by_id(tournament: dict):
    return {p["id"]: p for p in tournament["players"]}


def _round_category(tournament: dict, match: dict, round_num: int):
    players = match["players"]
    if len(players) < 2:
        return None
    player_map = _player_by_id(tournament)
    first = player_map[players[0]]["category_id"]
    second = player_map[players[1]]["category_id"]
    if round_num == 1:
        return first
    if round_num == 2:
        return second
    used = {first, second}
    categories = _categories_for_mode(tournament["mode"])
    available = [c["id"] for c in categories if c["id"] not in used]
    return random.choice(available) if available else first


def _load_question(tournament: dict, match: dict):
    category_id = _round_category(tournament, match, match["current_round"])
    if category_id:
        category = next((item for item in _categories_for_mode(tournament["mode"]) if item["id"] == category_id), None)
        match["category_name"] = category["name"] if category else category_id
        match["question"] = _pick_question(category_id)
    else:
        match["category_name"] = None
        match["question"] = {"q": "لا توجد أسئلة", "opts": ["1", "2", "3", "4"], "a": 0}


def _start_match(tournament: dict, match: dict):
    match["status"] = "active"
    match["scores"] = {pid: 0 for pid in match["players"]}
    match["current_round"] = 1
    match["round_results"] = []
    match["question"] = None
    match["active_player_id"] = match["players"][0] if len(match["players"]) > 0 else None
    tournament["current_match_id"] = match["id"]
    tournament["state"] = "match"
    _load_question(tournament, match)


def _finish_match(tournament: dict, match: dict):
    players = match["players"]
    if len(players) < 2:
        match["winner_id"] = players[0] if players else None
        match["status"] = "finished"
        tournament["current_match_id"] = None
        tournament["state"] = "bracket"
        return

    p1, p2 = players[0], players[1]
    s1 = match["scores"].get(p1, 0)
    s2 = match["scores"].get(p2, 0)
    if s1 >= 2:
        match["winner_id"] = p1
    elif s2 >= 2:
        match["winner_id"] = p2
    elif match["current_round"] >= 3:
        match["winner_id"] = p1 if s1 > s2 else (p2 if s2 > s1 else p1)
    else:
        match["winner_id"] = None

    match["status"] = "finished"
    tournament["current_match_id"] = None
    tournament["state"] = "bracket"

    if match["winner_id"]:
        all_finished = all(m.get("status") == "finished" for m in tournament.get("bracket", []) if len(m.get("players", [])) >= 2)
        if all_finished:
            tournament["winner_id"] = match["winner_id"]
            tournament["state"] = "finished"


def _build_bracket(tournament: dict):
    players = [p["id"] for p in tournament["players"]]
    random.shuffle(players)
    if len(players) < 2:
        return []
    matches = []
    for index in range(0, len(players), 2):
        pair = players[index:index + 2]
        matches.append(_make_match(f"m{index // 2 + 1}", pair, f"مباراة {index // 2 + 1}"))
    return matches


@router.post("/create")
async def create_tournament(req: CreateTournamentReq):
    code = gen_pin()
    while code in TOURNAMENTS:
        code = gen_pin()
    host_token = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    tournament = {
        "code": code,
        "host_name": req.host_name or "المقدم",
        "mode": req.mode or "classic",
        "host_token": host_token,
        "state": "lobby",
        "players": [],
        "bracket": [],
        "current_match_id": None,
        "winner_id": None,
        "created_at": now_ms(),
        "last_activity": now_ms(),
    }
    TOURNAMENTS[code] = tournament
    return {"code": code, "host_token": host_token}


@router.post("/join")
async def join_tournament(req: JoinTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    if tournament["state"] != "lobby":
        raise HTTPException(400, "البطولة بدأت بالفعل")

    categories = _categories_for_mode(tournament["mode"])
    category = next((item for item in categories if item["id"] == req.category_id), None)
    if not category:
        raise HTTPException(400, "فئة غير صالحة")

    player = {
        "id": "p" + "".join(random.choices(string.ascii_letters + string.digits, k=6)),
        "token": "".join(random.choices(string.ascii_letters + string.digits, k=12)),
        "name": req.name,
        "category_id": category["id"],
        "category_name": category["name"],
        "icon": category["icon"],
        "color": category["color"],
    }
    tournament["players"].append(player)
    tournament["last_activity"] = now_ms()
    return {"player_id": player["id"], "token": player["token"]}


@router.post("/start")
async def start_tournament(req: StartTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    if tournament["host_token"] != req.host_token:
        raise HTTPException(403, "غير مصرح")
    if len(tournament["players"]) < 2:
        raise HTTPException(400, "يجب وجود لاعبين على الأقل")

    tournament["bracket"] = _build_bracket(tournament)
    tournament["state"] = "bracket"
    tournament["current_match_id"] = None
    tournament["winner_id"] = None
    return {"ok": True, "bracket": tournament["bracket"]}


@router.post("/start-match")
async def start_match(req: StartMatchReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    if tournament["host_token"] != req.host_token:
        raise HTTPException(403, "غير مصرح")

    match = next((item for item in tournament.get("bracket", []) if item.get("id") == req.match_id), None)
    if not match:
        raise HTTPException(404, "المباراة غير موجودة")
    if match.get("status") != "pending" or len(match.get("players", [])) < 2:
        raise HTTPException(400, "لا يمكن بدء هذه المباراة")

    _start_match(tournament, match)
    return {"ok": True, "match": match}


@router.get("/{code}/state")
async def get_tournament_state(code: str):
    tournament = TOURNAMENTS.get(code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    return {
        "code": code,
        "host_name": tournament["host_name"],
        "mode": tournament["mode"],
        "state": tournament["state"],
        "players": tournament["players"],
        "bracket": tournament.get("bracket", []),
        "current_match_id": tournament.get("current_match_id"),
        "winner_id": tournament.get("winner_id"),
        "categories": _categories_for_mode(tournament["mode"]),
    }


@router.post("/answer")
async def answer_tournament(req: AnswerTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")

    match = next((item for item in tournament.get("bracket", []) if item.get("id") == tournament.get("current_match_id")), None)
    if not match or match.get("status") != "active":
        raise HTTPException(400, "لا توجد مبارزة نشطة")

    player = next((item for item in tournament["players"] if item["token"] == req.player_token), None)
    if not player:
        raise HTTPException(403, "غير مصرح")
    if player["id"] != match.get("active_player_id"):
        raise HTTPException(400, "ليس دورك")

    question = match.get("question") or {}
    correct = req.answer_idx == question.get("a")
    p1, p2 = match["players"][0], match["players"][1]

    if correct:
        match["scores"][player["id"]] = match["scores"].get(player["id"], 0) + 1
        winner_id = player["id"]
    else:
        other_id = p2 if player["id"] == p1 else p1
        match["scores"][other_id] = match["scores"].get(other_id, 0) + 1
        winner_id = other_id

    match["round_results"].append({"round": match["current_round"], "winner_id": winner_id, "correct": correct})

    if match["scores"].get(p1, 0) >= 2 or match["scores"].get(p2, 0) >= 2 or match["current_round"] >= 3:
        _finish_match(tournament, match)
        return {"ok": True, "finished": True, "winner_id": match["winner_id"]}

    match["current_round"] += 1
    match["active_player_id"] = p2 if match["current_round"] == 2 else p1
    _load_question(tournament, match)
    return {"ok": True, "finished": False, "question": match["question"]}


@router.post("/advance")
async def advance_tournament(req: AdvanceTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    if tournament["host_token"] != req.host_token:
        raise HTTPException(403, "غير مصرح")
    current = next((m for m in tournament.get("bracket", []) if m.get("id") == tournament.get("current_match_id")), None)
    if current and current.get("status") == "active":
        raise HTTPException(400, "المبارزة الحالية ليست منتهية بعد")
    for match in tournament.get("bracket", []):
        if match.get("status") == "pending" and len(match.get("players", [])) >= 2:
            _activate_match(tournament, match)
            return {"ok": True, "match": match}
    tournament["state"] = "finished"
    return {"ok": True, "finished": True}


@router.get("/{code}/state")
async def get_tournament_state(code: str):
    tournament = TOURNAMENTS.get(code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    return {
        "code": code,
        "host_name": tournament["host_name"],
        "mode": tournament["mode"],
        "state": tournament["state"],
        "players": tournament["players"],
        "bracket": tournament.get("bracket", []),
        "current_match_id": tournament.get("current_match_id"),
        "winner_id": tournament.get("winner_id"),
        "categories": _categories_for_mode(tournament["mode"]),
    }


@router.post("/answer")
async def answer_tournament(req: AnswerTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    match = next((m for m in tournament.get("bracket", []) if m.get("id") == tournament.get("current_match_id")), None)
    if not match or match.get("status") != "active":
        raise HTTPException(400, "لا توجد مبارزة نشطة")
    player = next((p for p in tournament["players"] if p["token"] == req.player_token), None)
    if not player:
        raise HTTPException(403, "غير مصرح")
    if player["id"] != match.get("active_player_id"):
        raise HTTPException(400, "ليس دورك")
    question = match.get("question") or {}
    correct = req.answer_idx == question.get("a")
    p1, p2 = match["players"][0], match["players"][1]
    if correct:
        match["scores"][player["id"]] = match["scores"].get(player["id"], 0) + 1
        winner_id = player["id"]
    else:
        other_id = p2 if player["id"] == p1 else p1
        match["scores"][other_id] = match["scores"].get(other_id, 0) + 1
        winner_id = other_id
    match["round_results"].append({"round": match["current_round"], "winner_id": winner_id, "correct": correct})
    if match["scores"].get(p1, 0) >= 2 or match["scores"].get(p2, 0) >= 2 or match["current_round"] >= 3:
        _finish_match(tournament, match)
        return {"ok": True, "finished": True, "winner_id": match["winner_id"]}
    match["current_round"] += 1
    if match["current_round"] == 2:
        match["active_player_id"] = p2
    else:
        match["active_player_id"] = p1
    _load_question(tournament, match)
    return {"ok": True, "finished": False, "question": match["question"]}
