# SquadHub UI preview

Threads-inspired front-end of the black icon rail, off-white sidebar, and white
My home workspace. Open **http://localhost:3010/design-preview**.

This pass keeps SquadHub’s real home structure — greeting, work timer, summary
cards, SOP pill, and focus list — and restyles it with Threads’ quiet type,
hairline surfaces, and restrained motion.

Meta’s Optimistic typeface is not publicly licensed. The preview uses **Mona Sans**
(OFL), a close geometric match, hosted locally with its license.

Start from the repository root:

```sh
npm run dev:preview -w web
```

The preview has its own Next.js build directory so it does not collide with the
main dev server. No authentication or backend is required.

Other product pages are out of scope for this pass and say so when you click them.
