import asyncio
import random
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
    # defender owns target; attacker owns an adjacent cell
    game["grid"][1][1] = p2["id"]
    game["grid"][0][1] = p1["id"]

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
    game["grid"][0][1] = p1["id"]
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
    game["grid"][2][1] = p1["id"]
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
    game["grid"][0][0] = p1["id"]
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
    # penalty is elapsed thinking time + 3s, not a flat -3s
    assert d.get("attacker_stored_time") == pytest.approx(initial_stored - 3.0, abs=0.2)
    assert d.get("attacker_stored_time") < initial_stored - 3.0
    assert d.get("question") is not None
    # a wrong answer keeps the same turn and only consumes time
    assert d.get("turn") == "attacker"


def test_running_out_of_time_on_a_wrong_answer_ends_duel_immediately():
    code = "T8"
    game = make_game(code)
    p1, p2 = add_players(game)
    game["duel"] = {
        "attacker_id": p1["id"],
        "defender_id": p2["id"],
        "target": [4, 4],
        "category": "science",
        "question": {"q": "x", "opts": ["a", "b", "c", "d"], "a": 0},
        "turn": "attacker",
        "turn_start_ts": time.time() - 1.0,
        "attacker_stored_time": 2.0,
        "defender_stored_time": server.FLOOR_DUEL_INIT_TIME,
        "attacker_correct_count": 0,
        "defender_correct_count": 0,
        "resolved": False,
        "winner_id": None,
    }
    game["grid"][4][4] = p2["id"]

    wrong_idx = 1  # != d["question"]["a"]
    ans_req = server.AnswerReq(code=code, player_token=p1["token"], answer_idx=wrong_idx)
    response = asyncio.run(server.answer(ans_req))

    assert response["ok"] is True
    assert response["correct"] is False
    d = game["duel"]
    # ~1s elapsed + 3s penalty exceeds the attacker's 2s bank -> duel ends now,
    # not because "both answered wrong" and not via any global/started_at timer.
    assert d.get("resolved") is True
    assert d.get("winner_id") == p2["id"]
    assert d.get("turn") == "attacker"  # never switched; duel ended before the switch


def test_two_player_duel_resolves_as_soon_as_either_player_is_out_of_time():
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

    # attacker's own bank hits zero -> duel ends immediately, defender wins.
    # defender's bank is untouched (still has time) and must not matter.
    game["duel"]["attacker_stored_time"] = 0.0
    server.resolve_duel_if_ready(game)
    assert game["duel"]["resolved"] is True
    assert game["duel"]["winner_id"] == p2["id"]


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
        "attacker_stored_time": 0.5,
        "defender_stored_time": server.FLOOR_DUEL_INIT_TIME,
        "started_at": server.now_ms() - 10000,
        "resolved": False,
    }
    # attacker's own personal bank ran out mid-turn -> resolves immediately,
    # even though the defender's bank still has plenty of time left.
    asyncio.run(server.tick(code))
    d = game.get("duel")
    assert d.get("resolved") is True
    assert d.get("winner_id") == p2["id"]


def test_finish_duel_transfers_winner_category():
    game = make_game("T9")
    p1, p2 = add_players(game)
    p1["current_category"] = "science"
    p2["current_category"] = "history"
    game["duel"] = {
        "attacker_id": p1["id"],
        "defender_id": p2["id"],
        "target": [0, 0],
        "category": "science",
        "question": {"q": "x", "opts": ["a", "b", "c", "d"], "a": 0},
        "resolved": False,
    }

    server.finish_duel(game, p1["id"])

    assert p2["current_category"] == "science"


def test_get_random_question_uses_queue_without_repeats_until_exhausted():
    random.seed(0)
    game = make_game("T10")
    custom_questions = {
        "custom_test": [
            {"q": "q1", "opts": ["a", "b", "c", "d"], "a": 0},
            {"q": "q2", "opts": ["a", "b", "c", "d"], "a": 0},
        ]
    }

    q1 = server.get_random_question("custom_test", custom_questions=custom_questions, game=game, force_image=False)
    q2 = server.get_random_question("custom_test", custom_questions=custom_questions, game=game, force_image=False)
    q3 = server.get_random_question("custom_test", custom_questions=custom_questions, game=game, force_image=False)

    assert q1["q"] == "q1"
    assert q2["q"] == "q2"
    assert q3["q"] == "q1"


def test_flags_categories_use_flags_img():
    assert any(c["id"] == "flags_img" for c in server.FLAGS_CATEGORIES)
    assert not any(c["id"] == "capitals" for c in server.FLAGS_CATEGORIES)