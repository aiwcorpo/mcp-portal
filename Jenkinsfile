// Isolation is configured in Jenkins and described in bff/README.md ("CI"): the "docker" node accepts jobs of main only, and pull
// requests take the Jenkinsfile from the trusted branch. No credentials are bound: the mcp-contracts artifacts come from Maven Central
// and npmjs; CONTRACTS_TARBALL_URL and CONTRACTS_TARBALL_SHA256 are set on the job when the package comes from the internal server.
pipeline {
    agent none
    stages {
        stage('bff') {
            when { branch 'main' }
            agent { docker { image 'maven:3.9.12-eclipse-temurin-25' } }
            steps {
                dir('bff') {
                    sh './mvnw -B verify'
                }
            }
            post { always { junit 'bff/target/surefire-reports/TEST-*.xml' } }
        }
        stage('web') {
            when { branch 'main' }
            agent {
                docker {
                    image 'mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea'
                    args '-e HOME=/tmp/ci-home'
                }
            }
            environment {
                CI = '1'
                PW_WORKERS = '4'
            }
            steps {
                dir('web') {
                    sh '''
                        scripts/contracts.sh
                        npm ci --no-audit --no-fund
                        npm run lint
                        npm run i18n:check
                        npm test
                        npm run build
                        npm run e2e
                    '''
                }
            }
        }
    }
}
