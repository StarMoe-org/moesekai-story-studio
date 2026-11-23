import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "bun:test";
import {
    LOCKSTEP_MANIFEST_PATHS,
    STORY_EDITOR_MANIFEST_PATH,
    bumpLockstepVersions,
    checkLockstepVersions,
    compareStrictSemver,
    computeNextVersion,
    getDefaultRepoRoot,
    getVersionInfo,
    parseStrictSemver,
} from "../scripts/version";
import {
    PUBLISH_PACKAGES,
    findWorkspaceSpecifiers,
    isPackageVersionPublished,
    verifyPackedTarball,
} from "../scripts/publish-packages";
import {
    CNB_ACCEPT_HEADER,
    buildCnbPatchReleasePayload,
    buildCnbPostReleasePayload,
    collectAssetFiles,
    isPrereleaseTag,
    resolveCnbVerifyUrl,
    syncCnbRelease,
    type FetchLike,
} from "../scripts/sync-cnb-release";

function createTempLockstepRepo(initialVersion = "0.1.0"): string {
    const dir = mkdtempSync(join(tmpdir(), "moesekai-version-test-"));
    for (const relPath of LOCKSTEP_MANIFEST_PATHS) {
        const full = join(dir, relPath);
        mkdirSync(dirname(full), { recursive: true });
        const pkg: Record<string, unknown> = {
            name: relPath === "package.json" ? "moesekai-story-studio" : relPath,
            version: initialVersion,
        };
        if (relPath === STORY_EDITOR_MANIFEST_PATH) {
            pkg.peerDependencies = {
                "@moesekai/story-core": `^${initialVersion}`,
                react: "^19.0.0",
            };
        }
        writeFileSync(full, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }
    return dir;
}

describe("lockstep versioning (scripts/version.ts)", () => {
    test("parseStrictSemver, compareStrictSemver, and computeNextVersion handle all bump modes", () => {
        assert.deepEqual(parseStrictSemver("0.1.0"), { major: 0, minor: 1, patch: 0 });
        assert.deepEqual(parseStrictSemver("12.34.56"), { major: 12, minor: 34, patch: 56 });
        assert.equal(parseStrictSemver("v0.1.0"), null);
        assert.equal(parseStrictSemver("0.1.0-beta.1"), null);
        assert.equal(parseStrictSemver("01.0.0"), null);
        assert.equal(parseStrictSemver("0.1"), null);

        assert.ok(compareStrictSemver("0.1.0", "0.1.1") < 0);
        assert.ok(compareStrictSemver("0.2.0", "0.1.9") > 0);
        assert.equal(compareStrictSemver("1.0.0", "1.0.0"), 0);

        assert.equal(computeNextVersion("0.1.0", "patch"), "0.1.1");
        assert.equal(computeNextVersion("0.1.9", "minor"), "0.2.0");
        assert.equal(computeNextVersion("0.9.9", "major"), "1.0.0");
        assert.equal(computeNextVersion("0.1.0", "2.3.4"), "2.3.4");
        assert.equal(computeNextVersion("0.1.0", "v0.5.0"), "0.5.0");

        assert.throws(() => computeNextVersion("0.1.0", "bad"), /Invalid bump target/);
        assert.throws(() => computeNextVersion("0.1.0", "0.2.0-rc.1"), /Invalid bump target/);
    });

    test("real repository passes lockstep check and version show", () => {
        const repoRoot = getDefaultRepoRoot();
        const check = checkLockstepVersions(repoRoot);
        assert.equal(check.ok, true, JSON.stringify(check.errors));
        assert.ok(check.version && parseStrictSemver(check.version) !== null);
        assert.equal(check.storyEditorPeerRange, `^${check.version}`);
        for (const relPath of LOCKSTEP_MANIFEST_PATHS) {
            assert.equal(check.versions[relPath], check.version);
        }

        const tagOk = checkLockstepVersions(repoRoot, { expectedTag: `v${check.version}` });
        assert.equal(tagOk.ok, true);

        const tagMismatch = checkLockstepVersions(repoRoot, { expectedTag: "v99.99.99" });
        assert.equal(tagMismatch.ok, false);
        assert.ok(tagMismatch.errors.some(e => e.includes("does not match")));

        const info = getVersionInfo(repoRoot);
        assert.equal(info.version, check.version);
        assert.equal(info.tag, `v${check.version}`);
        assert.match(info.buildDate, /^\d{4}-\d{2}-\d{2}$/);
    });

    test("bumpLockstepVersions supports dry-run and atomically updates all 5 manifests + story-editor peer range", () => {
        const tempRepo = createTempLockstepRepo("0.1.0");
        try {
            const dry = bumpLockstepVersions(tempRepo, "minor", { dryRun: true });
            assert.equal(dry.previousVersion, "0.1.0");
            assert.equal(dry.nextVersion, "0.2.0");
            assert.equal(dry.tag, "v0.2.0");
            assert.equal(dry.dryRun, true);
            assert.equal(dry.updatedFiles.length, 5);
            // Dry-run must leave files untouched
            assert.equal(checkLockstepVersions(tempRepo).version, "0.1.0");

            const bumped = bumpLockstepVersions(tempRepo, "minor");
            assert.equal(bumped.nextVersion, "0.2.0");
            const after = checkLockstepVersions(tempRepo, { expectedTag: "v0.2.0" });
            assert.equal(after.ok, true, JSON.stringify(after.errors));
            assert.equal(after.version, "0.2.0");
            assert.equal(after.storyEditorPeerRange, "^0.2.0");

            const patched = bumpLockstepVersions(tempRepo, "patch");
            assert.equal(patched.nextVersion, "0.2.1");
            assert.equal(checkLockstepVersions(tempRepo).ok, true);

            // Drift detection: mutate one manifest out of sync
            const desktopPkgPath = join(tempRepo, "apps/desktop/package.json");
            const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, "utf8")) as Record<string, unknown>;
            desktopPkg.version = "0.9.9";
            writeFileSync(desktopPkgPath, `${JSON.stringify(desktopPkg, null, 2)}\n`, "utf8");

            const drifted = checkLockstepVersions(tempRepo);
            assert.equal(drifted.ok, false);
            assert.ok(drifted.errors.some(e => e.includes("apps/desktop/package.json") && e.includes("diverges")));
            assert.throws(() => bumpLockstepVersions(tempRepo, "patch"), /lockstep check failed/);
        } finally {
            rmSync(tempRepo, { recursive: true, force: true });
        }
    });
});

