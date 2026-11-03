# Images of the portal. The build context holds only the results of the two builds, so a Dockerfile build needs no
# network and no registry credentials: `scripts/build-images.sh` (or the release workflow) builds the jar and the
# single-page application first, from a clean checkout of a git ref, and tags the images m6-<sha>.
#
#   bff     the Spring Boot BFF (port 8080); the single-page application is served by the reverse proxy in front
#   web     nginx with the built single-page application (port 8080, no state), for that reverse proxy
#   portal  the BFF with the application inside: one container, one origin (PORTAL_WEB_DIST=/app/web)
#
# The base images are pinned by digest; a digest is bumped on purpose, with a rebuild and the tests of the portal.
ARG JRE_IMAGE=eclipse-temurin:25-jre-alpine@sha256:b7528962e65d43064d8a8b67ba175367896bc948363ea2d3fcd7f10d34e1f048
ARG NGINX_IMAGE=nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

FROM ${JRE_IMAGE} AS bff
RUN addgroup -S portal && adduser -S -G portal -H -h /app portal
WORKDIR /app
COPY --chown=root:root bff/target/mcp-portal-bff-*.jar /app/app.jar
COPY --chown=root:root bff/docker/entrypoint.sh /app/entrypoint.sh
ENV PORTAL_PORT=8080
USER portal
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]

FROM bff AS portal
COPY --chown=root:root web/dist/portal /app/web
ENV PORTAL_WEB_DIST=/app/web

FROM ${NGINX_IMAGE} AS web
COPY web/docker/nginx.conf /etc/nginx/nginx.conf
COPY web/dist/portal /usr/share/nginx/html
USER 101
EXPOSE 8080
