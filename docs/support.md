# Support

`next-on-azure` is experimental. This page says what is promised for the first release and what is not. Everything on it is checked against [Compatibility](./compatibility.md), where each statement is marked **Verified (Azure)**, **Verified (local)** or **Unverified**.

## Versions

- The first release is `0.1.0`, published with the default npm tag. The version has no suffix: that the project is experimental is said here, in the README and in the package description.
- In `0.x`, a minor version (`0.2.0`) can change behavior, and a patch version (`0.1.1`) only fixes. Breaking changes are listed in the release notes.
- Only the latest release is supported. Security problems are handled as in the [security policy](../SECURITY.md); other problems on a best-effort basis, by one maintainer. There is no response time and no service level.

## What was run

| Area | Promised for `0.1.0` |
| --- | --- |
| Next.js | 15.5.29 and later 15.x, and 16.4.5 and later. Run on Azure: 15.5.29 and 16.4.5. The rest of the range is expected to work and was not run |
| Routers and features | The rows marked **Verified (Azure)** in [Compatibility](./compatibility.md): App Router and Pages Router, SSR, streaming, ISR, `revalidateTag` and `revalidatePath`, `'use cache'`, middleware and `proxy`, Server Actions, `after()`, `next/image`, cookies |
| Platform | Azure Functions Flex Consumption, Node.js 22, japaneast |
| Build machine | macOS and Linux, with npm, pnpm or Yarn 1 (a `node_modules` directory is needed; Yarn Plug'n'Play is refused with a message) |
| Deployment | `next-on-azure deploy` with the template of this repository, or your own infrastructure as in [Your own infrastructure](./infrastructure.md) |

## What is not promised

- The Edge runtime and external middleware (not supported).
- Azure Front Door, Node.js 24, other regions, a Windows build machine, Yarn 2 and later, Bun: **Unverified**.
- `after()` with `--wait-until detach`, `cacheLife` expiry, the `remote` and `private` variants of `'use cache'`: **Unverified**.
- App Router routes with `dynamicParams = false`: they answered 404 until 2026-11-11 and are now read from the build output: **Verified (local)**, Unverified on Azure.
- Private networking, a web application firewall, customer-managed keys and other settings of a landing zone: not in the template ([ADR-0019](./plan/decisions.md#adr-0019-enterprise-use-at-the-level-of-opennext)).
- The numbers on the [Cost](./cost.md) page are estimates from measurements of one site, and the cold start and load figures are single samples: they are not guarantees.
