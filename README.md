# Tower Defense: Last Stand

A mobile-first tower defense game built with vanilla JavaScript, Canvas 2D, and PWA support. No frameworks, no build step — just open the link and play.

![Status](https://img.shields.io/badge/status-playable-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![PWA](https://img.shields.io/badge/PWA-ready-purple)


Works on desktop, Android, and iOS. Installable as a PWA — works offline after the first visit.

## ✨ Features

- **50 hand-crafted levels** with unique paths, increasing difficulty, and short descriptions
- **5 tower types** — Cannon (single target), Frost (slow), Laser (instant beam), Mortar (AoE), Poison (DoT)
- **4 enemy types** — Goblin, Runner, Tank (armored), Boss (every 10th wave)
- **3 difficulty modes** — Easy (+5 lives, weaker enemies), Normal, Hard (−5 lives, stronger enemies)
- **Tower upgrades** — up to level 5, with visible DPS/range/fire-rate progression
- **Wave system** — 8 to 38 waves per level, procedurally scaled with HP multipliers
- **Level progression** — 5 levels unlocked from the start, each win unlocks the next
- **Star rating** — 1–3 stars per level based on lives lost, plus per-level high score
- **Loadout picker** — choose 4 of 5 towers before each match
- **Save system** — progress, stars, and records in `localStorage` with persistent storage API
- **Import/Export** — backup your save as a JSON file, restore on any device
- **Fullscreen mode** — one tap on mobile
- **Web Audio sounds** — procedurally generated, no audio files
- **PWA** — installable, offline-first, custom icon, fullscreen display

## 📱 Controls

| Action | Touch | Mouse |
|--------|-------|-------|
| Place tower | Tap empty cell with tower selected | Click |
| Select tower | Tap on existing tower | Click |
| Upgrade / Sell | Buttons in info panel | Same |
| Pause / Speed | Top bar buttons | Same |
| Fullscreen | Top bar `⛶` button | Same |

## 🗂 Project Structure
