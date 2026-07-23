# Dynamic Contact Velocity Channels

> **Status:** current physics regression contract
>
> **Applies to:** player contact with rocks and future dynamic-object pools
>
> **Corrected:** 2026-07-23

The player has two velocity channels whose sum is the integrated velocity:

```text
locomotionVelocity = control-driven acceleration and braking
externalVelocity   = explosion and genuine dynamic-body momentum
totalVelocity      = locomotionVelocity + externalVelocity
```

Player–dynamic-body contact must preserve that ownership. Body and player external
momentum resolve first with the configured body restitution and friction, and the
player reaction stays in `externalVelocity`. Any unresolved closure caused by the
movement controller resolves with zero restitution, and its player reaction stays
in `locomotionVelocity`. Both stages still transfer inverse-mass-weighted impulse
to the dynamic body.

Each stage is capped by the unresolved total contact velocity. Co-moving or
separating bodies therefore cannot manufacture an impact from opposing values in
the two player channels. Tangential friction follows the same source channel as
its normal response.

This prevents held movement against a resistant body from accumulating an equal
and opposite external velocity that appears as recoil when movement is released.
It does not suppress real knockback: an independently moving or
explosion-launched rock still changes `externalVelocity`, and direct explosion
impulse remains external.

The allocation-free
`src/sim/dynamic_body_velocity.js#resolvePlayerDynamicBodyVelocity` helper owns
this contract for player contact with every dynamic-object pool. Rock contact
continues to own penetration correction and contact recording separately.

## Compatibility

- Application/package release is 0.3.1.
- Canvas2D and 3D consume the corrected authoritative snapshot without renderer changes.
- Snapshot and command-recording schema remains v4.
- Scenario schema remains v2.
- Existing recordings replay through the current solver; they are not promised to reproduce the former stored-recoil bug.
- The historical 0.1.0 milestone remains unchanged.

## Regression checks

- Holding movement into small, medium, and large rocks does not grow external velocity.
- Releasing movement produces less than `0.01m` of backward travel.
- Rock displacement retains the small > medium > large ordering.
- Independently incoming rocks and explosion-launched rocks still produce damped external knockback.
- Co-moving contacts do not create phantom impulses.
- Current-build contact-heavy command recordings replay to identical final state.

For a perceptual check in both renderers, press the player against every rock
size, release RMB, and inspect the external-velocity vector. It should remain
absent for controller-only contact, then appear when a moving rock shoves the
player.
