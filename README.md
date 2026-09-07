# npm-scan-demo

A minimal Node/Express app with **intentionally outdated, vulnerable dependencies**, used to demonstrate free, automated dependency and container-image scanning for npm projects via GitHub Actions.

This mirrors the "bad-practice on purpose" teaching pattern: the point isn't that this code is broken, it's that scanning tools reliably catch real, disclosed CVEs in dependencies that look completely normal in a `package.json`.

---

## What's intentionally vulnerable here

`package.json` pins:
- `lodash@4.17.4` — multiple disclosed prototype-pollution, command-injection, and ReDoS advisories
- `minimist@0.0.8` — disclosed prototype-pollution advisories

Both are actually `require()`'d and used in `src/server.js` (not just declared and ignored), so this isn't a synthetic finding — it's a real, exploitable dependency chain.

### What these packages actually do

If you're not familiar with the npm ecosystem, here's what each flagged package is for:

- **express** — the most widely used web framework for Node.js; it's what this app uses to define routes and handle HTTP requests. It's the foundation most Node backends are built on, which is why its own dependencies (like `qs`, used for parsing query strings) get pulled in transitively — that's how the `qs` vulnerability below showed up even though we never installed `qs` ourselves.
- **lodash** — a utility library of helper functions for working with arrays and objects (merging objects, deep-cloning, deduplicating lists, etc.). It's one of the single most-downloaded packages on npm, which makes it a good teaching example: a vulnerability here has enormous real-world blast radius. This app uses its `merge` function specifically — the function implicated in the CVEs for the pinned version.
- **minimist** — a small utility that parses command-line arguments (turns `--foo bar` into `{ foo: "bar" }`). Much lower-profile than the other two, but it's everywhere as a *transitive* dependency — many other tools use it internally to parse their own CLI flags, so a vulnerable version tends to sneak in indirectly even in projects that never touch it directly.

## Real findings from this repo

This is unedited output from running `npm audit` against this exact `package.json`:

```
lodash  <=4.17.23
Severity: critical
Prototype Pollution in lodash - https://github.com/advisories/GHSA-fvqr-27wr-82fm
Command Injection in lodash - https://github.com/advisories/GHSA-35jh-r3h4-6jhm
(+ 8 more advisories)
fix available via `npm audit fix --force`

minimist  <=0.2.3
Severity: critical
Prototype Pollution in minimist - https://github.com/advisories/GHSA-vh95-rmgr-6w4m
Prototype Pollution in minimist - https://github.com/advisories/GHSA-xvch-5gv4-984h
fix available via `npm audit fix --force`

qs  2.2.5 - 6.15.3
Severity: moderate
qs array-limit bypass via bracket-key comma parsing - https://github.com/advisories/GHSA-x5fp-wj9c-mxmx
qs: Denial of Service via Attacker Controlled isBuffer - https://github.com/advisories/GHSA-4mjr-xmp4-gh2g
  body-parser  1.20.5 - 1.20.6 (depends on vulnerable qs)
  express  4.22.2 (depends on vulnerable body-parser + qs)

5 vulnerabilities (3 moderate, 2 critical)
```

Worth noting: the `qs`/`body-parser` finding wasn't deliberately introduced — it came from a **transitive** dependency of `express` itself, at the version that happened to resolve when this repo was built. That's realistic and worth keeping in the demo: scanning catches issues you didn't directly introduce, not just the ones you pinned on purpose.

---

## What's set up here

| Layer | Tool | What it catches | Where it reports |
|---|---|---|---|
| Dependency CVEs | `npm audit` | Known vulnerabilities in declared + transitive npm packages | CI job output, uploaded JSON artifact |
| Automated remediation | Dependabot | Same as above, but opens PRs to bump versions automatically | Pull requests |
| Lockfile/filesystem scan | Trivy (`fs` mode) | Same CVE database as npm audit, but also catches OS-level and non-npm manifest issues | GitHub Security tab (SARIF) |
| Container image scan | Trivy (`image` mode) | CVEs baked into the built image — base OS packages plus whatever's actually shipped, not just declared | GitHub Security tab (SARIF) |

All four are free for public GitHub repos and require zero API keys or paid accounts — that's why this demo is built the way it is, rather than assuming access to a paid SaaS scanner.

### Where the CI pipeline lives

`.github/workflows/scan.yml` runs on every push to `main`, every PR, and weekly on a schedule (so newly-disclosed CVEs against *unchanged* dependencies still get caught — a real vuln can be published against a package you haven't touched in months).

The `npm-audit` job is intentionally configured with `--audit-level=high`, meaning **this pipeline will fail on this repo as committed** — that's the point. It's a visible, working example of a CI gate actually blocking a build over real, disclosed vulnerabilities, not a scan that just logs and moves on.

---

## A live example, found while building this

While standing this pipeline up, the `Trivy` jobs failed on the first push because they were pinned to `aquasecurity/trivy-action@0.24.0` — a tag that no longer resolves. In March 2026, a threat actor used compromised maintainer credentials to force-push malicious commits into most of `trivy-action`'s old-style version tags (see [GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)). Aqua Security's response was to re-tag everything with a `v` prefix (e.g. `v0.36.0`) and invalidate the old un-prefixed tags.

Worth sitting with: this pipeline exists to catch supply-chain risk in *npm* dependencies, and it tripped over supply-chain risk in its own CI tooling first. Pinning a GitHub Action to a version tag isn't meaningfully safer than pinning an npm package to a version range — both are trusting a maintainer's account security. The more robust practice (not done here, to keep the demo simple) is pinning Actions to a full commit SHA rather than a mutable-looking tag.

---

## Mapping this to an enterprise setup (ADO + StackRox/ACS)

This demo uses GitHub-native, free tooling because it's a public personal repo. The same layers map directly onto a typical enterprise pipeline:

- **`npm audit` / Dependabot** → equivalent role to a dependency-scanning extension in an Azure DevOps pipeline (e.g. Mend/WhiteSource, Snyk, or ADO's own dependency scanning where licensed)
- **Trivy image scan** → conceptually the same job StackRox/Advanced Cluster Security performs: scanning a built container image for known CVEs before or after it lands in a registry. ACS typically does this as an admission-control-integrated step (can block deployment, not just CI), which is a step beyond what this demo shows — Trivy here only gates the *build*, not the *deploy*.
- **SARIF upload to GitHub Security tab** → equivalent to however your enterprise tool centralizes findings (ACS has its own violations/vulnerability dashboard; ADO surfaces scan results as pipeline artifacts or via extension-specific tabs)

The mechanics differ, but the shape of the pipeline — scan dependencies, scan the built image, fail the build (or block the deploy) on findings above a severity threshold, centralize the report — is the same regardless of which tool sits in each slot.

---

## Running it locally

```bash
npm install
npm run audit          # same as `npm audit`
docker build -t npm-scan-demo .
```

## Remediating the findings (optional — breaks the demo)

```bash
npm audit fix --force
```

This will bump `lodash` and `minimist` to patched majors and likely requires touching `src/server.js` if either package's API changed. Doing this makes `npm audit` pass and the CI gate stop failing — useful if you want to demo the "before/after" story of fixing a real finding, but it also means the repo stops being a working example of the bad case. Consider keeping the vulnerable state on `main` and doing the fix on a throwaway branch if you want both.
