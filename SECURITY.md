# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| < 0.3.0 | No |

Only the latest released version receives security updates.

## Scope

Pactium is a protocol substrate that records operation metadata and produces cryptographic proofs. Its security boundary includes:

- Canonical Value encoding and Protocol Hash integrity
- Ledger Transparency Log append-only guarantees
- Proof Envelope and Proof Bundle tamper detection
- Content-addressed storage integrity
- Signed Ledger Head verification
- Critical extension binding verification

### Out of Scope

Host systems are responsible for:

- Authentication and authorization
- Network exposure and TLS termination
- Tenant isolation
- Secret management and key rotation
- Side-effect execution security
- Durable Host Evidence storage security

Pactium should be embedded behind the host system's security boundary.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

### Preferred method

Report security issues privately through [GitHub Security Advisories](https://github.com/Unka-Malloc/Pactium/security/advisories/new).

### Alternative method

If you cannot use GitHub Security Advisories, email the repository owner directly. Include:

1. Description of the vulnerability
2. Steps to reproduce
3. Affected versions
4. Potential impact assessment
5. Suggested fix (if any)

### What to expect

- **Acknowledgment**: within 72 hours of receipt
- **Initial assessment**: within 7 days
- **Fix timeline**: critical vulnerabilities targeted within 14 days; others within 30 days
- **Disclosure**: coordinated disclosure after a fix is available

### What qualifies

- Proof forgery or proof bypass without detection
- Ledger append-only violation
- Hash collision exploitation in Protocol Hash
- Content-addressed storage integrity bypass
- Signed head signature bypass
- Critical extension binding circumvention
- Information disclosure through proof material

### What does not qualify

- Denial of service through large inputs (Pactium is not a network service)
- Side-channel timing attacks on non-constant-time operations that are not signing verification
- Issues requiring physical access to the machine running Pactium
- Social engineering of host system users

## Security Design

Pactium's proof model is designed so that:

- Every write operation produces a verifiable receipt (Proof Envelope)
- Ledger history cannot be silently rewritten (consistency proofs detect divergence)
- Proof material is content-addressed (tampering is detectable)
- Critical extensions must be understood by verifiers (unknown extensions fail verification)
- Repair operations are explicit ledger facts, not silent mutations

## Acknowledgments

We appreciate responsible disclosure. Contributors who report valid security vulnerabilities will be acknowledged in the release notes (unless they prefer anonymity).
