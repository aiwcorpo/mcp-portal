# Install the portal

The portal (the BFF with the single-page application inside) in one container on one Linux host with Docker. It has no database and no
Redis: sessions are in memory, so a restart signs everybody out and a second instance needs a proxy with sticky sessions. The other
components (identity provider, gateway, credential broker) run elsewhere; you give their addresses here.

## Prerequisites

- Linux, Docker Engine with Compose v2.20 or newer, 1 GiB of memory.
- From your internal CA: a client certificate for the portal with CN `mcp-portal-bff` (the gateway admin API and the broker accept no
  other name), and the CA certificate.
- A confidential client for the portal at the identity provider (Keycloak: `mcp-portal-bff`, standard flow) with the redirect URI
  `<public address>/api/v1/auth/callback`, and its secret.
- The address of the gateway admin API (`https://<gateway>:8443`) and of the credential broker (`https://<broker>:8443`).
- A TLS reverse proxy for the public address, the same one that serves the gateway. It forwards `/mcp`, `/s/`, `/v/` and
  `/.well-known/oauth-protected-resource` to the gateway, everything else (the pages and `/api`) to port 8080 of this host, and
  refuses `/admin/v1/` with 404: the admin API of the gateway is reached by the portal on port 8443, never through the proxy.

## Install

1. Get this directory (`deploy/` of the repository) on the host and change into it.
2. Put two files in `certs/`:

    | File | What |
    | --- | --- |
    | `keystore.p12` | the portal client certificate and its key |
    | `truststore.p12` | the internal CA certificate |

    Each store has its own password (they may be equal). From PEM files:

    ```bash
    openssl pkcs12 -export -inkey portal.key -in portal.crt -certfile ca.crt -name mcp-portal-bff -out certs/keystore.p12
    keytool -importcert -noprompt -alias ca -file ca.crt -keystore certs/truststore.p12 -storetype PKCS12
    ```

3. Fill in the empty values in `portal.env`, and the systems of your installation in `iga-catalog.yaml`.
4. Start:

    ```bash
    docker compose up -d
    ```

The portal keeps no state, so `init` generates nothing. It runs before the portal on every start and checks what the portal needs:

```console
$ docker compose logs init
ok    public address https://mcp.corp.test, login callback https://mcp.corp.test/api/v1/auth/callback
warn  PORTAL_TRUSTED_PROXIES is not set: X-Forwarded-* is trusted from the loopback address only, so a reverse proxy on another host is not believed
ok    IGA catalog /config/iga-catalog.yaml: 5 system(s)
FAIL  identity provider https://idp.corp.test/realms/corp/.well-known/openid-configuration: the name does not resolve from this host (DNS or /etc/hosts)
ok    portal certificate /certs/keystore.p12 and internal CA /certs/truststore.p12
warn  credential broker https://mcp-credential-broker.corp.test:8443: connection refused; nothing listens on that port, or the service is not running yet
ok    gateway admin API https://mcp-gateway.corp.test:8443
```

A `FAIL` stops the start: fix it and run `docker compose up -d` again. Without the identity provider nobody can sign in, so that is
a `FAIL` (the discovery document must also name the issuer you configured). The broker and the gateway only warn, because they may be
installed after the portal and the portal starts without them. Their certificates must name `PORTAL_BROKER_TLS_NAME` and
`PORTAL_GATEWAY_ADMIN_TLS_NAME`, and be signed by the CA in `truststore.p12`.

## Catalog of entitlements

`iga-catalog.yaml` lists, per system, the entitlements (groups at the identity provider) that users see under access requests. The
portal does not start with an empty catalog, so the file has the systems of the standard installation; keep the ones you use and add a
line per system you add. Restart the portal (`docker compose restart portal`) after a change.

## Certificate of the identity provider

The portal reaches the identity provider with the trust store of the JVM, not with `truststore.p12`. If the identity provider has a
certificate from your company CA, `init` says so. Build a store with that CA and turn on the `JAVA_TOOL_OPTIONS` line in `portal.env`
(the container mounts `certs/`, so the file goes there):

```bash
keytool -importcert -noprompt -alias corp-ca -file corp-ca.crt -keystore certs/jvm-truststore.p12 -storetype PKCS12 -storepass changeit
```

## Two names for the identity provider

When the browser reaches the identity provider under a public name and this host under another, discovery under the issuer cannot
work. Set the explicit addresses in `portal.env` (`PORTAL_OIDC_AUTHORIZATION_URI` for the browser, `PORTAL_OIDC_TOKEN_URI`,
`PORTAL_OIDC_JWK_SET_URI` and the optional two for the portal). `PORTAL_OIDC_ISSUER_URI` stays the value of the `iss` claim. `init` then
checks the keys address instead of the discovery document.

## Ports

| Port | For |
| --- | --- |
| 8080 | Plain HTTP for your reverse proxy. Bound to 127.0.0.1; for a proxy on another host set `PORTAL_HTTP_BIND=0.0.0.0` (and `PORTAL_HTTP_PORT` for another host port) in a `.env` file here, and list the proxy in `PORTAL_TRUSTED_PROXIES`. |

## Closed network

Copy the image to your registry and point Compose at it in a `.env` file next to `compose.yaml`:

```bash
MCP_REGISTRY=artifactory.corp.test/mcp
```

## Upgrade

Change `MCP_PORTAL_VERSION` in `.env` (or take the new directory) and run `docker compose up -d`.

## Virtual machine without Docker

`systemd/` has a unit and its environment file for a portal from the jar and the built application (`./mvnw package` in `bff/` makes the
jar, `npm run build` in `web/` makes `dist/portal`). The unit runs the same `init` before every start.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin portal
sudo install -d -o root -g portal -m 0750 /etc/mcp-portal /opt/mcp-portal
sudo install -m 0644 bff/target/mcp-portal-bff-2.0.1.jar /opt/mcp-portal/portal.jar
sudo cp -r web/dist/portal /opt/mcp-portal/web
sudo install -o root -g portal -m 0640 deploy/iga-catalog.yaml /etc/mcp-portal/iga-catalog.yaml
sudo install -o root -g portal -m 0640 deploy/systemd/mcp-portal.env /etc/mcp-portal/mcp-portal.env   # then fill it in
sudo install -m 0644 deploy/systemd/mcp-portal.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now mcp-portal
```
