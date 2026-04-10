# Notyfai CLI

**npm package:** [notyfai](https://www.npmjs.com/package/notyfai) — that is the canonical package name for installs (`npx notyfai`, `npm install -g notyfai`).

Monorepo:

- **`notyfai`** (`packages/cli`) — sources for the package above. Run:

  ```bash
  npx notyfai setup
  ```

  Global install also registers the `notyfai-cli` command name (same binary as `notyfai`).

- **`@notyfai-cli/templates`** (`packages/templates`) — optional standalone `.sh` copies for vendoring.

## Development

```bash
npm install
```

```bash
cd packages/cli && node bin/notyfai.mjs --help
```

## Publish (maintainers)

Publish **only** the `notyfai` package (from repo root: `notyfai-cli-workspace` is private and is not published):

```bash
cd packages/cli && npm publish --access public
```

Optional: `cd packages/templates && npm publish --access public`

Do **not** publish a separate `notyfai-cli` npm package from this repo; `npx notyfai` and the `notyfai` package are the supported install path. npm may also block republishing the same version within 24 hours if a publish fails mid-way.

## Usage

From the Notyfai app, generate a CLI setup key, then in your repo root:

```bash
export NOTYFAI_API_URL="https://<project>.supabase.co/functions/v1/api"
export NOTYFAI_SETUP_KEY="<one-time key>"
npx notyfai setup -y --agent=cursor
```

Use `--agent=` with `cursor`, `claude`, `codex`, `windsurf`, `copilot`, or `gemini`. Omit it to use the agent stored for your Notyfai project. `NOTYFAI_AGENT` env is an alias for `--agent`.

## Troubleshooting

If `npx` prints **could not determine executable to run**, you are probably inside an npm project whose **`package.json` `"name"` is `notyfai`** but that package does not define `bin`. npm then picks the local project instead of the registry CLI. Rename that local package (for example to `notyfai-backend`), run from another directory, or use `npx --yes -p notyfai notyfai setup`.
