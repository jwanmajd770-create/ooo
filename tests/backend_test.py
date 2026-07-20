import asyncio
import time
import pytest

from backend import server


def make_game(code="TST"):
    game = {
        "code": code,
        "state": "active",
        "host_token": "host",
        "grid": [[None for _ in range(server.GRID_SIZE)] for _ in range(server.GRID_SIZE)],
        "players": [],
        "spectators": [],
        "current_player": None,
        "turn_idx": 0,
        "duel": None,
        "created_at": server.now_ms(),
        "last_activity": server.now_ms(),
        "winner": None,
        "sudden_death": False,
        "last_action": None,
        "pending_action": None,
        "custom_questions": {},
        "mode": "classic",
    }
    server.GAMES[code] = game
    return game


def add_players(game):
    p1 = {
        "id": "p1",
        "token": "t1",
        "name": "A",
        "category_id": "science",
        "wins": 0,
        "eliminated": False,
        "powerups": {"skip": 1, "time": 1, "eye": 1, "shield": 1},
    }
    p2 = {
        "id": "p2",
        "token": "t2",
        "name": "B",
        "category_id": "science",
        "wins": 0,
        "eliminated": False,
        "powerups": {"skip": 1, "time": 1, "eye": 1, "shield": 1},
    }
    game["players"].extend([p1, p2])
    game["current_player"] = p1["id"]
    return p1, p2


def test_initial_clock_and_duel_creation():
    code = "T1"
    game = make_game(code)
    p1, p2 = add_players(game)
    # defender owns target
    game["grid"][1][1] = p2["id"]

    req = server.AttackReq(code=code, player_token=p1["token"], row=1, col=1)
    asyncio.run(server.attack(req))
    d = game.get("duel")
    assert d is not None
    assert d.get("attacker_stored_time") == pytest.approx(server.FLOOR_DUEL_INIT_TIME)
    assert d.get("defender_stored_time") == pytest.approx(server.FLOOR_DUEL_INIT_TIME)
    assert d.get("turn") == "attacker"
    assert isinstance(d.get("turn_start_ts"), float)


def test_correct_answer_saves_clock_and_switches_turn():
    code = "T2"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["grid"][0][0] = p2["id"]
    req = server.AttackReq(code=code, player_token=p1["token"], row=0, col=0)
    asyncio.run(server.attack(req))
    d = game["duel"]
    correct = d["question"]["a"]
    time.sleep(0.05)
    ans_req = server.AnswerReq(code=code, player_token=p1["token"], answer_idx=correct)
    asyncio.run(server.answer(ans_req))
    # attacker should have less than initial time and turn switched
    assert d.get("turn") == "defender"
    assert d.get("attacker_stored_time") < server.FLOOR_DUEL_INIT_TIME
    assert isinstance(d.get("turn_start_ts"), float)


def test_pass_penalty_and_switch():
    code = "T3"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["grid"][2][2] = p2["id"]
    req = server.AttackReq(code=code, player_token=p1["token"], row=2, col=2)
    asyncio.run(server.attack(req))
    d = game["duel"]
    time.sleep(0.05)
    pass_req = server.DuelPassReq(code=code, player_token=p1["token"])
    asyncio.run(server.duel_pass(pass_req))
    assert d.get("turn") == "defender"
    assert d.get("attacker_stored_time") < server.FLOOR_DUEL_INIT_TIME


def test_wrong_answer_penalizes_and_continues_duel():
    code = "T5"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["grid"][1][0] = p2["id"]
    req = server.AttackReq(code=code, player_token=p1["token"], row=1, col=0)
    asyncio.run(server.attack(req))
    d = game["duel"]
    initial_stored = d.get("attacker_stored_time")
    correct_idx = d["question"]["a"]
    wrong_idx = (correct_idx + 1) % len(d["question"]["opts"])
    time.sleep(0.05)
    ans_req = server.AnswerReq(code=code, player_token=p1["token"], answer_idx=wrong_idx)
    response = asyncio.run(server.answer(ans_req))

    assert response["ok"] is True
    assert response["correct"] is False
    assert d.get("resolved") is False
    assert d.get("attacker_stored_time") == pytest.approx(initial_stored - 3.0)
    assert d.get("question") is not None


def test_sudden_death_on_expiry():
    code = "T4"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["grid"][3][3] = p2["id"]
    # craft duel with tiny remaining time
    now_ts = time.time()
    game["duel"] = {
        "attacker_id": p1["id"],
        "defender_id": p2["id"],
        "target": [3, 3],
        "category": "science",
        "question": {"q": "x", "opts": ["a", "b", "c", "d"], "a": 0},
        "turn": "attacker",
        "turn_start_ts": now_ts - 1.0,
        "attacker_stored_time": 0.5,
        "defender_stored_time": server.FLOOR_DUEL_INIT_TIME,
        "resolved": False,
    }
    # calling tick should resolve sudden death
    asyncio.run(server.tick(code))
    d = game.get("duel")
    assert d.get("resolved") is True
    assert d.get("winner_id") == p2["id"]