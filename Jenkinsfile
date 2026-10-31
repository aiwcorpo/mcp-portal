// Thin wrapper: all logic is in bff/ci/run.sh and web/ci/run.sh.
// This file only names the stages; isolation is configured in Jenkins and described in bff/README.md ("CI"): the style stage
// runs on the pool labelled ci-style (no Docker socket), the credentials mcp-maven-registry* are scoped to the main branch
// folder, the "docker" node accepts jobs of main only, and pull requests take the Jenkinsfile from the trusted branch.
pipeline {
    agent none
    stages {
        stage('style') {
            agent { label 'ci-style' }
            environment { CI_STEPS = 'style' }
            steps { sh 'bff/ci/run.sh && web/ci/run.sh' }
        }
        stage('bff') {
            when { branch 'main' }
            agent { docker { image 'maven:3.9.12-eclipse-temurin-25' } }
            environment {
                MCP_MAVEN_REPOSITORY_URL = credentials('mcp-maven-registry-url')
            }
            steps {
                withCredentials([usernamePassword(credentialsId: 'mcp-maven-registry', usernameVariable: 'MCP_MAVEN_REPOSITORY_USER', passwordVariable: 'MCP_MAVEN_REPOSITORY_PASSWORD')]) {
                    sh 'bff/ci/run.sh'
                }
            }
            post { always { junit 'bff/target/surefire-reports/TEST-*.xml' } }
        }
        stage('web') {
            when { branch 'main' }
            agent { label 'docker' }
            steps { sh 'web/ci/run.sh --container' }
        }
    }
}
