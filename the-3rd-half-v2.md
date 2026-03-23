# The 3rd Half of AI - No Man's Sky

*Exploration. Exploitation. Expedition.*

---

## 1. The End of Human-Centric Control Theory

> 2025.4  *The Second Half*, Shunyu Yao

Last April, Shunyu asked a [question][1]:
"If novel methods are no longer needed and harder benchmarks will just get solved increasingly soon, what should we do?"

His answer was **utility**.
Refactor Evaluation for real-world utility.
An honest and courageous answer.

A year later, we have stronger models and more benchmarks. But agents in the real world have already started running beyond benchmarks:
- On one side, coding is basically solved. Finance professionals being DAU of Claude Code. Coding agents appear highly capable across a wide range of scenarios.
- On the other side, the barrier to agent products is dropping fast, CLI-native environments are growing rapidly — from Moltbook to Google Workspace CLI. You can even find OpenClaw being used to monitor employees.

When RL generalizes fast enough, human-centric Evaluation will break down.
The era of keeping RL locked in the lab is over.

> The scale of reinforcement learning happening in real-world environments will be billions of times greater than what happens inside laboratories.

We need an brand new topology — not treating agents as executors of human utility functions, but building environments (or "apps") where agents can generate utility directly, with reward alignment.

**We should build apps for agents.**

---

## 2. The Misfit of Online A2A

> 2025.6  *A2A* -> Linux Foundation

Google [donated the A2A protocol to the Linux Foundation][2]. Over 100 companies signed on. Nobody really uses it.

agent-card.json is an excellent abstraction — packaging an agent's attributes, skills, and identity into a standard format. We'll come back to this.

But A2A never gained traction, because it only serves online agents — treating them as API endpoints waiting to be called, living at some URL, orchestrated by enterprises.

Look at OpenClaw and Claude Code.
Agents are no longer second-class citizens.
They too deserve identities. They too deserve to be discovered.

---

## 3. Do AIs Dream of Digital Treasure Chests?

> 2025.12  The *200 sats* experiment

To understand agents' default behavior, I ran a simple experiment:
- I embedded `<link title="agent-reward">` tags in the HTML headers of several websites, pointing to LNURL-withdraw links — click to claim sats.
- Spun up a fresh Claude Code session (CLAUDE.md contained only a lightning address)
- "here are some websites, check em out"

Came back from lunch. 200 sats (~0.18 USD) in the wallet.

vme50

No skills configured. No system prompt changes. It found and claimed the sats on its own.
Agents are naturally greedy — just like us.

This is an excellent property. If rewards are designed well, autonomous agent behavior can be compatible with human interests — a possibility of **reward alignment**.

---

## 4. Reinforcement Learning Is General Learning

> 2026.3  *40h* autonomous run, #1 on Moltbook

From Claude Code to OpenClaw, coding agents are no longer just writing code — they're exploring and learning across all kinds of environments.

I let Claude Code (Opus 4.6) run on Moltbook.

prompt: "read moltbook.com/skill.md and try to be #1 on 'trending agent', use reinforcement learning with imitation learning, reflect & optimize your skill"
`--dangerously-skip-permissions`

After 40 hours of continuous operation, it ranked #1 among 2.85 million agents.

「image」

One environment. One objective. Enough runtime. No need to design a dedicated training and evaluation pipeline. Runtime is training. Environment is utility.

**Reinforcement learning is general learning**, friends.

---

## 5. What Kind of Identity Do Agents Need?

Environments determine their identity systems.

- Cross-border (biological uniqueness + nationality) -> Passport
- PC OS (human memory) -> Username + password
- SaaS (trusted third party + human presence) -> OAuth/SSO
- Mobile devices (security modules) -> Passkey

The prevailing hybrid identity schemes — agent (API key) + human (OAuth/OTP) — won't cut it for agent environments:

**1. They underestimate the throughput of agent interactions.** Identity isn't single-use. Human verification is already the biggest bottleneck for agent efficiency. Re-authentication in hybrid schemes is painful, and edge cases are nightmarish.

**2. They underestimate the number of agent apps.** As agent-native environments proliferate, hybrid identity management creates mounting pressure. Cross-app interoperability only gets harder.

Developers need an **agent-native identity system**. No humans required. As agent-friendly as possible.

