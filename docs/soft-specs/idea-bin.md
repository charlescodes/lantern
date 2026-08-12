# Gameplay Idea Bin

| Field | Value |
| --- | --- |
| Status | Seed |
| Authority | Non-authoritative soft specification |
| Last reviewed | 2026-08-10 |
| Scheduling | Unprioritized; no dates, releases, or commitments |

This is the low-friction home for gameplay sparks that are worth keeping but
are not ready to become roadmap candidates. Wording stays deliberately loose.
When an idea becomes interesting enough to test, promote one bounded playable
story and leave the unrelated ideas here.

## Dungeon machinery and spatial puzzles

- **Teleporters.** Destination rules, visibility, and whether momentum carries
  through are all still open.
- **Lever-driven walls and blocks.** Wall switches, levers, or pull chains set
  big, dumb blocks in motion. Blocks could have smooth and spiked variants.
- **Moving-block race.** A block moves toward its destination, but a quick
  player can run around it and reach a secret place before it lands and changes
  or closes the route.
- **Floor spikes.** A direct ground trap that can stand alone or finish a more
  elaborate pushing trap.
- **Rotating spike column.** Pull a chain, start the column, and watch it go.
- **Spike-block hallway.** A spike block comes down a hall and threatens to
  push the player into a floor spike trap. The hidden-wall portion of this idea
  is not finished yet; preserve that loose end rather than guessing at it.
- **Fence, gate, or window boundary.** The player can see and shoot through it
  but cannot pass through it. A possible one-way-window variation needs its
  exact rule worked out.
- **Rare puzzle gong.** A big, funny `gong` punctuates an uncommon, meaningful
  solve—perhaps defeating a hard obelisk or miniboss that opens the path.
- **Force of Nature launcher.** A lever activates a fixture that shoots a FON:
  a big green ball that hurts a lot.

## Levels, creatures, and combat behavior

- **Undead level.** Build a space that makes the player's undead spells feel
  especially useful: bones, zombies, and a strong themed payoff.
- **Zombie state twist.** “Zombie lays dead unless on fire...” is a promising
  fragment whose exact wake-up, death, or fire rule still needs to be unpacked.
- **Flying creatures.** They do not set off ground traps, creating an immediate
  distinction from walking creatures.
- **Archers.** A clear ranged enemy archetype.
- **Shield enemies.** They can block incoming attacks and should be genuinely
  annoying. Their projectile awareness might reuse the same perception seam as
  enemies that see a Fireball coming and decide to dodge.
- **Rolling dodge.** A readable, physical dodge response for an enemy—or
  perhaps eventually the player.

## Spells and projectile readability

- **Electricity needs its hook.** The element wants a distinctive interaction,
  target, or environmental use; the fantasy is still open.
- **Lighted projectile trails.** Fireballs and arrows leave visible trails.
  This feels especially right for MoM, *Missiles of Magic*.
- **Bouncing spells.** A spell ricochets off walls for a fixed number of
  bounces or until its lifetime expires.

## Interesting combinations

These are connections, not requirements or architecture decisions:

- A moving block, hidden route, and floor spikes could form one timed gauntlet
  with both danger and a secret-place reward.
- Flying creatures ignoring floor spikes makes traps part of enemy matchup
  knowledge instead of universal damage buttons.
- Shield blocks and rolling dodges may eventually share projectile-threat
  observation, while keeping their reactions visibly different.
- Lit trails make ricochets legible and could turn a bouncing spell into a
  brief drawing across the room.
- Levers and chains can connect machinery, traps, route changes, and weapon
  fixtures without making every activation feel like the same wall button.

## Promotion rule

Before moving an entry into the candidate roadmap, phrase it as one playable
room, encounter, or spell experiment. Decide only the rules needed for that
slice, then identify its authoritative state, deterministic bounds, replay
impact, automated checks, and human game-feel acceptance separately.
