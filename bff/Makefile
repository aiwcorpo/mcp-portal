.PHONY: ci ci-container test

ci: ## style checks and ./mvnw verify through the single CI entry point
	ci/run.sh

ci-container: ## the same inside the image of ci/Dockerfile
	ci/run.sh --container

test:
	./mvnw -B test
