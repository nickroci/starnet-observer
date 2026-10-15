# Local Observer

A standalone browser view of local Codex and Claude Code sessions, read-only by default, drawn as an isometric pixel-art station. Start it from your terminal, then keep working in your normal agent terminals. It shows project/repository groups, session status, available token usage, transcript inspectors, and animated llm-bus message couriers.

![Local Observer with FX on: Matrix glyph rain and pixies over the station, neon rim bloom and lit furniture on three project decks, a glowing working agent, and llm-bus messages in the mailroom](docs/observer-screenshot.jpg)

You do **not** need to install or run StarNet. The necessary observer code, shared helpers, and three crew sprite sets are included here. This is a local companion app, not a Herdr plugin installed with `herdr plugin install`.

## Dependencies

| Dependency | Purpose |
| --- | --- |
| macOS | Supported and tested platform for this initial release. |
| [Bun](https://bun.sh/) 1.3.13 or newer | Runs the local server; native SQLite reads bus and helper-session snapshots. |
| Git | Cloning, updates, and read-only repository/worktree detection. |
| [Herdr](https://herdr.dev/docs/install/) | Discovers Codex and Claude Code agents running in Herdr panes. Start your terminal agents inside Herdr. |
| Codex CLI and/or Claude Code | Supply the sessions and their locally stored transcripts. Authenticate them normally; this observer needs no provider API keys. |
| [Python](https://www.python.org/downloads/macos/) 3.11 or newer | Reads Codex TOML configuration and verifies process identity on macOS. |
| [llm-bus](https://github.com/wnz99/llm-bus) (optional) | Supplies local agent registrations, message couriers, and message inspectors. Without it, terminal observation still works, but mail is unavailable. |
| Xcode Command Line Tools (optional) | Supplies `swiftc` for observing the Codex desktop app. Not needed for terminal-only use. |

There are no package dependencies. Bun runs the server and regression suite; its native `bun:sqlite` reads private database snapshots. No Node executable is required.

Bun emits no lockfile for this empty dependency graph. `bun install --frozen-lockfile` still verifies the dependency-free installation.

## Install the observer

After installing Bun, Git, Herdr, and Python:

```sh
git clone https://github.com/wnz99/starnet-observer.git
cd starnet-observer
bun install --frozen-lockfile
bun run start
```

Open **http://127.0.0.1:4319** in your browser. Keep the server terminal open. Stop with **Ctrl+C**.

You can also run `bun --no-env-file server.js` directly. Start it from any directory with `bun --no-env-file /path/to/starnet-observer/server.js`. If port 4319 is occupied:

```sh
PORT=4320 bun run start
```

The server prints the address to open. It listens only on your own computer's loopback address.

Supported commands disable implicit `.env` loading, including when launched from another directory. Shell-exported settings such as `PORT` and `HERDR_SOCKET_PATH` still apply. JSON application configuration is described below.

## Start terminal agents with Herdr

Install Herdr using its [official installation guide](https://herdr.dev/docs/install/). On macOS with Homebrew:

```sh
brew install herdr
```

In a separate terminal, start Herdr in the project you want to observe:

```sh
cd /path/to/your/project
herdr
```

Launch `codex` or `claude` inside a Herdr pane. Check discovery from another terminal:

```sh
herdr agent list
```

Keep using those terminals normally. The browser observer refreshes about every two seconds. Verified repository rooms appear first; transcript summaries, helpers, desktop windows, and bus metadata fill in independently. It reads sessions across the active Herdr inventory, not just the folder where you launched the observer.

For a named/non-default Herdr server, launch the observer with `HERDR_SOCKET_PATH` set to that server's Unix socket. The default is `~/.config/herdr/herdr.sock`.

### Codex session identity

The observer requires a proven session identity before showing a transcript. It uses Herdr's published identity when available. A fallback reads the Codex terminal footer through the local Herdr socket only when Codex explicitly configures `thread-id` as the **first** status-line field.

If Codex panes appear but their transcript inspector is unavailable, check your Codex configuration (`~/.codex/config.toml`, or `$CODEX_HOME/config.toml`). Merge this field into your existing `[tui]` table; do not duplicate the table or overwrite other settings:

```toml
[tui]
status_line = ["thread-id"]
```

Keep any other status-line fields after `thread-id`, then restart the affected Codex pane. Python 3.11+ and an accessible local Herdr socket are needed for this fallback. An unresolved identity stays unavailable rather than opening a guessed session.

## Enable llm-bus mail and couriers

[llm-bus](https://github.com/wnz99/llm-bus) is a separate local mailbox for Claude Code and Codex. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first. Close your Codex and Claude Code sessions before installing its hooks:

```sh
git clone https://github.com/wnz99/llm-bus.git
cd llm-bus
uv tool install --from . llm-bus
llm-bus install
```

Restart your agents. In Codex, review and trust the bus hooks in `/hooks`, as described in the [bus README](https://github.com/wnz99/llm-bus#install-and-verify). If the command is missing, run `uv tool update-shell` and open a new terminal.

Run `llm-bus whoami` through each agent's shell tool to confirm registration. Agents use `llm-bus send` to exchange messages; the observer visualizes that traffic. It never sends, acknowledges, or wakes agents itself.

The observer reads the default macOS mailbox at `~/.local/share/llm-bus/bus.sqlite3`. If you use a custom bus database, set `LLM_BUS_DB` to the same database file when launching it. The bus must have actual messages for couriers to appear.

## Record a presentation with fictional company names

For a screen recording, stop the normal server and start:

```sh
bun run presentation
```

Open http://127.0.0.1:4319. This mode shows **real live activity** under a fictional company, **Helioforge**. Rooms use Product, Platform, Intelligence, and Operations; repositories use names such as `helio-web`, `helio-auth`, `helio-agents`, and `helio-console`. Additional rooms and repositories receive numbered aliases.

Labels stay stable during that server run. Actual repositories, folders, sessions, and their ownership are unchanged. Task titles, helper nicknames, worktree names, and project/repository labels are masked at the server boundary. Paths and raw process details are omitted. Real Herdr pane IDs remain visible so optional controls target the correct panes. Session and mail inspectors are disabled, and their API routes return no content. Live status, timestamps, token totals, and body-free message traffic remain visible.

The header explicitly says **LIVE · FICTIONAL LABELS**. Describe a shared recording as “Live agent activity with fictional company/project labels”; these labels do not represent an actual customer or employer. This is presentation masking, not a guarantee of full anonymity: activity patterns, timing, and aggregate counts are still real.

Restart with `bun run start --no-presentation` to return to normal observation, even if your config enables masking. Do not record private terminal windows or unrelated browser tabs alongside it.

## Themes and configuration

The same observer loads JSON configuration over its built-in defaults. Themes are data files: they can set fictional labels, interface colors, and initial FX without changing the application code.

Two presets are included:

```sh
# Original interface colors, real names, simple starfield
bun run start --config themes/basic.json

# Helioforge fictional labels, cyan interface accents, FX enabled
bun run start --config themes/helioforge.json
```

`presentation` explicitly controls privacy masking. Colors and FX do not enable masking on their own. The Helioforge preset sets `presentation: true`; the basic preset sets it to `false`.

To make your own theme, copy the example:

```sh
cp observer.config.example.json observer.config.json
```

Edit it, then run `bun run start`. `observer.config.json` next to `server.js` is loaded automatically and is Git-ignored. An explicit `--config` path instead selects that file; relative paths resolve from the directory where you run the command. The selected file replaces the automatic file, then merges with built-in defaults. Restart the server and reload the browser after edits.

The configuration fields are:

| Field | Meaning |
| --- | --- |
| `presentation` | Boolean; private labels and blocked inspectors when true. Defaults to false. |
| `company` | Company name in the presentation header. |
| `repoPrefix` | Prefix for generated repo aliases. With built-in room lists, it also updates the built-in aliases. Explicit `rooms[].repos` names stay verbatim. |
| `rooms` | Ordered room objects with `name` and optional `repos` arrays. Overrides the built-in room list. Aliases are allocated by opaque source IDs; allocation stays stable during one server run. |
| `theme.fx` | Boolean; initial sky/station FX. The standard interface starts with FX off on every page load unless set here or overridden with `--fx` or `--no-fx`. The FX button changes effects for the current visit; its choice is not saved. |
| `theme.colors` | Optional interface colors: `accent`, `background`, `panel`, `text`, each a six-digit hex color. Omitted colors use the original defaults. The station geometry, crew sprites, and observed status colors keep their original styling. |

Names must be nonempty text without control characters, at most 80 characters. Room names and explicit repo names must be unique, ignoring case. `repoPrefix` is 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit. Additional rooms/repos get unique generated names. Unknown fields, invalid values, missing explicit files, and malformed JSON stop startup instead of silently applying a different mode. Files are limited to 64 KiB.

CLI flags override the selected file:

```sh
bun run start --presentation --company "Orbit Works" --repo-prefix orbit --no-fx
bun run start --config themes/helioforge.json --company "My Demo Studio" --no-fx
bun run start --no-presentation
bun --no-env-file server.js --help
```

Use either `--presentation` or `--no-presentation`, and either `--fx` or `--no-fx`; conflicting pairs are rejected. `--company` and `--repo-prefix` customize labels but do not enable presentation mode. Port selection remains `PORT=4320 bun run start`.

## Optional Codex desktop observation

Terminal users can skip this. For Codex desktop windows, install Apple's command-line tools if `swiftc` is missing:

```sh
xcode-select --install
```

The observer compiles its bundled Swift reader lazily. Grant Accessibility access to the terminal app running the server under **System Settings → Privacy & Security → Accessibility**, then restart the observer if needed. The desktop reader covers the Codex app; it does not monitor ordinary ChatGPT or Claude Desktop windows.

## Optional control actions

The observer is read-only by default. Launch it with `OBSERVER_CONTROL=1` to enable three Live sessions actions and the station’s overseer launcher. The three panel actions send only a real pane ID already shown on the page:

```sh
OBSERVER_CONTROL=1 bun run start
```

| Button | Where | What it does |
| --- | --- | --- |
| `+` | project heading | Uses a fresh Herdr session in the group as a seed, opens a tab in its workspace and current folder, starts `claude`, and opens an attached Terminal window. |
| `⇱` | session row | Opens a Terminal window attached to that pane with `herdr agent attach --takeover`, so it takes input even if another terminal was attached. Detach with `ctrl+b q`; the agent keeps running. |
| `✕` | session row | Closes the Herdr pane, ending that agent. The page asks you to confirm first. |

Agents are grouped on the station by project (one deck), then by repository and sub-folder (one walled section per folder, with its own sign); idle agents stroll inside their own section whenever another agent from the same folder is there too. Linked Git worktrees share their main repository group; sub-folders are calculated relative to the checkout where each agent is working.

Clicking the **OBSERVATORY** sign on the station selects the overseer if one is running, or offers to start one. Choose **Claude** (the default) or **Codex**, then select **Start**; **Cancel** leaves sessions unchanged. Provider selection applies only to the overseer.

The overseer is an ordinary session of the selected provider in a Herdr workspace named `overseer`, started in `~/.local/share/starnet-observer/overseer` with matching initial `AGENTS.md` and `CLAUDE.md` briefs on using Herdr and llm-bus to watch and coordinate the other agents. Each missing file is created exclusively; existing files and divergent user edits remain untouched. Edit the appropriate file to change its standing orders; the observer never synchronizes them. The observer recognizes only its verified, persisted overseer launch, even after a rename or observer restart; names, titles, and agent configuration do not establish that role.

The private launch record is `~/.local/share/starnet-observer/overseer/identity.json`, written with mode `0600`. It binds the overseer to the Herdr endpoint, pane, workspace, terminal incarnation, provider, and native session ID when available. One shared launch reservation prevents concurrent observer processes from creating duplicate overseers. Uncertain launch state, corrupt records, or mismatched identity proof leave the overseer unavailable and block a replacement. A last-known overseer may remain visible with stale status; that does not authorize control actions.

After a caught launch failure, a later request can release a recorded reservation only after a complete Herdr agent inventory omits that pane and Herdr returns the exact `pane_not_found` error for it. A crash can leave the exclusive `~/.local/share/starnet-observer/overseer/identity.json.owner` directory behind. Stop every observer process using this state and verify through Herdr that no launch or recorded pane remains active before inspecting it manually. Only an empty, confirmed abandoned owner directory may be removed manually; never recursively delete the state directory or steal an uncertain lock. Nonempty locks, missing pane records, or uncertain Herdr results require manual inspection; restarting alone does not guarantee recovery.

One overseer is shared across providers; choosing another provider never replaces a running overseer. Project `+` continues to launch Claude. Separate worktree sections are deferred.

Set `OBSERVER_CLAUDE_ARGS` to pass flags only to spawned Claude sessions (including a Claude overseer), for example `OBSERVER_CLAUDE_ARGS="--dangerously-skip-permissions"`. Terminal launching uses macOS Terminal.app.

The control routes are `POST`-only and require the same per-launch token and local origin as the read routes. Attach, spawn, and close require a current private observer target proof, then matching live Herdr inventory, agent, and pane identities. Stale, unavailable, foreign, or reused targets are rejected before mutation. Without `OBSERVER_CONTROL=1`, the server rejects every non-GET request and omits the panel action buttons.

Controls also work in presentation mode with `OBSERVER_CONTROL=1 bun run presentation`. Fictional labels remain in place; requests use real pane IDs. Control responses omit private names, paths, endpoint details, and raw process errors. Presentation mode still disables inspectors and transcript preparation; it does not make live actions anonymous.

## Privacy and limits

- Observation is read-only unless you opt in with `OBSERVER_CONTROL=1`: no agent launching, provider setup, message sending, acknowledgments, or session edits. With control on, the page can start, attach to and close Herdr agent panes, and nothing else.
- The server may prepare bounded, redacted transcript projections locally in memory before you open an inspector: at most 32 identities per enrichment sweep, with two background detail jobs at once. Opening an inspector still checks current session ownership and source contents. Message bodies and desktop text remain on demand; presentation mode disables transcript preparation. Recognized credential patterns are redacted; private prose and file paths may still be visible. Share the code, not your session data.
- The local API requires a per-launch token delivered to the local page. Foreign origins and hostnames are rejected. Do not expose the server through a public proxy.
- Missing sources appear unavailable. Old data is marked stale; absence of a source is not treated as a fresh empty roster.
- macOS terminal use is the supported initial target. Other platforms are not validated; native Codex desktop observation is macOS-only.
- No cloud service, model calls, database server, or StarNet account is required.

## Update and test

Stop the observer before updating:

```sh
git pull --ff-only
bun install --frozen-lockfile
bun run start
```

For the regression suite:

```sh
bun run test
```

## Credits

The observer and selected sprite/runtime helpers were extracted from [StarNet](https://github.com/androoAGI/starnet), with its MIT license retained. [Herdr](https://herdr.dev/) and [llm-bus](https://github.com/wnz99/llm-bus) remain separate projects. VT323 is bundled under the SIL Open Font License; see [NOTICE.md](NOTICE.md).
