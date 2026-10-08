---
name: testing-practices
description: Use when writing JavaScript or TypeScript tests, debugging, verifying, or reviewing changes. Covers Vitest, browser checks, readable behavioral tests, and fresh verification evidence.
---

# Testing practices

Demonstrate the requested behavior and the failures it must prevent. Keep checks proportionate to the task and within the user's authorization.

## Write tests as examples

- Separate test-specific setup, execution of the code under test, and assertions so the test reads top to bottom.
- Use one assertion per thought. Multiple assertions are appropriate when they explain one behavior.
- Mirror conceptual source ownership in the test tree. Keep each test file focused on the conceptual part it tests.
- Use fixtures for reusable setup and teardown boilerplate. Keep behavior and important inputs visible in the test.
- Prefer readability over brevity. Duplicate setup when extraction would hide the example.
- Cover positive and negative cases. Assert that valid inputs work and invalid inputs fail loudly without corrupting state.
- Prefer tiny, representative real fixtures over mocks when practical and privacy-safe. Do not include sensitive data or load a full dataset for a small test.
- Test public methods and representative interactions first. Test a private helper separately only when its logic is non-trivial and critical.
- Assert observable behavior rather than implementation trivia. Check important values, shapes, types, invariants, and interfaces.

## Use test-driven development where it fits

Use test-driven development for deterministic, reusable code whose regression should fail continuous integration. Do not force it onto exploratory work, throwaway scripts, visual-only changes, or stochastic training and evaluation. Use the appropriate authorized evidence for those tasks.

1. Write a focused test for the required behavior or demonstrated bug.
2. Run it and confirm it fails for that behavior, not because of syntax, imports, or broken setup.
3. Make the smallest correct implementation change.
4. Run the test again and the relevant existing regression checks.
5. Refactor only within the requested scope while preserving passing tests.

Turn demonstrated bug probes, including reviewer probes, into regression tests before fixing the cause. Do not write a test that merely confirms the current implementation.

## TypeScript and game checks

- Put simulation tests beside their owner as `*.test.ts` and use Vitest. Every changed simulation rule needs a test.
- Use `npm test -- src/sim/<owner>.test.ts` for a focused simulation check, `npm run typecheck` for TypeScript, and `npm run quality` for new lint and architecture debt.
- Test Node-only tooling with the existing runner. `npm run test:quality` exercises the Git hook in disposable repositories.
- Use the world RNG for deterministic simulation fixtures. Do not substitute `Math.random()`.
- After render or game changes, run `npm run playtest -- --url <dev server>`. Follow the GPU and screenshot rules in [project guidance](../../../CLAUDE.md).
- Type assertions do not prove runtime safety. Include malformed inputs at external boundaries and test the visible failure.
- Restore spies and global state after each test. Keep fixtures small and avoid depending on test order.

## Debug the cause

- Reproduce the failure and preserve the exact input, command, and observed result.
- Compare a working case with the failing case. Trace the bad value or state to its source.
- Test one hypothesis at a time before changing the implementation.
- Fix the cause rather than adding a fallback, suppressing the error, or weakening the check.
- If repeated attempts do not converge, stop and reassess the approach before adding more patches.

## Verify with fresh evidence

- Map each requirement to the cheapest sufficient existing evidence. Prefer native runners, gradient logs, focused tests, and checkpoint comparisons.
- Add custom instrumentation only for a named missing observation. Keep instrumentation outside the native checkpoint and resume lifecycle.
- Keep evidence packaging and style-only checks off the experiment's critical path. Record skipped checks. Do not skip checks protecting behavior, data, or secrets.
- Derive focused checks from the requested behavior, negative cases, invariants, and component interfaces.
- Run relevant tests after the final change. Earlier passing output does not verify later edits.
- Exercise a representative full path when feasible within the approved scope. Check the resulting data or state, not just a successful exit.
- Use the project's existing test and lint commands. Do not run expensive jobs or add trial runs without the required approval.
- Report what ran, what passed or failed, and what remains untested. Never replace an unavailable check with a claim of success.
- For documented repairs, apply the exact-command and disposable-fixture requirements in [project guidance](../../../CLAUDE.md).

## Review independently

Review the contract and diff without relying on the implementer's rationale as proof. Use independent review when the approved workflow calls for it.

For each finding, check whether it is technically true and whether an existing safeguard already addresses it before editing. Apply the global scope rule to confirmed findings. Report unrelated defects without fixing them.

Finish only when the authorized checks are complete and no demonstrated in-scope failure remains, or report the specific blocker and next action. Passing tests does not replace the ownership review in [Responsibility-driven design](../responsibility-driven-design/SKILL.md).
