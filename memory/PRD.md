# الأرض (The Arena) - Product Requirements Document

## Original Problem Statement
اريد فكرة بناء لعبة مسابقات ثقافية او معرفية تنافسية بها مقدم ومتسابقون يلعبون اون لاين
User requested an out-of-the-box concept inspired by TV show "The Floor".

## Concept
Real-time multiplayer knowledge/strategy arena game (Arabic RTL, web + mobile responsive).
- 6x6 territory grid, each player owns squares tied to their chosen category.
- Turn-based attacks on adjacent squares → 1v1 knowledge duels.
- Last player standing wins ("king of the arena").

## User Personas
- **Host**: Creates room, gets PIN, controls game flow, advances turns.
- **Player**: Joins with PIN + name + category, competes.
- **Spectator**: Watches live board, no interaction.

## Core Requirements (implemented)
- 20 categories (Arabic/Islamic history, geography, sports, cinema, anime, tech, quran, etc.)
- 300 questions (15 per category), Arabic MCQs
- 6x6 grid, adjacency-based attacks (Manhattan distance)
- Duel timer: 12s
- Power-ups: skip question, +5s time, eye (remove one wrong option), shield (protect one cell)
- Sudden Death mode when ≤3 alive
- Spectator support
- Elimination when player loses all cells
- Every 3 wins grants a power-up refill

## Architecture
- **Backend**: FastAPI, in-memory `GAMES` dict, short polling (1s) via useGameState hook.
- **Frontend**: React 19 + Tailwind + shadcn primitives, Cairo/Tajawal fonts, dir=rtl.
- **State machine**: lobby → active → duel → active → ... → finished

## What's Implemented (Feb 2026)
- ✅ 20 categories, 300 questions in `/app/backend/questions.py`
- ✅ Room create/join/spectate endpoints
- ✅ Full duel resolution (adjacency, timer, correct/fastest wins, defender category)
- ✅ Power-ups system with count decrementation
- ✅ Sudden Death auto-trigger
- ✅ Home / Host / Player / Spectator pages
- ✅ Live 6x6 grid with owner colors, glow on current player, cell invasion animation
- ✅ Duel modal with timer, options highlight, correct/wrong feedback, power-up buttons
- ✅ Leaderboard sorted by wins
- ✅ Winner screen with trophy

## Prioritized Backlog
### P1 (Next iteration)
- WebSocket instead of polling for lower latency
- Auto-advance turn after duel_review (no host button needed)
- Persist leaderboard/stats to MongoDB
- Image-based questions (guess-the-picture)
- Confidence meter (double-or-nothing bets)

### P2 (Nice to have)
- Custom question upload by host
- More categories (kids, movies-arab, etc.)
- Player avatars
- Sound effects and background music
- Emoji reactions from spectators
- Chat/voting in spectator view
