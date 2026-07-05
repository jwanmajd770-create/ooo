from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
import os
import uuid


async def save_game_result(db, game):
    """Persist finished game + update all-time leaderboard aggregations."""
    result = {
        "id": str(uuid.uuid4()),
        "code": game["code"],
        "host_name": game.get("host_name"),
        "winner_id": game.get("winner"),
        "winner_name": None,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "players": [],
    }
    for p in game["players"]:
        cells = sum(1 for r in game["grid"] for c in r if c == p["id"])
        entry = {
            "player_id": p["id"],
            "name": p["name"],
            "category_id": p["category_id"],
            "category_name": p["category_name"],
            "icon": p["icon"],
            "color": p["color"],
            "wins": p.get("wins", 0),
            "cells": cells,
            "eliminated": p.get("eliminated", False),
            "is_winner": p["id"] == game.get("winner"),
        }
        result["players"].append(entry)
        if entry["is_winner"]:
            result["winner_name"] = p["name"]

    await db.games.insert_one(result)

    # Update per-player aggregate stats keyed by name (simple; no auth)
    for p in result["players"]:
        await db.player_stats.update_one(
            {"name": p["name"]},
            {
                "$inc": {
                    "games_played": 1,
                    "total_wins": p["wins"],
                    "victories": 1 if p["is_winner"] else 0,
                    "total_cells": p["cells"],
                },
                "$set": {
                    "last_played": result["finished_at"],
                    "last_icon": p["icon"],
                    "last_color": p["color"],
                },
                "$setOnInsert": {"name": p["name"], "created_at": result["finished_at"]},
            },
            upsert=True,
        )


async def get_hall_of_fame(db, limit=20):
    cursor = db.player_stats.find({}, {"_id": 0}).sort([("victories", -1), ("total_wins", -1)]).limit(limit)
    return await cursor.to_list(length=limit)


async def get_recent_games(db, limit=20):
    cursor = db.games.find({}, {"_id": 0}).sort("finished_at", -1).limit(limit)
    return await cursor.to_list(length=limit)
