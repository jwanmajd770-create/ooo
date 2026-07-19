from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List
import random
import string
from datetime import datetime, timezone

from questions import CATEGORIES, FLAGS_CATEGORIES
from image_questions import IMAGE_QUESTIONS
from football_data import FOOTBALL_CATEGORIES, FOOTBALL_QUESTIONS
from questions import QUESTIONS

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
    return {"q": "ما اسم العلم؟", "opts": ["أ", "ب", "ج", "د"], "a": 0}


def _build_match(match_id: str, round_num: int, players: List[str], next_match_id: Optional[str] = None):
    return {
        "id": match_id,
        "round": round_num,
        "players": players,
        "status": "pending",
        "winner_id": None,
        "scores": {},
        "round_number": 1,
        "active_player_id": None,
        "question": None,
        "history": [],
        "next_match_id": next_match_id,
    }


def _activate_match(tournament: dict, match: dict):
    if len(match["players"]) < 2:
        return
    player_ids = match["players"]
    player_lookup = tournament["player_lookup"]
    match["status"] = "active"
    match["scores"] = {player_ids[0]: 0, player_ids[1]: 0}
    match["round_number"] = 1
    match["active_player_id"] = player_ids[0]
    match["question"] = _build_question_for_round(tournament, match, 1)
    tournament["current_match"] = match


def _build_question_for_round(tournament: dict, match: dict, round_num: int):
    player_ids = match["players"]
    player_lookup = tournament["player_lookup"]
    if round_num == 1:
        category_id = player_lookup[player_ids[0]]["category_id"]
    elif round_num == 2:
        category_id = player_lookup[player_ids[1]]["category_id"]
    else:
        categories = _categories_for_mode(tournament["mode"])
        category_id = random.choice([c["id"] for c in categories if c["id"] not in {player_lookup[player_ids[0]]["category_id"], player_lookup[player_ids[1]]["category_id"]}]) if len(categories) > 2 else player_lookup[player_ids[0]]["category_id"]
    return _pick_question(category_id)


def _advance_to_next_match(tournament: dict):
    current = tournament.get("current_match")
    if current and current.get("status") == "active":
        return current
    for match in tournament.get("bracket", []):
        if match.get("status") == "pending" and len(match.get("players", [])) >= 2:
            _activate_match(tournament, match)
            return match
    return None


def _finalize_match(tournament: dict, match: dict):
    winner_id = None
    if match.get("scores"):
        player_ids = match["players"]
        s0 = match["scores"].get(player_ids[0], 0)
        s1 = match["scores"].get(player_ids[1], 0)
        if s0 >= 2:
            winner_id = player_ids[0]
        elif s1 >= 2:
            winner_id = player_ids[1]
        elif match.get("round_number", 1) >= 3:
            winner_id = player_ids[0] if s0 > s1 else (player_ids[1] if s1 > s0 else player_ids[0])
    if not winner_id and match.get("players"):
        winner_id = match["players"][0]
    match["winner_id"] = winner_id
    match["status"] = "finished"
    tournament["current_match"] = None
    if winner_id and match.get("next_match_id"):
        next_match = next((m for m in tournament.get("bracket", []) if m["id"] == match["next_match_id"]), None)
        if next_match is not None:
            if len(next_match.get("players", [])) < 2:
                next_match["players"].append(winner_id)
            if len(next_match.get("players", [])) >= 2:
                next_match["status"] = "ready"
    _advance_to_next_match(tournament)
    if not tournament.get("current_match"):
        winners = [m["winner_id"] for m in tournament.get("bracket", []) if m.get("winner_id")]
        if winners:
            tournament["winner_id"] = winners[-1]
            tournament["state"] = "finished"


