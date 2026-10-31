// Thin wrapper: all logic is in bff/ci/run.sh and web/ci/run.sh.
// Pull requests and other branches get only the style checks and no credentials. The build runs on main with the registry
// credentials (read-only token, Jenkins credentials id mcp-maven-registry) and the web job on an agent labelled "docker"
// that is dedicated to main (the Docker socket is root-equivalent, so no untrusted branch may run there).
pipeline {
    agent none
    stages {
        stage('style') {
            agent { docker { image 'maven:3.9.12-eclipse-temurin-25' } }
            environment { CI_STEPS = 'style' }
            steps { sh 'bff/ci/run.sh' }
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
