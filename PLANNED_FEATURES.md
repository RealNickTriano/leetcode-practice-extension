# Planned Features

Settings candidates from a design discussion on 2026-06-12, in rough order
of value-for-effort. (New cards per day, the day rollover hour, and JSON
export/import shipped the same day.)

## 1. Maximum interval cap

SM-2 intervals grow fast — after six good reviews a card is months out. For
interview prep, "everything comes back within 30 days until my interview"
is a real need.

**Implementation:** one `Math.min` in `SM2.rate()` plus a setting.

## 2. Rating overlay on/off (or scope)

The post-Accepted popup can be intrusive when re-solving a problem casually
outside review intent. A toggle like the existing reset-code switch fits
naturally.

**Variant:** currently future-scheduled cards never prompt; an "allow early
reviews" option could let solving a card ahead of schedule count as its
review instead of being ignored.

## Deliberately not planned

- **SM-2 tuning knobs** (ease modifiers, graduation intervals) — they
  invite fiddling, the defaults are battle-tested, and each knob multiplies
  the test surface.
- **Per-deck settings** — global is fine until someone asks.
