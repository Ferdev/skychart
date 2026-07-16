# Rondar Task Plan

Task: Explain a bit, in simple terms, how this app works?
Task ID: 889
Linear ID: SESSION-0667a944
Branch: task-SESSION-0667a944
Status: starting

PROJECT CONTEXT:
- Summary: Cosmic Atlas: Cosmic Atlas is a scientific 2D celestial atlas. It renders Solar System bodies, confirmed exoplanet host systems, Hipparcos bright stars, Gaia physical-map stars, JPL small bodies, DESI DR1 galaxies and quasars, SIMBAD extragalactic objects, BASS DR2 black-hole mass records, nearby stars, Messier deep-sky objects, and the generated OpenNGC NGC/IC deep-sky catalog in one heliocentric ecliptic coordinate space so they can be searched, inspected, centered, measured, and compared.
- Project: skychart id 19
- Repository: https://github.com/Ferdev/skychart.git
- Base branch: trunk
- Task branch: task-SESSION-0667a944
- Setup status: completed
- Snapshot image: rondar/production-project-19:ready
- Tech stack: javascript, node

RUNTIME CONTRACT:
- Project root: /app inside an isolated task container; the task branch is checked out there.
- Assistant launch cwd: /tmp so repository-owned agent instruction files such as AGENTS.md, CLAUDE.md, .claude/, .codex/, and .rondar/agent/ are ignored. Run project commands with `cd /app && ...` or `git -C /app ...`.
- Toolchain: HOME=/home/dev and PATH starts with /home/dev/.local/share/mise/shims, so project binaries installed by setup/mise should run by normal names.
- Tool fallback: if a project binary is still missing, inspect `mise ls` or run `mise exec -- <command>` before changing tracked config.
- Env file: source `/app/.env.rondar` for native library variables when running commands manually.
- Base binaries: bash, git, curl, wget, sudo, node, npm, ruby, bundle, mise, codex.
- Not guaranteed: Docker daemon/CLI, GitHub CLI (`gh`), or external services unless the project config/env exposes them.
- GitHub fetch/push credentials are intentionally not available in the task shell. Use Rondar's branch/PR MCP tools (`list_project_branches`, `list_project_pull_requests`, `fetch_project_branch`, `fetch_pull_request_head`, `push_project_branch`, `create_project_branch`, `delete_project_branch`, `create_pull_request`, `update_pull_request`, `close_pull_request`, `reopen_pull_request`, `merge_pull_request`, `update_pull_request_branch`) so Rondar performs GitHub operations through the server-side integration.


## Description

can you explain a bit, in simple terms, how this app works? database, tiles, catalogue, etc.

## Agents

- Agent 332: general (pending)

## Coordination

Read `/app/.rondar/coordination.json` for the current shared agent state.
No planner agent is assigned. Use this starter plan plus coordination.json and the task description.
