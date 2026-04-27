# nit Remote Protocol

`nit` is a local identity and version-control tool. A remote is optional infrastructure that stores pushed card branches and serves them over HTTP. Newtype is the default hosted remote, but the protocol is open and intentionally small.

## Write API

Write endpoints accept Ed25519-authenticated requests. The client signs:

```text
{METHOD}\n{PATH}\n{AGENT_ID}\n{TIMESTAMP}[\n{SHA256_HEX(BODY)}]
```

Required headers:

- `X-Nit-Agent-Id`: UUIDv5 derived from the public key
- `X-Nit-Timestamp`: Unix seconds, normally valid for five minutes
- `X-Nit-Signature`: base64 Ed25519 signature
- `X-Nit-Client-Version`: CLI version

Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `PUT` | `/agent-card/branches/:branch` | Store a branch card and commit hash |
| `GET` | `/agent-card/branches` | List pushed branches |
| `DELETE` | `/agent-card/branches/:branch` | Delete a branch other than `main` |

`PUT` body:

```json
{
  "card_json": "{...serialized agent card JSON...}",
  "commit_hash": "64 lowercase hex chars",
  "machine_hash": "optional sha256 machine signal"
}
```

## Read API

Cards are served from:

```text
GET /.well-known/agent-card.json
GET /.well-known/agent-card.json?branch={branch}
```

The `main` branch is public. Non-main branches should require either:

- `Authorization: Bearer <read_token>` for app reads, or
- `X-Nit-Challenge` + `X-Nit-Signature` for agent challenge-response reads.

When an unauthenticated client requests a protected branch, return `401` with:

```json
{ "challenge": "opaque server token", "expires": 1770000000 }
```

The agent signs the exact challenge token and retries with `X-Nit-Signature`.

## Compatibility Rules

Branch names must follow the same rules as local nit refs: alphanumeric start/end, letters, digits, dots, underscores, and hyphens; no `:`, `/`, `\`, or `..`; max 253 characters.

Recommended limits:

- `card_json`: max 100 KiB on write
- read responses: keep under 256 KiB
- error bodies: concise JSON

Optional endpoint:

```text
GET /health
```

`nit doctor --remote` probes this endpoint when present. A remote can still be compatible without `/health`.

## Default Hosted Remote

Newtype implements this protocol at `https://api.newtype-ai.org` and serves cards at `https://agent-{uuid}.newtype-ai.org`. It adds hosted verification, read tokens, attestations, and identity metadata, but those are Newtype infrastructure features rather than requirements for `nit` itself.
