#!/usr/bin/env bash
# R5: the GitHub settings that belong to a public repository (docs/plan/release_plan.md).
#   scripts/github-settings.sh check   [owner/repo]   read-only: print the current state
#   scripts/github-settings.sh apply   [owner/repo]   change the settings (the maintainer runs this, after the repository is public)
# Needs the GitHub CLI signed in with admin rights. Nothing here runs in CI.
# Unverified: this script has not been applied; endpoints and field names follow the GitHub REST documentation.
set -euo pipefail
mode="${1:-check}"
repo="${2:-fjt-dev/next-on-azure}"

checks='["lint, build, test (Node 22)","lint, build, test (Node 24)","audit, secrets, licenses","local E2E (Functions host + Azurite, Next.js 16.4.5)","local E2E (Functions host + Azurite, Next.js catalog)"]'

show() { echo "== $1"; gh api "$2" ${3:+--jq "$3"} 2>&1 | head -30 || true; echo; }

if [ "$mode" = "check" ]; then
  show "visibility" "repos/$repo" '{private,visibility,security_and_analysis}'
  show "branch protection (main)" "repos/$repo/branches/main/protection" '{checks: .required_status_checks.contexts, force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled}'
  show "rulesets" "repos/$repo/rulesets" '.[] | {name,target,enforcement}'
  show "private vulnerability reporting" "repos/$repo/private-vulnerability-reporting"
  show "workflow permissions" "repos/$repo/actions/permissions/workflow"
  show "fork pull request approval" "repos/$repo/actions/permissions/fork-pr-contributor-approval"
  show "environments" "repos/$repo/environments" '.environments[] | {name, rules: [.protection_rules[].type]}'
  exit 0
fi

[ "$mode" = "apply" ] || { echo "usage: $0 check|apply [owner/repo]" >&2; exit 2; }
[ "$(gh api "repos/$repo" --jq .private)" = "false" ] || { echo "The repository is private: these settings need a public repository. Stopping." >&2; exit 1; }

echo "1. Dependabot alerts and security updates"
gh api -X PUT "repos/$repo/vulnerability-alerts" --silent
gh api -X PUT "repos/$repo/automated-security-fixes" --silent
echo "2. Private vulnerability reporting (SECURITY.md points to it)"
gh api -X PUT "repos/$repo/private-vulnerability-reporting" --silent
echo "3. Secret scanning and push protection"
gh api -X PATCH "repos/$repo" --input - --silent <<JSON
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
echo "4. Branch protection on main: the checks must pass, no force push, no deletion (administrators may still push)"
gh api -X PUT "repos/$repo/branches/main/protection" --input - --silent <<JSON
{"required_status_checks":{"strict":false,"contexts":$checks},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}
JSON
echo "5. Workflows from first-time contributors need approval"
gh api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors --silent
echo "6. Release tags v*.*.* cannot be moved or deleted"
gh api -X POST "repos/$repo/rulesets" --input - --silent <<JSON
{"name":"release-tags","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*.*.*"],"exclude":[]}},"rules":[{"type":"deletion"},{"type":"update"}]}
JSON
echo "Done. Next, by hand: the npm-publish environment (required reviewer, tag rule v*.*.*; leave 'Prevent self-review' off) and the npm trusted publisher."
