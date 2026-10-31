.PHONY: ci ci-container

ci: ## style, lint, i18n, unit tests, build and e2e through the single CI entry point
	ci/run.sh

ci-container: ## the same inside the image of ci/Dockerfile
	ci/run.sh --container
