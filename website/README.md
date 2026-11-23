# MoeSekai Story Studio Landing Page (`story.pjsk.moe`)

Standalone promotional landing page and dual-mirror Download Distribution Hub (**CNB** + **GitHub Releases**) for **MoeSekai Story Studio**.

Isolated in `website/` so root Bun workspace lockstep checks (`bun run version:check`, `bun run test`, `bun run typecheck`, `bun.lock`) remain untouched. Zero Bun-only runtime/build dependencies — works identically with **Bun** or **Node.js / npm**.

## Local Development & Production Build

```bash
cd website
bun install          # or: npm install
bun run dev          # or: npm run dev   (http://127.0.0.1:5175)
bun run build        # or: npm run build (typechecks and outputs static site to website/dist/)
bun run preview      # or: npm run preview (http://127.0.0.1:4173)
```

## Deployment

### EdgeOne Pages (`story.pjsk.moe`)
- **Root directory**: `website`
- **Install command**: `bun install` (or `npm install`)
- **Build command**: `bun run build` (or `npm run build`)
- **Output directory**: `dist`
- **Custom domain**: Bind `story.pjsk.moe` directly in the EdgeOne Pages console (no `CNAME` file or GitHub Actions workflow required).
