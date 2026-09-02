# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.** Public disclosure before a fix gives attackers a window to exploit.

### Preferred path

1. Email **security@byjtt.com** with the subject `By JTT: <brief description>`.
2. Include:
   - Description of the vulnerability
   - Steps to reproduce (or a proof of concept)
   - Impact assessment (what an attacker could achieve)
   - Your contact info for follow-up
3. Allow up to **72 hours** for an initial response. If you don't hear back, follow up.

### What happens after

- We confirm receipt and assess severity.
- We work on a fix in private (no public commits, no PRs).
- Once a fix is ready, we coordinate disclosure: release a patched version, then publish a brief advisory.
- We credit the reporter (unless you prefer to remain anonymous — say so in your report).

### What we don't do

- We do not offer a bug bounty or monetary reward for reports.
- We do not engage in public vulnerability disclosure before a fix is ready.
- We do not share reporter details publicly without permission.

### Scope

The security boundary covers the live site and its client-side code:

- The public website served at `byjtt.com` and its subdomains
- API endpoints and data endpoints exposed by the site
- Client-side JavaScript, analytics, and third-party integrations
- Dependency supply-chain issues in `package.json` (report via the same channel)

Out of scope:

- Vulnerabilities in upstream frameworks — report to those maintainers
- Self-XSS with no session or data impact
- Theoretical issues with no reproducible exploit path

### Disclosure window

We aim to acknowledge within 72 hours and to issue a patched release within a reasonable window depending on severity. Critical issues get priority over lower-severity bugs.

If you help us improve security and want public credit, we'll list you in the release notes. If you prefer anonymity, we'll say "a security researcher reported this."
