# MoeSekai Story Studio Landing Page (`story.pjsk.moe`)

Standalone promotional landing page and dual-mirror Download Distribution Hub (**CNB** + **GitHub Releases**) for **MoeSekai Story Studio**.

Isolated in `website/` so root Bun workspace lockstep checks (`bun run version:check`, `bun run test`, `bun run typecheck`, `bun.lock`) remain untouched.

## Local Development & Production Build

```bash
cd website
bun install
bun run dev        # http://127.0.0.1:5175
bun run build      # Typechecks and outputs static site to website/dist/ (includes CNAME = story.pjsk.moe)
bun run preview    # Preview built website/dist/ on http://127.0.0.1:4173
```

## Deployment

### GitHub Pages (`story.pjsk.moe`)
1. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push changes in `website/` to `main` (or trigger `.github/workflows/deploy-pages.yml` manually).
3. Point DNS `CNAME` record for `story.pjsk.moe` to `starmoe-org.github.io` (`website/dist/CNAME` is emitted automatically).

### Cloudflare Pages (`story.pjsk.moe`)
- **Root directory**: `website`
- **Build command**: `bun install && bun run build`
- **Build output directory**: `dist`
- **Custom domain**: `story.pjsk.moe`
