---
name: responsibility-driven-design
description: Use before designing, planning, implementing, refactoring, or reviewing JavaScript or TypeScript. Assign one owner to each concept, organize by component, and justify abstractions with current needs.
---

# Responsibility-driven design

Make the source tree explain the system. Decide what each component, file, and object must know and do before choosing its implementation.

## Plan by ownership

A component has a responsibility and a dependency boundary. A concern is behavior and state that change together under one owner. A type, helper, or algorithm step does not by itself need a separate file.

For a non-trivial feature, extraction, or refactor, include these in the plan before implementation:

- The final source tree for the affected components.
- The key entities and their relationships.
- The allowed dependency directions between components.
- One sentence per added or changed file: `<file> owns <responsibility>`.
- The current need for each new abstraction.

Give every concept one natural owner. For trivial changes, identify the owner without creating a full planning document.

## Keep behavior with its owner

- Package by component, then divide each component by cohesive responsibility.
- Put behavior on the object that owns the state or knowledge it needs. Derived state and display values can be properties of that object.
- Use a class for state with a lifecycle or related behavior. Use functions for stateless transformations and ordered process stages.
- Separate queries from state-changing commands. Keep dependencies and side effects explicit at the boundary.
- Keep private request types and helpers beside the public entry point they support.
- Give a file its own place when it represents a stable concern that callers can name and find. Merge supporting code into its owner when no independent concern exists.
- Treat file and function size as review signals, not splitting thresholds. Split independent concerns, not symbol kinds or line counts.
- Use names that state the concern. Names such as `manager`, `types`, or `utils` need a precise ownership sentence to justify them.

For example, `ServerStatus.state` derives status from the object that owns the observations. `ServerLifecycle.start()` operates on the object that owns startup and its dependencies. Private startup helpers stay beside that lifecycle.

## Share only the same concept

- Keep each piece of logic in one place and route its consumers through its owner. Share meaning and behavior, not superficial similarity.
- Put a concept in `common` only when peer components need the same concept and neither can own it without reversing an allowed dependency. `common` must not import an owning component.
- Do not reach into another component's private helpers. Expose the required behavior through its public boundary.
- Add an interface, protocol, base class, factory, or adapter only for current variants or a real dependency boundary. Use a concrete collaborator when one implementation suffices.
- Do not replace concrete collaborators with an object containing generic callable fields. The owner exposes the operation as a method.
- Use the fewest useful files, classes, and functions. Do not add compatibility paths, configuration switches, or extension points for imagined future needs.

## Make failures diagnosable

- Follow the global configuration and fail-fast rules. Keep required inputs explicit and validate them at the boundary.
- For persisted state, keep writes atomic and units restartable where the task requires them. Expose progress and failures at meaningful boundaries.
- Keep related code together and unrelated concerns separate. Code holds no comments except a module docstring of up to 3 lines. Put hidden constraints in names, tests or docs.

## TypeScript boundaries

- Keep game rules and world state in `src/sim/` as plain TypeScript. Do not import Three.js, Rapier, rendering, audio, or UI there.
- Keep balance and content in `src/data/`. Rendering reads state and must not own game rules.
- Use `import type` for type-only dependencies. A type import must still respect the component boundary.
- Prefer a discriminated union for a closed set of commands or states. Add an interface only for a present dependency boundary.
- Follow [project guidance](../../../CLAUDE.md) for the existing owners before adding a module.

## Review the changed component

Before declaring completion, inspect every file in each changed component as well as the diff. Check that:

- Every concept has one owner and each file represents a required concern.
- Functions, classes, constants, and types live with that owner.
- Peer components do not duplicate concepts or import each other's internals.
- Each abstraction serves a present need.
- Tests mirror source ownership and enforce important dependency boundaries, following [Testing practices](../testing-practices/SKILL.md).

Passing tests does not prove good design. Report unresolved ownership or dependency problems. Fix only defects within the request and report unrelated defects without changing them.