describe("npm publish verification (scripts/publish-packages.ts)", () => {
    test("findWorkspaceSpecifiers flags workspace:* leaks and passes clean manifests", () => {
        assert.deepEqual(
            findWorkspaceSpecifiers({
                dependencies: { "@moesekai/story-core": "workspace:*" },
                peerDependencies: { "@moesekai/story-core": "^0.1.0" },
                devDependencies: { "@moesekai/story-editor": "workspace:^" },
            }),
            [
                "dependencies.@moesekai/story-core=workspace:*",
                "devDependencies.@moesekai/story-editor=workspace:^",
            ],
        );

        assert.deepEqual(
            findWorkspaceSpecifiers({
                dependencies: { "@moesekai/story-core": "0.1.0" },
                peerDependencies: { "@moesekai/story-core": "^0.1.0" },
            }),
            [],
        );
    });

    test("verifyPackedTarball confirms all 3 @moesekai packages pack with 0 workspace:* leaks, dist/, and LICENSE", () => {
        const repoRoot = getDefaultRepoRoot();
        const { version } = checkLockstepVersions(repoRoot);
        assert.ok(version);

        for (const pkg of PUBLISH_PACKAGES) {
            const res = verifyPackedTarball(repoRoot, pkg.dir, version);
            assert.equal(res.packageName, pkg.name);
            assert.equal(res.version, version);
            assert.equal(res.hasDist, true);
            assert.equal(res.hasLicense, true);
            assert.deepEqual(res.workspaceLeaks, []);
            assert.ok(res.fileCount >= 5);
        }
    });

    test("isPackageVersionPublished handles 200 skip, 404 unpublished, and packument fallback", async () => {
        const published = await isPackageVersionPublished(
            "@moesekai/story-core",
            "0.1.0",
            "https://registry.npmjs.org",
            async () => new Response("{}", { status: 200 }),
        );
        assert.equal(published, true);

        const missing = await isPackageVersionPublished(
            "@moesekai/story-core",
            "0.1.0",
            "https://registry.npmjs.org",
            async () => new Response("not found", { status: 404 }),
        );
        assert.equal(missing, false);

        const calls: string[] = [];
        const fallbackHit = await isPackageVersionPublished(
            "@moesekai/story-core",
            "0.1.0",
            "https://registry.example.test",
            async (input) => {
                const url = String(input);
                calls.push(url);
                if (url.endsWith("/0.1.0")) return new Response("", { status: 405 });
                return new Response(JSON.stringify({ versions: { "0.1.0": {} } }), { status: 200 });
            },
        );
        assert.equal(fallbackHit, true);
        assert.equal(calls.length, 2);
    });
});

