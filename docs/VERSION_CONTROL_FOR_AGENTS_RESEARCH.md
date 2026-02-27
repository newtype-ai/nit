# Version Control for AI Agents: Comprehensive Research

Everything found across GitHub, HN, Reddit, research papers, blogs, enterprise platforms, and open source projects.

---

## Key Statistics

- **Tool versioning causes 60% of production agent failures**
- **Model drift causes 40% of production agent failures**
- **41% of new code was AI-generated in 2025**
- Agents at Neon created **20x more branches** and performed **50x more rollbacks** vs humans
- **Over 80% of enterprises** use AI agents for workflows in 2025, but most lack version-control processes

---

## 1. Research Papers

### AgentGit (Nov 2025)
- **Paper**: [arxiv:2511.00628](https://arxiv.org/abs/2511.00628)
- **Code**: [github.com/HKU-MAS-Infra-Layer/Agent-Git](https://github.com/HKU-MAS-Infra-Layer/Agent-Git)
- Git-like rollback and branching for multi-agent system workflows. Built on LangGraph. Three-layer architecture. State commit, revert, branching. Agents traverse and compare multiple trajectories. Preserves full execution context during rollback (LangGraph discards intermediate results). Significantly reduces redundant computation and token usage.

### Git Context Controller / GCC (Jul 2025)
- **Paper**: [arxiv:2508.00031](https://arxiv.org/abs/2508.00031)
- **Code**: [github.com/theworldofagents/GCC](https://github.com/theworldofagents/GCC)
- Applies Git semantics (COMMIT, BRANCH, MERGE, CONTEXT) to LLM agent memory. Structures memory as a persistent file system. Milestone-based checkpointing, branching for alternative plan exploration. **48.00% on SWE-Bench-Lite** (outperforming 26 systems). GCC-augmented agents achieve **40.7% task resolution in self-replication vs 11.7% without**.

### PROV-AGENT (Aug 2025)
- **Paper**: [arxiv:2508.02866](https://arxiv.org/abs/2508.02866)
- First provenance framework for tracking AI agent interactions. Unified provenance graph treating agent actions as first-class components. Answers: what input led to this decision, how did it influence control flow, which downstream outputs were affected.

### Policy Cards (Oct 2025)
- **Paper**: [arxiv:2510.24383](https://arxiv.org/abs/2510.24383)
- Machine-readable, version-controlled artifacts expressing operational rules and obligations. Extends Model/Data/System Cards with normative governance. Governance-focused, not agent behavior.

### UC Berkeley: "Supporting Our AI Overlords: Redesigning Data Systems to be Agent-First"
- **Ref**: [DoltHub Blog](https://www.dolthub.com/blog/2025-09-24-berkeley-cs-agents-need-branches/)
- Database branches are essential for AI agents. Agents explore multiple "what-if" hypotheses via branches. Proposes redesigning data systems with version control as first-class.

---

## 2. Open Source Tools & Frameworks

### Legit
- **GitHub**: [Legit-Control/monorepo](https://github.com/Legit-Control/monorepo) | [HN](https://news.ycombinator.com/item?id=46548475)
- Git-based version control for AI agents. CLI wrapper around Claude that stores conversations in Git — every prompt, response, and code change becomes part of project history. "Fail-safe by design."

### Lix — "Version control system for AI agents"
- **Site**: [lix.dev](https://lix.dev) | **GitHub**: [opral/lix](https://github.com/opral/lix) | [HN](https://news.ycombinator.com/item?id=46713387)
- Embeddable version control as a library. Universal — diffs any file format including binary (Excel, PDF, DOCX). Semantic entity-level diffs via plugins. Runs on SQLite/Postgres. **90k+ weekly NPM downloads**. Agents propose changes in isolated versions, humans review and merge.
- Creator quote: "Lix doesn't target code version control. It can be used to enable human-in-the-loop workflows for AI agents like diffs and reviews."

### Entire CLI (by Nat Friedman, ex-GitHub CEO)
- **Source**: [TechEduByte](https://www.techedubyte.com/entire-cli-git-observability-ai-agents-ex-github-ceo/)
- Git observability layer. Real-time monitoring of how AI agents interact with repos. Detailed logs of activities, decisions, and code generated/modified.

### Vigilo
- **GitHub**: [Idan3011/vigilo](https://github.com/Idan3011/vigilo) | [HN](https://news.ycombinator.com/item?id=47144737)
- Local audit trail + cost tracker for AI coding agents. MCP server logging every tool call to append-only JSONL. Session timeline, live events, token breakdown. Fully local, AES-256-GCM encryption.

### Turso AgentFS
- **Blog**: [turso.tech/blog/agentfs](https://turso.tech/blog/agentfs) | **GitHub**: [tursodatabase/agentfs](https://github.com/tursodatabase/agentfs)
- Three interfaces: Filesystem (POSIX-like), Key-Value store, Toolcall audit trail. **Entire agent runtime in a single SQLite file**. Copy-on-write isolation. Snapshot with `cp agent.db snapshot.db`. Every file operation, tool call, and state change recorded.

### AIOS (AI Agent Operating System)
- **GitHub**: [agiresearch/AIOS](https://github.com/agiresearch/AIOS)
- Kernel abstraction managing LLM, memory, storage, and tools. Snapshots entire state: variables, code versions, prompts, memory. Roll back to debug hallucinations.

### GitClaw
- **Site**: [gitclaw.ai](https://gitclaw.ai/) | **GitHub**: [SawyerHood/gitclaw](https://github.com/SawyerHood/gitclaw)
- OpenClaw running on GitHub Actions. Conversation history committed to git. Agent greps its own history, edits past conversations. Long-term memory via git.

### DVC (Data Version Control)
- **Site**: [dvc.org](https://dvc.org/)
- Git-compatible versioning for large files, ML models, and pipelines. Petabyte-scale. Replaces large files with metafiles. Not agent-specific but foundational.

### skill-semver (Claude Code specific)
- **GitHub**: [cathy-kim/skill-semver](https://github.com/cathy-kim/skill-semver)
- Automatic semantic versioning for Claude Code Skills. MAJOR.MINOR.PATCH. PostToolUse hook. Version snapshots in releases/ folder.

---

## 3. Agent Memory & State Systems

### Letta Context Repositories + MemFS
- **Blog**: [letta.com/blog/context-repositories](https://www.letta.com/blog/context-repositories)
- Git-backed context repository called MemFS. Memory stored in git — agents must commit and push to save edits. Concurrent subagents get isolated worktrees and merge via git conflict resolution. Background memory reflection and defragmentation.

### Letta Agent File (.af)
- **GitHub**: [letta-ai/agent-file](https://github.com/letta-ai/agent-file)
- Open standard file format for serializing stateful AI agents. Packages system prompts, editable memory, tool configs, LLM settings. Enables checkpointing, version control, cross-framework transfer.

### MemOS
- **GitHub**: [MemTensor/MemOS](https://github.com/MemTensor/MemOS)
- AI memory OS for LLM/Agent systems. Persistent skill memory for cross-task reuse. Unified scheduling and version control. Multi-modal memory. Has official OpenClaw plugin.

### Mem0
- **Site**: [mem0.ai](https://mem0.ai/)
- Universal memory layer. Every memory timestamped, versioned, exportable.

### GitHub Copilot Memory System
- **Blog**: [GitHub Blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/)
- Memory pool self-heals — agents store corrected versions based on observations. Agents verify accuracy by checking cited code locations.

---

## 4. Database-Level Version Control

### Dolt / DoltHub (CRITICAL — most comprehensive thinking on this topic)
- **Blog series**:
  - [Agentic Systems Need Version Control](https://www.dolthub.com/blog/2025-10-31-agentic-systems-need-version-control/)
  - [Agents Need Branches (Berkeley paper)](https://www.dolthub.com/blog/2025-09-24-berkeley-cs-agents-need-branches/)
  - [Karpathy Says Agents Need Diffs](https://www.dolthub.com/blog/2025-10-30-karpathy-agents-need-diffs/)
  - [Agents Need Clones](https://www.dolthub.com/blog/2025-08-25-agents-need-clones/)
  - [Agentic Memory](https://www.dolthub.com/blog/2026-01-22-agentic-memory/)
  - [Three Pillars of Agentic AI](https://www.dolthub.com/blog/2025-09-08-agentic-ai-three-pillars/)
- Only database with true branching (diff and merge). Key insight: **code agents succeed because code has version control — other domains fail because they don't.** Andrej Karpathy: diff is a prerequisite for any domain where agents operate. Distinguishes true branches (Dolt: diff/merge) from database forks (Neon: can't diff or merge).

### Neon Database
- **Site**: [neon.com/branching/branching-for-agents](https://neon.com/branching/branching-for-agents)
- Copy-on-write database branching. Agents snapshot DB at key points, instant rollback. Agents created **20x more branches and 50x more rollbacks** vs humans.

---

## 5. Enterprise Platforms

### Decagon Agent Versioning
- **Site**: [decagon.ai/resources/decagon-agent-versioning](https://decagon.ai/resources/decagon-agent-versioning)
- CI/CD for AI agents. Every edit tracked as versioned commit. Workspace isolation (prod/staging). Multi-team: devs in GitHub, CX teams in console. Diffs, rollback, conversation-level version tracking. A/B testing with traffic allocation.

### ElevenLabs Agent Versioning
- **Docs**: [elevenlabs.io/docs/agents-platform/operate/versioning](https://elevenlabs.io/docs/agents-platform/operate/versioning) | [Blog](https://elevenlabs.io/blog/introducing-versioning)
- Branching for voice AI agents. Each version captures complete config (prompts, voices, workflows, tools, LLM). Traffic percentage deployment for A/B testing. Deterministic routing by conversation ID.

### Yobi AI
- **Blog**: [yobi.com/blog/agent-versioning](https://yobi.com/blog/agent-versioning)
- "What Changed? When? Who Did It?" — automatic version creation on every save. Tracks personality, tone, greetings, voice/text instructions, tools, knowledge base, schedules. Side-by-side comparison. Compliance-focused: pull up any version by date for audit.

### Relevance AI
- **Site**: [relevanceai.com/version-control](https://relevanceai.com/version-control)
- Auto-creates new version on every save. Tracks both agents and tools. One-click rollback.

### Box AI
- **Docs**: [developer.box.com/guides/box-ai/ai-agents/ai-agent-versioning](https://developer.box.com/guides/box-ai/ai-agents/ai-agent-versioning/)
- Config versioning for consistent responses.

### Retell AI
- **Docs**: [docs.retellai.com/agent/version](https://docs.retellai.com/agent/version)
- Version history with revert.

### Azure AI Foundry / Microsoft AgentOps
- **Blog**: [Microsoft AgentOps](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/from-zero-to-hero-agentops---end-to-end-lifecycle-management-for-production-ai-a/4484922)
- Agent Application wraps version with invocation URL, auth policy, Entra identity, registry. URL stays same across rollouts. Fleet-wide governance. Lifecycle management (pause, update, retire) with one click.

### OpenAI AgentKit
- **Blog**: [openai.com/index/introducing-agentkit](https://openai.com/index/introducing-agentkit/)
- Agent Builder with full versioning, inline eval, preview runs. Visual graph → state machines. Session management. Versioning controls before publishing.

### XMPro MAGS
- **Blog**: [xmpro.com](https://xmpro.com/how-xmpro-mags-solved-the-ai-agent-versioning-challenge-before-most-realized-it-was-coming/)
- Every AgentProfile includes versioned behavioral config. Memory systems versioned with decay factors. Risk-based deployments, shadow testing, behavioral baselines.

### LaunchDarkly AI Configs
- **Blog**: [launchdarkly.com](https://launchdarkly.com/blog/prompt-versioning-and-management/)
- Feature flag paradigm applied to prompts + model config. Runtime updates without deploying. Non-devs can iterate. Gradual rollout and rollback.

### Kore.ai
- **Blog**: [kore.ai](https://www.kore.ai/blog/why-prompt-version-control-matters-in-agent-development)
- Prompt version control with real-time co-editing, commenting, 65+ pre-built templates.

### Maxim AI
- **Site**: [getmaxim.ai](https://www.getmaxim.ai/)
- Prompt IDE with versioning, feature flags, A/B testing, gradual rollouts, automatic rollback. SOC 2 Type 2.

---

## 6. Prompt Versioning Platforms (LLMOps)

### Langfuse (Open Source, ~22.2K stars)
- **GitHub**: [langfuse/langfuse](https://github.com/langfuse/langfuse) | MIT License
- Prompt CMS with full version history, auto-sync to GitHub via webhooks, diff comparison, performance tracking per version. Fully open-sourced June 2025.

### Braintrust
- **Site**: [braintrust.dev](https://www.braintrust.dev/)
- Content-addressable versioning. Environment-based deployment. GitHub Action runs eval on every PR, blocks merge if thresholds fail.

### PromptLayer
- **Site**: [promptlayer.com](https://www.promptlayer.com/)
- Visual prompt registry. Auto-creates version with every LLM call. A/B releases. Regression testing against historical data.

### LangSmith Hub
- **Site**: [smith.langchain.com/hub](https://smith.langchain.com/hub)
- Every push = unique commit hash. Tags (dev/prod). Webhook triggers. Visual diffs. Tightly coupled to LangChain.

### Agenta (Open Source, MIT)
- **GitHub**: [Agenta-AI/agenta](https://github.com/Agenta-AI/agenta)
- Git-like versioning with branching. Side-by-side comparison against test cases.

### Latitude (Open Source, LGPL-3.0)
- **GitHub**: [latitude-dev/latitude-llm](https://github.com/latitude-dev/latitude-llm)
- Agent engineering platform. Versions prompts/agents, publishes, deploys via gateway.

### Mirascope / Lilypad (Open Source)
- **GitHub**: [Mirascope/lilypad](https://github.com/Mirascope/lilypad)
- Versioning, tracing, annotation for LLM apps.

### DSPy (Stanford NLP, ~16K stars)
- **GitHub**: [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy)
- Treats LLMs as programmable functions. Optimizes prompts algorithmically. Different paradigm — auto-optimization vs manual versioning.

---

## 7. Agent Framework State Management

### LangGraph
- **Docs**: [langchain docs](https://docs.langchain.com/oss/python/langgraph/persistence)
- Checkpointers save state at every super-step. SQLite/Postgres backends. Thread-based tracking.
- **Critical gap**: No built-in state schema versioning or migration ([open issue #536](https://github.com/langchain-ai/langgraphjs/issues/536)). Rollback discards intermediate results.

### CrewAI
- **GitHub**: [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
- Flow state persistence. Short/long-term/entity/contextual memory. Mem0 integration.
- **Gap**: No built-in monitoring, error recovery, or scaling.

### AG2 (formerly AutoGen)
- **GitHub**: [ag2ai/ag2](https://github.com/ag2ai/ag2)
- State management less mature than LangGraph. Relies on external integrations.

### Stately Agent (XState, 18 stars)
- **GitHub**: [statelyai/agent](https://github.com/statelyai/agent)
- State-machine-powered LLM agents. Early stage.

### Parlant
- **GitHub**: [emcie-co/parlant](https://github.com/emcie-co/parlant)
- Guideline-based compliance. Focused on customer experience agents.

---

## 8. Claude Code & OpenClaw Specific

### Claude Code Git Integration
- **Docs**: [code.claude.com](https://code.claude.com/docs/en/common-workflows)
- Built-in: branches, commits, merges, conflict resolution, PRs. Searches Git history to answer questions.

### Claude Code Worktrees
- **Blog**: [claudefa.st](https://claudefa.st/blog/guide/development/worktree-guide) | [aidisruption.ai](https://aidisruption.ai/p/claude-code-adds-native-git-worktree)
- Native worktree support for parallel agent work. `--worktree` flag. Each subagent gets isolated worktree. Auto-cleanup on session end.

### GitButler Agents Tab (for Claude Code)
- **Blog**: [blog.gitbutler.com/agents-tab](https://blog.gitbutler.com/agents-tab)
- Claude Code in Git workflow UI. Each branch = independent assistant. Multiple agents on parallel branches in same working directory. Shows todos, changed files, token usage, cost per branch.

### OpenClaw Backup Skill
- **Source**: [LobeHub](https://lobehub.com/skills/openclaw-skills-clawdbot-backup) | [Substack](https://dailyaistudio.substack.com/p/openclaw-and-git-backups)
- Full/selective backups of ~/.claude. Git-based version control for skill history. Timestamped snapshots.

### ClawHub (Skill Registry)
- **Site**: [clawhub.biz](https://clawhub.biz/)
- "npm for AI agents." 3,286+ skills. Full Semver with changelogs.

---

## 9. Standards & Conventions

### AGENTS.md (The Standard)
- **Site**: [agents.md](https://agents.md/) | [GitHub](https://github.com/agentsmd/agents.md)
- Vendor-neutral open standard. Plain Markdown. Adopted by **60,000+ projects**. Supported by OpenAI Codex, Google Jules, Cursor, Copilot, Devin, Gemini CLI. Under Linux Foundation.

### CLAUDE.md
- Claude Code specific config. Hierarchical. Committed to Git. Most tools now consolidate around AGENTS.md.

### .cursorrules → .cursor/rules
- Cursor-specific. Being superseded by AGENTS.md.

### Agent File (.af) Format
- **GitHub**: [letta-ai/agent-file](https://github.com/letta-ai/agent-file)
- Open standard for serializing stateful agents. Portable checkpointing and cross-framework transfer.

### A2A Protocol (Agent-to-Agent)
- **GitHub**: [a2aproject/A2A](https://github.com/a2aproject/A2A)
- Open protocol (Google, Linux Foundation). Agent Cards describe capabilities. Tasks are stateful. Protocol version negotiation. **Does NOT address internal agent state versioning.**

### MCP Versioning
- **Spec**: [modelcontextprotocol.io](https://modelcontextprotocol.io/specification/versioning)
- Protocol-level versioning only. Current: 2025-11-25.

---

## 10. MLOps Tools Extended for Agents

### MLflow 3.0
- Prompt Registry with Git-style tracking, visual diffs, instant rollback. LoggedModel connects agents to exact code versions, prompt configs, eval runs.

### W&B Weave
- **GitHub**: [wandb/weave](https://github.com/wandb/weave)
- @weave.op decorator for automatic tracking. Agent trace tracking. Tags and versioning.

### ZenML (Apache 2.0)
- **GitHub**: [zenml-io/zenml](https://github.com/zenml-io/zenml)
- Every model, prompt, dataset auto-versioned. Orchestrates LangGraph loops in unified DAGs.

---

## 11. Thought Leadership & Key Posts

### Andrej Karpathy: "Agents Need Diffs"
- **Via**: [DoltHub](https://www.dolthub.com/blog/2025-10-30-karpathy-agents-need-diffs/)
- Diff is a prerequisite for agentic workflows in ANY domain. In code, diffs available via Git. In slides, documents, databases — diffs not available, blocking agent adoption. "Human in the loop" at scale requires clone, branch, merge, diff.

### CIO.com: "Why Versioning AI Agents is the CIO's Next Big Challenge"
- **Article**: [CIO.com](https://www.cio.com/article/4056453/why-versioning-ai-agents-is-the-cios-next-big-challenge.html)
- Most teams version only prompts = "dangerously insufficient." Agent behavior depends on 4 layers: reasoning architecture, instruction layer, model config, tool dependencies. Each needs independent versioning. Multi-agent = version inter-agent dependencies. Ring deployment model (inner/middle/outer).

### Medium: "AI-Native Git: Version Control for Agent Code"
- **Article**: [Medium](https://medium.com/@ThinkingLoop/ai-native-git-version-control-for-agent-code-a98462c154e4)
- Git designed for human-authored code. Agent code operates at speeds no human team can match. Need reimagined version control purpose-built for automation.

### Medium: "From Token Streams to Version Control"
- **Article**: [Medium](https://medium.com/@balajibal/from-token-streams-to-version-control-git-style-context-management-for-ai-agents-feca049fd521)
- Git-style protocols led agents to spontaneously adopt disciplined behaviors: modularizing code, writing tests before committing, branching to explore ideas — **without being explicitly told to do so**.

### Medium: "Versioning, Rollback & Lifecycle Management of AI Agents"
- **Article**: [Medium](https://medium.com/@nraman.n6/versioning-rollback-lifecycle-management-of-ai-agents-treating-intelligence-as-deployable-deac757e4dea)
- Tool versioning = 60% of production failures. Model drift = 40%. Need semantic versioning for all agent-accessible tools. Agent CI/CD must validate toolchain compatibility.

### DEV.to: "AI Agents Behavior Versioning and Evaluation"
- **Article**: [DEV.to](https://dev.to/bobur/ai-agents-behavior-versioning-and-evaluation-in-practice-5b6g)
- Agent behavior depends on 4 interdependent layers (model, prompt, tools/MCP, context). Each requires independent version tracking.

### DoltHub Blog Series (most comprehensive)
- Covers: why agents need version control, branches, clones, diffs, and memory — all through the lens of database systems.

---

## 12. Hacker News Discussions

| Thread | Date | Key Insight |
|--------|------|------------|
| [Show HN: Legit, Git-based VC for AI agents](https://news.ycombinator.com/item?id=46548475) | Jan 2026 | Open source git-based version control for agents |
| [WIP — Version control for AI agents. Diffs, rollback, sandbox](https://news.ycombinator.com/item?id=46032163) | Nov 2025 | Early-stage tool development |
| [Version Control for AI Coding](https://news.ycombinator.com/item?id=44432272) | Jul 2025 | AST-based merge (Mergiraf), AI-powered conflict resolution |
| [Provenance Is the New Version Control](https://news.ycombinator.com/item?id=46597023) | 2026 | Provenance as foundation |
| [Show HN: Vigilo — Local audit trail for AI coding agents](https://news.ycombinator.com/item?id=47144737) | 2026 | Local-first audit |
| [Lix — universal VC for binary files](https://news.ycombinator.com/item?id=46713387) | 2026 | Embeddable VC for agents |
| [How do you manage prompt versioning?](https://news.ycombinator.com/item?id=47003317) | Feb 2026 | A/B testing, sharing, reuse |
| [How are you managing your prompts?](https://news.ycombinator.com/item?id=43753180) | Apr 2025 | Cost-benefit of prompt management |

---

## 13. Provenance & Audit Trails

| Tool | What it does |
|------|-------------|
| [PROV-AGENT](https://arxiv.org/abs/2508.02866) | Unified provenance graph for agent workflows |
| [Agent Trace](https://agent-trace.dev/) | Typed nodes, temporal/semantic edges, explicit change events |
| [Vigilo](https://github.com/Idan3011/vigilo) | Local audit trail, append-only JSONL, encrypted |
| [Entire CLI](https://www.techedubyte.com/entire-cli-git-observability-ai-agents-ex-github-ceo/) | Git observability layer by ex-GitHub CEO |

---

## 14. Key Problems Identified (Synthesis)

### Why Git Alone Doesn't Work for Agents

1. **Agent behavior depends on more than code.** Four layers need versioning: reasoning architecture, instruction layer, model config, tool dependencies. Git only tracks code.

2. **Machine-pace vs human-pace.** Git commits are intentional human decisions. Agents change state thousands of times daily. No human deciding "time to commit."

3. **Non-code domains have no version control at all.** Agents in documents, databases, spreadsheets fail because those domains have no diff/merge/branch. (Karpathy's key insight.)

4. **Tool versioning is the #1 killer.** 60% of production failures. A minor API update in a tool changes agent behavior with no code diff to show why.

5. **Memory is stateful and evolving.** A new agent version may behave differently because of accumulated experience, not code changes. Git can't capture this.

6. **Multi-agent dependency hell.** Updating one agent breaks the collective. Inter-agent communication protocols need versioning.

7. **Privacy is per-path, not per-repo.** Git treats everything as one privacy unit. Agent state has public fields (identity), private fields (skills), and secret fields (keys) — all in one "repo."

8. **Reproducibility is nearly impossible.** Without versioning code + prompts + models + hyperparameters + tools + embeddings + memory together, you cannot reproduce agent behavior at a given point in time.

9. **Schema migration doesn't exist.** LangGraph explicitly lacks state schema versioning ([open issue](https://github.com/langchain-ai/langgraphjs/issues/536)). Older states become incompatible as agents evolve.

10. **"Human in the loop" at scale requires full VC primitives.** Clone, branch, diff, merge — for every data type agents touch. Not just code.

### What Nobody Has Built Yet

1. **No unified "Git for agents"** — no single tool versions ALL agent components (prompts + model config + tools + memory + eval results) together as an atomic unit.

2. **No cross-framework portability** — agent configs fragmented across AGENTS.md, CLAUDE.md, .cursorrules. Runtime behavior is not portable.

3. **No multi-agent system versioning** — AgentGit is the only paper. Production tooling for versioning multi-agent orchestrations is essentially nonexistent.

4. **No agent identity versioning** — A2A has Agent Cards, MCP has protocol versioning, but no standard for versioning the "identity" of an agent in a machine-readable, Git-compatible way.

5. **No semantic auto-versioning** — no tool automatically determines which state changes are meaningful enough to version.

6. **No attestation in version history** — git has GPG signing (who authored). Agents need "who VERIFIED this state" — external attestations embedded in history.

---

## 15. Solutions Landscape Summary

| Approach | Examples | What It Solves |
|----------|----------|---------------|
| Git-native agent integration | Legit, GitButler, Claude Code worktrees | Code-level VC for agent outputs |
| Git-like state management | AgentGit, GCC, Letta MemFS | State commit/revert/branch for execution trajectories |
| Embeddable version control | Lix | Semantic diffs for any file type |
| Database branching | Dolt, Neon | VC for data agents operate on |
| Agent filesystem | AgentFS (Turso) | Single-file portable runtime with audit trail |
| Prompt versioning | PromptLayer, Langfuse, Braintrust | Track/compare/rollback prompts |
| Agent memory systems | Letta MemFS, MemOS, Mem0 | Versioned persistent memory |
| Enterprise agent CI/CD | Decagon, Azure Foundry, ElevenLabs | Governance, audit, staged rollout |
| Agent file formats | Letta .af | Portable agent state for checkpointing |
| Provenance tracking | PROV-AGENT, Agent Trace, Vigilo | Traceability of agent decisions |
| Agent operating systems | AIOS, MemOS | Full state snapshots, time-travel debugging |
| Config standards | AGENTS.md | Predictable agent configuration |
| Observability layers | Entire CLI, Vigilo | Monitoring what agents actually do |