@router.post("/create")
async def create_tournament(req: CreateTournamentReq):
    code = gen_pin()
    while code in TOURNAMENTS:
        code = gen_pin()
    host_token = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    tournament = {
        "code": code,
        "host_token": host_token,
        "host_name": req.host_name or "المقدم",
        "mode": req.mode or "classic",
        "state": "lobby",
        "players": [],
        "player_lookup": {},
        "bracket": [],
        "current_match": None,
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
        raise HTTPException(400, "المبارزة بدأت بالفعل")
    categories = _categories_for_mode(tournament["mode"])
    category = next((c for c in categories if c["id"] == req.category_id), None)
    if not category:
        raise HTTPException(400, "فئة غير صالحة")
    player_id = "p" + "".join(random.choices(string.ascii_letters + string.digits, k=6))
    player_token = "".join(random.choices(string.ascii_letters + string.digits, k=12))
    player = {
        "id": player_id,
        "token": player_token,
        "name": req.name,
        "category_id": category["id"],
        "category_name": category["name"],
        "icon": category["icon"],
        "color": category["color"],
    }
    tournament["players"].append(player)
    tournament["player_lookup"][player_id] = player
    tournament["last_activity"] = now_ms()
    return {"player_id": player_id, "token": player_token, "category_id": category["id"]}


@router.post("/start")
async def start_tournament(req: StartTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    if tournament.get("host_token") != req.host_token:
        raise HTTPException(403, "غير مصرح")
    if len(tournament["players"]) < 2:
        raise HTTPException(400, "يجب وجود لاعبين على الأقل")
    players = list(tournament["players"])
    random.shuffle(players)
    if len(players) == 2:
        bracket = [_build_match("m1", 1, [players[0]["id"], players[1]["id"]])]
    elif len(players) == 3:
        semifinal = _build_match("m1", 1, [players[0]["id"], players[1]["id"]], next_match_id="final")
        final = _build_match("final", 2, [players[2]["id"]], next_match_id=None)
        bracket = [semifinal, final]
    else:
        round1_matches = []
        for i in range(0, len(players), 2):
            if i + 1 < len(players):
                round1_matches.append(_build_match(f"m{i//2+1}", 1, [players[i]["id"], players[i + 1]["id"]], next_match_id="final"))
            else:
                round1_matches.append(_build_match(f"m{i//2+1}", 1, [players[i]["id"]], next_match_id="final"))
        final = _build_match("final", 2, [], next_match_id=None)
        bracket = round1_matches + [final]
    tournament["bracket"] = bracket
    tournament["state"] = "active"
    tournament["current_match"] = None
    tournament["winner_id"] = None
    _advance_to_next_match(tournament)
    tournament["last_activity"] = now_ms()
    return {"ok": True, "bracket": bracket}


@router.get("/{code}/state")
async def get_tournament_state(code: str):
    tournament = TOURNAMENTS.get(code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    categories = _categories_for_mode(tournament["mode"])
    return {
        "code": code,
        "host_name": tournament["host_name"],
        "mode": tournament["mode"],
        "state": tournament["state"],
        "players": tournament["players"],
        "bracket": tournament.get("bracket", []),
        "current_match": tournament.get("current_match"),
        "winner_id": tournament.get("winner_id"),
        "categories": categories,
    }


@router.post("/answer")
async def answer_tournament(req: AnswerTournamentReq):
    tournament = TOURNAMENTS.get(req.code)
    if not tournament:
        raise HTTPException(404, "الغرفة غير موجودة")
    match = tournament.get("current_match")
    if not match or match.get("status") != "active":
        raise HTTPException(400, "لا توجد مبارزة نشطة")
    player = next((p for p in tournament["players"] if p["token"] == req.player_token), None)
    if not player:
        raise HTTPException(403, "غير مصرح")
    if player["id"] != match.get("active_player_id"):
        raise HTTPException(400, "ليس دورك")
    question = match.get("question") or {}
    correct = req.answer_idx == question.get("a")
    player_ids = match["players"]
    opponent_id = player_ids[1] if player_ids[0] == player["id"] else player_ids[0]
    if correct:
        match["scores"][player["id"]] = match["scores"].get(player["id"], 0) + 1
        round_winner_id = player["id"]
    else:
        match["scores"][opponent_id] = match["scores"].get(opponent_id, 0) + 1
        round_winner_id = opponent_id
    match["history"].append({
        "round": match.get("round_number", 1),
        "winner_id": round_winner_id,
        "correct": correct,
        "player_id": player["id"],
    })
    if match["scores"].get(player["id"], 0) >= 2 or match["scores"].get(opponent_id, 0) >= 2:
        _finalize_match(tournament, match)
        return {"ok": True, "match_finished": True, "winner_id": match["winner_id"]}
    if match.get("round_number", 1) >= 3:
        _finalize_match(tournament, match)
        return {"ok": True, "match_finished": True, "winner_id": match["winner_id"]}
    match["round_number"] += 1
    if match["round_number"] == 2:
        match["active_player_id"] = opponent_id
    else:
        match["active_player_id"] = player["id"] if match["scores"].get(player["id"], 0) <= match["scores"].get(opponent_id, 0) else opponent_id
    match["question"] = _build_question_for_round(tournament, match, match["round_number"])
    tournament["last_activity"] = now_ms()
    return {"ok": True, "match_finished": False, "next_round": match["round_number"], "question": match["question"]}
