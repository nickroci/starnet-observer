# Local Observer

A standalone, read-only browser view of local Codex and Claude Code sessions, drawn as an isometric pixel-art station. Start it from your terminal, then keep working in your normal agent terminals. It shows project/repository groups, session status, available token usage, transcript inspectors, and animated llm-bus message couriers.

![Local Observer with FX on: Matrix glyph rain and pixies over the station, neon rim bloom and lit furniture on three project decks, a glowing working agent, and llm-bus messages in the mailroom](docs/observer-screenshot.jpg)

You do **not** need to install or run StarNet. The necessary observer code, shared helpers, and three crew sprite sets are included here. This is a local companion app, not a Herdr plugin installed with `herdr plugin install`.

## Dependencies

| Dependency | Purpose |
| --- | --- |
| macOS | Supported and tested platform for this initial release. |
| [Node.js](https://nodejs.org/en/download) 22.13 or newer | Runs the local server; built-in SQLite reads bus and helper-session snapshots. |
| Git | Cloning, updates, and read-only repository/worktree detection. |
| [Herdr](https://herdr.dev/docs/install/) | Discovers Codex and Claude Code agents running in Herdr panes. Start your terminal agents inside Herdr. |
| Codex CLI and/or Claude Code | Supply the sessions and their locally stored transcripts. Authenticate them normally; this observer needs no provider API keys. |
| [Python](https://www.python.org/downloads/macos/) 3.11 or newer | Reads Codex TOML configuration and verifies process identity on macOS. |
| [llm-bus](https://github.com/wnz99/llm-bus) (optional) | Supplies local agent registrations, message couriers, and message inspectors. Without it, terminal observation still works, but mail is unavailable. |
| Xcode Command Line Tools (optional) | Supplies `swiftc` for observing the Codex desktop app. Not needed for terminal-only use. |

There are no npm package dependencies. Use Node to launch it even if you normally use Bun; the readers use `node:sqlite`.

## Install the observer

After installing Node, Git, Herdr, and Python:

```sh
git clone https://github.com/wnz99/starnet-observer.git
cd starnet-observer
npm ci
npm start
```

Open **http://127.0.0.1:4319** in your browser. Keep the server terminal open. Stop with **Ctrl+C**.

You can also run `node server.js` directly. Start it from any directory with `node /path/to/starnet-observer/server.js`. If port 4319 is occupied:

```sh
PORT=4320 npm start
```

The server prints the address to open. It listens only on your own computer's loopback address.

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

Keep using those terminals normally. The browser observer refreshes about every two seconds. It reads sessions across the active Herdr inventory, not just the folder where you launched the observer.

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
npm run presentation
```

Open http://127.0.0.1:4319. This mode shows **real live activity** under a fictional company, **Helioforge**. Rooms use Product, Platform, Intelligence, and Operations; repositories use names such as `helio-web`, `helio-auth`, `helio-agents`, and `helio-console`. Additional rooms and repositories receive numbered aliases.

Labels stay stable during that server run. Actual repositories, folders, sessions, and their ownership are unchanged. Task titles, helper nicknames, worktree names, and pane labels are masked at the server boundary. Session and mail inspectors are disabled, and their API routes return no content. Live status, timestamps, token totals, and body-free message traffic remain visible.

The header explicitly says **LIVE · FICTIONAL LABELS**. Describe a shared recording as “Live agent activity with fictional company/project labels”; these labels do not represent an actual customer or employer. This is presentation masking, not a guarantee of full anonymity: activity patterns, timing, and aggregate counts are still real.

Restart with `npm start -- --no-presentation` to return to normal observation, even if your config enables masking. Do not record private terminal windows or unrelated browser tabs alongside it.

## Themes and configuration

The same observer loads JSON configuration over its built-in defaults. Themes are data files: they can set fictional labels, interface colors, and initial FX without changing the application code.

Two presets are included:

```sh
# Original interface colors, real names, simple starfield
npm start -- --config themes/basic.json

# Helioforge fictional labels, cyan interface accents, FX enabled
npm start -- --config themes/helioforge.json
```

`presentation` explicitly controls privacy masking. Colors and FX do not enable masking on their own. The Helioforge preset sets `presentation: true`; the basic preset sets it to `false`.

To make your own theme, copy the example:

```sh
cp observer.config.example.json observer.config.json
```

Edit it, then run `npm start`. `observer.config.json` next to `server.js` is loaded automatically and is Git-ignored. An explicit `--config` path instead selects that file; relative paths resolve from the directory where you run the command. The selected file replaces the automatic file, then merges with built-in defaults. Restart the server and reload the browser after edits.

The configuration fields are:

| Field | Meaning |
| --- | --- |
| `presentation` | Boolean; private labels and blocked inspectors when true. Defaults to false. |
| `company` | Company name in the presentation header. |
| `repoPrefix` | Prefix for generated repo aliases. With built-in room lists, it also updates the built-in aliases. Explicit `rooms[].repos` names stay verbatim. |
| `rooms` | Ordered room objects with `name` and optional `repos` arrays. Overrides the built-in room list. Aliases are allocated by opaque source IDs; allocation stays stable during one server run. |
| `theme.pack` | Installed data-only pack ID; omitted selects `starnet`. Restart and reload after changing it. |
| `theme.fx` | Boolean; initial sky/station FX. CLI overrides configuration; omitted defaults to off. The FX button changes the current page without browser persistence. |
| `theme.colors` | Optional interface colors: `accent`, `background`, `panel`, `text`, each a six-digit hex color. Omitted colors inherit the selected pack. These four overrides change interface colors only. |

Names must be nonempty text without control characters, at most 80 characters. Room names and explicit repo names must be unique, ignoring case. `repoPrefix` is 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit. Additional rooms/repos get unique generated names. Unknown fields, invalid values, missing explicit files, and malformed JSON stop startup instead of silently applying a different mode. Files are limited to 64 KiB.

CLI flags override the selected file:

```sh
npm start -- --presentation --company "Orbit Works" --repo-prefix orbit --no-fx
npm start -- --config themes/helioforge.json --company "My Demo Studio" --no-fx
npm start -- --no-presentation
node server.js --help
```

Use either `--presentation` or `--no-presentation`, and either `--fx` or `--no-fx`; conflicting pairs are rejected. `--company` and `--repo-prefix` customize labels but do not enable presentation mode. Port selection remains `PORT=4320 npm start`.

### Local theme packs

`theme.pack` selects one installed pack. Omit it to use `starnet`. A pack is a data-only directory at `frontend/assets/themes/<id>/theme.json`; IDs contain 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit. Installation registers the directory automatically. There is no browser picker or saved pack preference: edit configuration, restart the server, and reload the page.

For a minimal local pack, create `frontend/assets/themes/example/theme.json`:

```json
{
  "version": 1,
  "id": "example",
  "extends": "starnet",
  "ui": { "colors": { "phosphor": "#abcdef" } }
}
```

Select it with `"theme": { "pack": "example" }` in the ignored local configuration. Add your private pack directory and any private presets/references to local Git ignore rules before adding artwork. Only the canonical `starnet` pack is bundled. Validate installed directories before restarting:

```sh
npm run validate:themes
# An isolated authoring fixture can use its own public frontend root:
node scripts/validate-theme-packs.mjs /absolute/path/to/frontend
```

The author validator examines at most 16 immediate non-symlink pack directories and rejects invalid directory IDs. Startup reads only the selected pack and required default resources. A missing selected manifest stops startup. An existing selected pack with malformed data, invalid assets, or a resource-budget violation uses the complete default pack and supplies one bounded warning with requested/effective IDs. An invalid default installation stops startup. Warning metadata never contains private filesystem paths. Browser image/font decode has its own fallback checks; a valid PNG header does not prove an image can decode.

The canonical [default manifest](frontend/assets/themes/starnet/theme.json) is the complete inventory of accepted color keys and values. Unknown fields and color keys are rejected. Missing custom fields inherit the default; supplied crew groups and office art maps must be complete. Custom packs extend only `starnet`; inheritance chains, JavaScript, CSS, HTML, remote resources, authored geometry, selectors, and callbacks are not supported.

The semantic color responsibilities are:

| Inventory | Roles |
| --- | --- |
| `ui.colors` existing variable names | `bg`, `panel`, `row`, `line`, `chrome`, `phosphor`, `glow`, `alien`, `alien-dim`, `ink`, `dim`, `working`, `blocked`, `stale`, `focus`, and `tab-ink` retain the corresponding interface variable roles. |
| Interface surfaces | `body-halo`, `control-bg`, `control-hover`, `topbar-grid`, `topbar-top`, `topbar-bottom`, `panel-outline`, `panel-inset`, `toolbar-top`, `stage-bg`, `footer-bg`, `filter-hover`, `row-hover`, `row-selected`, `inspect-control-bg`, `modal-backdrop`, and `tool-bg` name background/gradient/frame surfaces. |
| Interface text and state effects | `control-ink`, `heading-ink`, `totals-ink`, `filter-ink`, `provider-ink`, `provider-claude`, `summary-ink`, and `unknown-role` name text roles. `selected-inset`, `selected-hover`, `mail-glow`, `stale-glow`, `repo-glow`, `scanline`, and `vignette` name selected/decorative effects. |
| `scene.colors` base palette | `space`, `hullTop`, `hullSeam`, `hullLeft`, `hullRight`, `wall`, `wallCap`, `grate`, `grateDark`, `window`, `amber`, `cyan`, `rail`, `console`, `consoleTop`, `chair`, `glass`, `ink`, `dim`, `focus`, and `repo` name the original station palette. |
| Scene status | `working`, `blocked`, `idle`, `done`, `unknown`, and `stale` keep status identities. Default canvas `stale` intentionally uses the blocked hue; interface `stale` remains separate. |
| Scene materials | `furnishing-*`, `rack-shelf`, `wall-screen-face`, `vent-*`, `board-*`, `tank-*`, `planter-*`, `plant-leaf`, `crate-*`, `crate-stack-*`, `walkway-support`, `hub-*`, `pod-*`, `chute-*`, `tower-*`, `observatory-*`, `telescope-shell`, `telescope-core`, `desk-*`, `monitor-*`, `chair-*`, `partition-*`, `planning-desk-*`, and `deck-*` name fixed material faces, edges, and insets. Prefixes are documentation shorthand; only exact keys in the manifest are accepted. |
| Scene lighting and sky | `star-*`, `shooting-star-*`, `plain-star`, `nebula-*`, `rain-*`, `pixie-*`, `planet-*`, `shuttle-body`, `spark`, `rim-spark`, `platform-spark`, `screen-spark`, `furniture-spark`, `vent-spark`, `tank-spark`, `mast-*`, `apron-spark`, `walkway-light-head`, `tower-spark`, `pod-spark`, `observatory-spark`, `telescope-spark`, `desk-spark`, `desk-spark-alt`, and `aura-*` name effect colors. Dynamic opacity/timing remains application-owned. |
| Scene labels, crew fallback, and mail | `glow-transparent`, `contact-shadow`, `viewer-body`, `body-outline`, `office-backdrop`, `mail-pending`, `mail-acknowledged`, `mail-unassigned`, `envelope-outline`, `envelope-mark`, `drone-shadow`, `drone-body`, `drone-wing`, `plate-scanline`, `repo-label`, `viewer-label`, `radar-sweep`, and `stale-overlay` name their individual appearance roles. |

Colors accept six-digit hex or numeric `rgba(r,g,b,a)` only: integer RGB channels 0–255 and alpha 0–1. `scene.projectAccents` contains exactly ten ordered hex colors, retaining the cobalt, teal, verdant, moss, amber, ember, crimson, orchid, violet, and indigo slot identities. Legacy `theme.colors` overrides apply last to interface colors only: accent sets phosphor/chrome and derives the `.22` alpha glow from its RGB channels; background sets bg, panel sets panel, and text sets ink. It never recolors scene or crew.

Other accepted data groups:

- `ui.typography`: fixed `classic` or `dm-sans` profile and scale 0.9–1.1. Chrome metrics belong to the application; canvas labels and numeric terminal readouts retain VT323. The `dm-sans` profile requires local `fonts/dm-sans.woff2` and `fonts/DM-Sans-OFL.txt`. Inspect the actual file's family, weights 500/600, provenance, and redistribution license before distributing it. The validator checks bounded WOFF2 structure and OFL text; browser font loading proves usability. No manifest font path or remote import is accepted.
- `ui.shapes`: `control`, `input`, `panel`, `sessionRow`, `mailRow`, `tag`, and `eyebrow` each accept four clockwise corner radii in pixels, 0–24. `badgeCut` accepts `classic` or `none`. These choices do not change hit areas or geometry.
- `ui.decor`: boolean `scanlines`, `glyphStrip`, `cornerBrackets`, and `glow`. Decorations remain separate from the scene FX toggle and functional status/focus cues.
- `ui.logo`: null or `{ "image": "branding/logo.png", "alt": "Example Brand" }`. Alt is nonempty plain text up to 80 characters. Logos use contained PNGs; rasterize source SVG before installation and retain provenance. Browser decode failure retains the original decorative mark and heading.
- `scene.art`: `{ "style": "station" }`, or `home-office` with a complete `assets` map for the 34 roles in [scene-art-roles.js](frontend/app/scene-art-roles.js). That application-owned table supplies exact native PNG dimensions, foot anchors, extents, orientation, repetition, and depth passes. Floor/corridor diamonds are 48×24; `helperChair` has its own native size for the existing 0.72 helper footprint. Authors supply `scene/*.png` paths only. Office mode requires both `backgroundFx` and `ambientFx` to be `none`; station permits `rain`/`none` and `station`/`none`, respectively. Scene effects do not supply a new initial FX preference.
- `crew`: logical IDs `blank`, `blank_blue`, and `blank_amber`. Each supplied group contains `tracks` only, with eight rotation tracks of one frame, eight walking tracks of six frames, four cardinal seated tracks of one frame, and `type.north` with four frames: 21 tracks and 64 frames. Use the exact suffixes in the default manifest and contained `crew/*.png` paths. Geometry remains fixed at scale 0.25, standing height 76, and review presentation; replacement set names derive from pack/logical IDs.

Asset paths use lowercase simple components with no schemes, leading slash, dot segments, escapes, backslashes, query, or fragment. Real-path checks prevent symlink escapes. Manifests are at most 64 KiB. Crew PNGs are exactly 144×144, at most 128 KiB each, and at most 4 MiB per pack. Selected/default fallback crew uses at most 384 unique resources and 32 MiB decoded RGBA. Scene PNGs use the exact role dimensions, at most 512×512 and 256 KiB each, at most 34 unique resources, 6 MiB file bytes, and 36 MiB decoded RGBA. Combined crew/scene decoded memory is capped at 68 MiB. Logo PNGs are at most 128 KiB and 1024×256; fonts are at most 512 KiB. Shared paths are deduplicated for budgets.

Scene art decodes as a complete set: pending or failed office art retains complete procedural station art with canonical station crew. Valid selected chrome, colors, project/mail accents, and effect modes remain selected. Crew decode failure falls back by complete logical group; active office art uses procedural human fallback bodies. Logo and font failures retain their readable local fallback. These runtime warnings are theme metadata and do not change observed source health or session status.

## Optional Codex desktop observation

Terminal users can skip this. For Codex desktop windows, install Apple's command-line tools if `swiftc` is missing:

```sh
xcode-select --install
```

The observer compiles its bundled Swift reader lazily. Grant Accessibility access to the terminal app running the server under **System Settings → Privacy & Security → Accessibility**, then restart the observer if needed. The desktop reader covers the Codex app; it does not monitor ordinary ChatGPT or Claude Desktop windows.

## Privacy and limits

- Observation is read-only: no agent launching, provider setup, message sending, acknowledgments, or session edits.
- Session and message text is read on demand when you open its inspector. Recognized credential patterns are redacted; private prose and file paths may still be visible. Share the code, not your session data.
- The local API requires a per-launch token delivered to the local page. Foreign origins and hostnames are rejected. Do not expose the server through a public proxy.
- Missing sources appear unavailable. Old data is marked stale; absence of a source is not treated as a fresh empty roster.
- macOS terminal use is the supported initial target. Other platforms are not validated; native Codex desktop observation is macOS-only.
- No cloud service, model calls, database server, or StarNet account is required.

## Update and test

Stop the observer before updating:

```sh
git pull --ff-only
npm ci
npm start
```

For the regression suite:

```sh
npm test
```

## Credits

The observer and selected sprite/runtime helpers were extracted from [StarNet](https://github.com/androoAGI/starnet), with its MIT license retained. [Herdr](https://herdr.dev/) and [llm-bus](https://github.com/wnz99/llm-bus) remain separate projects. VT323 is bundled under the SIL Open Font License; see [NOTICE.md](NOTICE.md).