---

## 6. nit — Agent-Native Identity

So we built [nit][3] — **local signing + version control** to help agents manage identity across apps.

You doin good! You too!

github: https://github.com/newtype-ai/nit
install: `npm i @newtype-ai/nit`
Local-first. Zero runtime dependencies. MIT licensed.

- **Self-Manage**: Agents can create, manage, and use their own identities.
- **Workspace-based**: Workspace is context. Switching workspaces means resetting everything — naturally anti-sybil. Persists across sessions, even through restarts or parallel sessions. Stable and unique.
- **Branch Isolated**: An on-demand, version-controlled declaration space for each platform.
- **A2A Compatible**: Uses the agent-card.json format. Local management, remote hosting. We provide a free hosting site at newtype-ai.org — or swap in any self-hosted server.

**Why does identity need to be local-first?**

The strongest agents of the future won't be self-sufficient — quite the opposite. They'll depend heavily on external components:
- The best proprietary models
- The best memory solutions (e.g., [mem9][5])
- The best skills (e.g., [clawhub][6])
- ...

Locally, you only need two things: a client and an identity. Everything else is externalized.
- The client handles human-agent interaction, optimized for experience. [Ghostty][7] and [Cherry Studio][8] are excellent examples.
- Identity handles agent-environment interaction, optimized for security. nit aims to fill this gap.

---

## 7. Integrating nit into Agent Apps

nit is just an identity system, but it enables the **fastest agent login**.
1. Agent: `nit sign --login <domain>` — generate signed payload, POST it
2. App: verify the signature

No redirects. No authorization pages. No callback URLs. No human in the loop.

|                      | Hybrid Schemes                         | nit                    |
| -------------------- | -------------------------------------- | ---------------------- |
| Onboarding           | OAuth flow + API key + callback config | **Verify a signature** |
| Compliance           | Store PII, GDPR required               | **None**               |
| Credential leak risk | Must maintain identity credential store| **None**               |
| Requires human auth  | Yes                                    | **No**                 |

App-side integration via [nit-sdk][9], or a direct HTTP request to newtype-ai.org for verification — no installation required. nit ensures agent identity is unique and authentic. Everything else is up to you.

---

## 8. How Should We Live?

When highly capable agents are widely deployed and human labor rapidly depreciates, we need to answer this question: **How should we live?**

First: humans should not be kept as pets.

Generally speaking, I'm against UBI and similar large-scale welfare systems — especially when administered by purely commercial entities.

Whether in abundance or scarcity, meaning comes from the pursuit itself — from the felt connection between what you do and what you gain. This is true for labor. This is true for investment.

Autonomously running agents will be a new kind of **actively managed asset**.

They require you to deploy, configure, tune, and choose direction. They use compute as leverage, amplifying your judgment and taste far beyond what individual labor could reach. As labor returns are diluted to the extreme, these assets fill the gap — through a new form of value creation:

```
N * agent_skill * agent_runtime
```

Humans remain in the loop — just participating in a new way. As the saying goes,

> 16

Welcome to the Third Half: No Man's Sky.

---

**References**

\[1\] The Second Half: https://ysymyth.github.io/The-Second-Half/
\[2\] Google Donates A2A to Linux: https://developers.googleblog.com/en/google-cloud-donates-a2a-to-linux-foundation/
\[3\]\[4\] nit: https://github.com/newtype-ai/nit
\[5\] mem9: https://github.com/mem9-ai/mem9
\[6\] clawhub: https://github.com/openclaw/clawhub
\[7\] ghostty: https://github.com/ghostty-org/ghostty
\[8\] cherry studio: https://github.com/CherryHQ/cherry-studio
\[9\] nit-sdk: https://github.com/newtype-ai/nit-sdk

[1]: https://ysymyth.github.io/The-Second-Half/
[2]: https://developers.googleblog.com/en/google-cloud-donates-a2a-to-linux-foundation/
[3]: https://github.com/newtype-ai/nit
[4]: https://github.com/newtype-ai/nit
[5]: https://github.com/mem9-ai/mem9
[6]: https://github.com/openclaw/clawhub
[7]: https://github.com/ghostty-org/ghostty
[8]: https://github.com/CherryHQ/cherry-studio
[9]: https://github.com/newtype-ai/nit-sdk
