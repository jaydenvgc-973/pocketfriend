# Verification Protocol — Observation Only

> This protocol binds all verification work in this project. Verification is part of the assignment and receives no additional permissions beyond implementation. It is never another production writer.

## Permanent Rules

Verification shall NEVER:

- Modify the isolated test character.
- Create, edit, reset, restore, or delete protected production data.
- Force state transitions to manufacture evidence.
- Trigger production behavior solely to prove a correction.
- Write canonical state during verification.
- Repair data discovered during verification unless that repair is explicitly authorized by the assignment.

## Sanctioned Observation Path

All verification observation must route through `observeVerificationState` — a structurally read-only backend function. Its body contains zero write operations (no `update`, `create`, `delete`, `bulkCreate`, `bulkUpdate`, `updateMany`, `deleteMany`). It cannot modify any production state by construction.

Verification must NOT use `exec_tool` or `test_backend_function` to observe or prove state when those paths can write. If a verification step requires anything beyond a read, it is out of scope unless explicitly authorized.

## When Proof Cannot Be Collected

If proof of a correction requires a protected write (forcing a transition, altering the test character, manufacturing state), verification must STOP and report that proof cannot be obtained within the authorized scope. It must NOT perform the write.

## Discovery Is Not Authorization

Finding a defect during verification does not authorize repairing it. Report the finding; await explicit assignment authorization before any write. Drifting from the original assignment into a newly discovered defect is forbidden — the original assignment scope controls.

## Verification Is Bound by Assignment Scope

Verification does not receive extra permissions because it is "verifying." It is bound by the exact same authorization limits as implementation. If the assignment says observation only, verification is observation only.

## Failure Mode (Forbidden)

- Treating verification as exempt from assignment scope restrictions.
- Substituting a verification report for the requested methodology correction.
- Inspecting production data, running tests, or gathering evidence when the assignment is to correct the process — not to perform verification.
- Beginning verification before the methodology correction is in place.

## Enforcement

This protocol is enforced structurally by `observeVerificationState` (read-only by construction) and procedurally by routing all future verification observation through it. Any verification that writes protected production state without explicit authorization is a defect.