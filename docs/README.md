# Documentation

This documentation follows the structure of the [OpenNext for AWS docs](https://opennext.js.org/aws) so readers of one can find their way around the other.

| Section | What is in it |
| --- | --- |
| [Get started](./get_started.md) | Install, configure, build and deploy a Next.js app to Azure |
| [Compatibility](./compatibility.md) | Supported Next.js versions and features, with verification status |
| [Config](./config/overrides.md) | The OpenNext overrides this project provides and their environment variables |
| [Inner workings](./inner_workings/architecture.md) | Architecture, caching and revalidation, plus [Azure notes](./inner_workings/azure_notes.md) |
| [Common issues](./common_issues.md) | Known problems and fixes |
| [FAQ](./faq.md) | Short answers |
| [Contribute](./contribute/local_run.md) | [Local development](./contribute/local_run.md), [testing](./contribute/testing.md), [CI](./contribute/ci.md), [real Azure runs](./contribute/azure_runs.md) |
| [Plan](./plan/roadmap.md) | Roadmap, architecture decision records and the work log |

## Documentation conventions

- Documentation is written in **English**.
- Every claim about behavior on Azure must be marked **Verified** or **Unverified** (see [Compatibility](./compatibility.md)). Never describe a behavior as working unless it was actually run.
- Update the [work log](./plan/worklog.md) at the end of every working session, and the [roadmap](./plan/roadmap.md) whenever a task changes state.
- Record every non-obvious design choice as an [ADR](./plan/decisions.md) with its reasoning and the alternatives considered.
- Pages are plain Markdown so they render on GitHub. They can be fed to a docs site generator later without changes.
