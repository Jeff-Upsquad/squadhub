# Squad Bots extraction

Canonical source: sibling `../squad-bots`. The Squad Hub admin UI, authentication, permissions, channel UI host adapters, and historical migration history remain here. All bot implementations are imported from `@squad-bots/core`.

For a fresh checkout, also check out the Squad Bots product as a sibling, install/build it, then run `npm install --install-links --legacy-peer-deps` here. After core changes, run `npm run sync:squad-bots`; the main `dev` and `build` commands do this automatically. The local app is http://localhost:3020.

Production dashboard: https://bots.squadhub.in. Private source: https://github.com/Jeff-Upsquad/squad-bots. Hub pins the shared core SHA in `squad-bots.ref`; update it through a PR for core upgrades. CI checks out the private sibling repository using `SQUAD_BOTS_REPOSITORY` and the read-only `SQUAD_BOTS_SSH_KEY` secret. Docker builds require the sibling named context, and the deployment script fetches the pinned revision into `/opt/squad-bots`.

See the sibling product's `README.md` and `docs/integration.md` for the architecture, database upgrade, connection payloads, and deployment setup. The deployment script preserves VPS-only Caddy site blocks through a three-way merge and stops before modifying live files if it cannot merge safely.