describe("CNB release sync (scripts/sync-cnb-release.ts)", () => {
    test("payload builders and verify_url resolution follow CNB OpenAPI schema", () => {
        assert.equal(isPrereleaseTag("v0.1.0"), false);
        assert.equal(isPrereleaseTag("v0.2.0-beta.1"), true);

        const stable = buildCnbPostReleasePayload({
            tag: "v0.1.0",
            name: "MoeSekai Story Studio v0.1.0",
            body: "Release notes",
        });
        assert.deepEqual(stable, {
            tag_name: "v0.1.0",
            name: "MoeSekai Story Studio v0.1.0",
            body: "Release notes",
            draft: false,
            prerelease: false,
            make_latest: "true",
        });

        const pre = buildCnbPatchReleasePayload({
            tag: "v0.2.0-rc.1",
            body: "RC notes",
        });
        assert.equal(pre.prerelease, true);
        assert.equal(pre.make_latest, "false");

        assert.equal(
            resolveCnbVerifyUrl("/StarMoe-org/moesekai-story-studio/-/releases/123/asset-upload-confirmation/tok/file.exe"),
            "https://api.cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/123/asset-upload-confirmation/tok/file.exe",
        );
        assert.equal(
            resolveCnbVerifyUrl("https://api.cnb.cool/custom/verify"),
            "https://api.cnb.cool/custom/verify",
        );
    });

    test("syncCnbRelease gracefully skips without CNB_TOKEN unless requireToken=true", async () => {
        const warnings: string[] = [];
        const skipped = await syncCnbRelease({
            repo: "StarMoe-org/moesekai-story-studio",
            tag: "v0.1.0",
            token: "",
            logger: { log: () => {}, warn: (msg: string) => warnings.push(msg) },
        });
        assert.equal(skipped.skipped, true);
        assert.equal(skipped.reason, "missing_token");
        assert.equal(warnings.length, 1);

        await assert.rejects(
            () => syncCnbRelease({
                repo: "StarMoe-org/moesekai-story-studio",
                tag: "v0.1.0",
                token: "",
                requireToken: true,
                logger: { log: () => {}, warn: () => {} },
            }),
            /CNB_TOKEN is not configured/,
        );
    });

    test("syncCnbRelease creates new release and executes 3-step CNB asset upload without leaking Bearer to COS", async () => {
        const tempAssets = mkdtempSync(join(tmpdir(), "moesekai-cnb-assets-"));
        try {
            const installerPath = join(tempAssets, "MoeSekai-Story-Studio-0.1.0-Setup.exe");
            const sumsPath = join(tempAssets, "SHA256SUMS.txt");
            writeFileSync(installerPath, Buffer.from("FAKE-EXE-BINARY"));
            writeFileSync(sumsPath, "deadbeef  MoeSekai-Story-Studio-0.1.0-Setup.exe\n");

            const files = collectAssetFiles(tempAssets);
            assert.equal(files.length, 2);

            const trace: Array<{ method: string; url: string; auth: string | null; accept: string | null; body?: string }> = [];
            const mockFetch: FetchLike = async (input, init) => {
                const url = String(input);
                const method = init?.method ?? "GET";
                const headers = new Headers(init?.headers);
                const auth = headers.get("authorization");
                const accept = headers.get("accept");
                const body = typeof init?.body === "string" ? init.body : undefined;
                trace.push({ method, url, auth, accept, body });

                if (method === "GET" && url.endsWith("/-/releases/tags/v0.1.0")) {
                    return new Response("not found", { status: 404 });
                }
                if (method === "POST" && url.endsWith("/-/releases")) {
                    return new Response(JSON.stringify({ id: "rel_42", tag_name: "v0.1.0" }), { status: 201 });
                }
                if (method === "POST" && url.endsWith("/-/releases/rel_42/asset-upload-url")) {
                    const req = JSON.parse(body ?? "{}") as { asset_name: string };
                    return new Response(JSON.stringify({
                        upload_url: `https://cos.example.test/upload/${req.asset_name}?sig=xyz`,
                        verify_url: `/StarMoe-org/moesekai-story-studio/-/releases/rel_42/asset-upload-confirmation/tok/${req.asset_name}`,
                        expires_in_sec: 300,
                    }), { status: 200 });
                }
                if (method === "PUT" && url.startsWith("https://cos.example.test/upload/")) {
                    return new Response("", { status: 200 });
                }
                if (method === "POST" && url.includes("/asset-upload-confirmation/tok/")) {
                    return new Response("", { status: 200 });
                }
                return new Response("unexpected", { status: 500 });
            };

            const res = await syncCnbRelease({
                repo: "StarMoe-org/moesekai-story-studio",
                tag: "v0.1.0",
                name: "MoeSekai Story Studio v0.1.0",
                body: "## Highlights\n- First release",
                files,
                token: "cnb_secret_token",
                fetchImpl: mockFetch,
                logger: { log: () => {}, warn: () => {} },
            });

            assert.equal(res.skipped, false);
            assert.equal(res.action, "created");
            assert.equal(res.releaseId, "rel_42");
            assert.deepEqual(res.uploadedAssets, [
                "MoeSekai-Story-Studio-0.1.0-Setup.exe",
                "SHA256SUMS.txt",
            ]);

            // Verify exact request sequence: GET tag (404) -> POST release -> 2 * (POST upload-url -> PUT presigned -> POST verify)
            assert.equal(trace.length, 8);
            assert.equal(trace[0].method, "GET");
            assert.equal(trace[0].accept, CNB_ACCEPT_HEADER);
            assert.equal(trace[1].method, "POST");
            assert.equal(JSON.parse(trace[1].body!).make_latest, "true");

            const putCalls = trace.filter(t => t.method === "PUT");
            assert.equal(putCalls.length, 2);
            for (const put of putCalls) {
                assert.equal(put.auth, null, "Bearer token must NEVER be sent to presigned COS upload URL");
            }
            const verifyCalls = trace.filter(t => t.url.includes("/asset-upload-confirmation/"));
            assert.equal(verifyCalls.length, 2);
            for (const verify of verifyCalls) {
                assert.equal(verify.auth, "Bearer cnb_secret_token");
                assert.ok(verify.url.startsWith("https://api.cnb.cool/StarMoe-org/"));
            }
        } finally {
            rmSync(tempAssets, { recursive: true, force: true });
        }
    });

    test("syncCnbRelease updates existing CNB release via PATCH when tag already exists", async () => {
        const calls: string[] = [];
        const mockFetch: FetchLike = async (input, init) => {
            const url = String(input);
            const method = init?.method ?? "GET";
            calls.push(`${method} ${url}`);
            if (method === "GET" && url.endsWith("/-/releases/tags/v0.1.0")) {
                return new Response(JSON.stringify({ id: "rel_99", tag_name: "v0.1.0" }), { status: 200 });
            }
            if (method === "PATCH" && url.endsWith("/-/releases/rel_99")) {
                return new Response("", { status: 200 });
            }
            return new Response("unexpected", { status: 500 });
        };

        const res = await syncCnbRelease({
            repo: "StarMoe-org/moesekai-story-studio",
            tag: "v0.1.0",
            name: "Updated Title",
            body: "Updated notes",
            files: [],
            token: "cnb_token",
            fetchImpl: mockFetch,
            logger: { log: () => {}, warn: () => {} },
        });
        assert.equal(res.skipped, false);
        assert.equal(res.action, "updated");
        assert.equal(res.releaseId, "rel_99");
        assert.deepEqual(calls, [
            "GET https://api.cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/tags/v0.1.0",
            "PATCH https://api.cnb.cool/StarMoe-org/moesekai-story-studio/-/releases/rel_99",
        ]);
    });
});
