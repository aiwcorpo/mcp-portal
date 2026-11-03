# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: Security tab of this repository, "Report a vulnerability"
(private vulnerability reporting). Do not open a public issue for a security problem.

Include the affected version or image tag, the component (`bff` or `web`), the configuration involved and steps to
reproduce. In scope: a response of the BFF that carries an access token, a refresh token or a secret; a state-changing
request accepted without the CSRF header or from another origin; a step-up operation (lifting an emergency switch,
lowering a risk, registering or removing the Authenticator) that succeeds without a fresh MFA; a return path that leaves
the portal; text of a target system or an agent that reaches the page without its hidden characters written out; a
route of the single-page application that answers with HTML under `/api`.

## Scope

In scope: the BFF (`bff/`), the single-page application (`web/`) and the images built from this repository.

Out of scope:

- The `dev` profile of the BFF (mock identity provider, IGA mock, plain-http upstreams) relaxes TLS and mTLS by design.
  The BFF refuses to start with those settings outside the profile.
- The gateway, the credential broker, the policies and the contracts are separate repositories.
- Mock data in `web/src/mocks` and `bff/dev` is test data and not meant for production.

## Supported versions

Only the latest released version receives fixes. Published versions are immutable; a fix ships as a new release.
