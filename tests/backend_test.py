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


def test_two_player_duel_only_resolves_when_both_players_are_out_of_time():
    code = "T6"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["duel"] = {
        "attacker_id": p1["id"],
        "defender_id": p2["id"],
        "target": [0, 0],
        "category": "science",
        "question": {"q": "x", "opts": ["a", "b", "c", "d"], "a": 0},
        "started_at": server.now_ms() - 10000,
        "timeout_ms": 1000,
        "attacker_stored_time": 0.5,
        "defender_stored_time": 1.0,
        "turn": "attacker",
        "turn_start_ts": server.now_ms() / 1000.0,
        "attacker_correct_count": 0,
        "defender_correct_count": 0,
        "resolved": False,
        "winner_id": None,
    }
    game["players"] = [p1, p2]

    server.resolve_duel_if_ready(game)
    assert game["duel"]["resolved"] is False

    game["duel"]["attacker_stored_time"] = 0.0
    server.resolve_duel_if_ready(game)
    assert game["duel"]["resolved"] is False

    game["duel"]["defender_stored_time"] = 0.0
    server.resolve_duel_if_ready(game)
    assert game["duel"]["resolved"] is True


def test_two_player_start_positions_have_a_gap():
    code = "T7"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["host_token"] = "host"

    req = server.StartGameReq(code=code, host_token="host")
    asyncio.run(server.start_game(req))

    positions = [(r, c) for r, row in enumerate(game["grid"]) for c, cell in enumerate(row) if cell in {p1["id"], p2["id"]}]
    assert positions == [(2, 2), (2, 4)]


def test_sudden_death_on_expiry():
    code = "T4"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["grid"][3][3] = p2["id"]
    now_ts = time.time()
    game["duel"] = {
        "attacker_id": p1["id"],
        "defender_id": p2["id"],
        "target": [3, 3],
        "category": "science",
        "question": {"q": "x", "opts": ["a", "b", "c", "d"], "a": 0},
        "turn": "attacker",
        "turn_start_ts": now_ts - 4.0,
        "attacker_stored_time": 0.0,
        "defender_stored_time": server.FLOOR_DUEL_INIT_TIME,
        "resolved": False,
    }
    asyncio.run(server.tick(code))
    d = game.get("duel")
    assert d.get("resolved") is False

    game["duel"]["defender_stored_time"] = 0.0
    game["duel"]["started_at"] = server.now_ms() - 10000
    asyncio.run(server.tick(code))
    d = game.get("duel")
    assert d.get("resolved") is True
    assert d.get("winner_id") == p2["id"]