/**
 * The pipelines of the API trigger dialog. The CI ones run the skyfay/dbackup:ci image, which
 * starts the job and waits for its run, and read the address and the key from secrets, so only the
 * job ID is in the file.
 */
import type { TriggerExample, TriggerTarget } from "./api-trigger-examples";

const github = ({ jobId }: TriggerTarget) => `# .github/workflows/backup.yml
name: Trigger Database Backup

on:
  schedule:
    - cron: "0 2 * * *"  # Daily at 2:00 AM UTC
  workflow_dispatch:       # Allow manual trigger

jobs:
  backup:
    runs-on: ubuntu-latest
    container: skyfay/dbackup:ci
    steps:
      - name: Trigger and wait for backup
        run: /backup/execute.sh
        env:
          DBACKUP_URL: \${{ secrets.DBACKUP_URL }}
          DBACKUP_API_KEY: \${{ secrets.DBACKUP_API_KEY }}
          JOB_ID: "${jobId}"
          # DBACKUP_SKIP_TLS_VERIFY: "1"  # Uncomment if using self-signed certificates
          # DBACKUP_TIMEOUT: "7200"       # Seconds to wait for the run, one hour by default`;

const gitlab = ({ jobId }: TriggerTarget) => `# .gitlab-ci.yml
stages:
  - backup

trigger_backup:
  stage: backup
  image: skyfay/dbackup:ci
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"  # Triggered by GitLab schedule
    - if: $CI_PIPELINE_SOURCE == "web"       # Allow manual trigger
  variables:
    DBACKUP_URL: \${DBACKUP_URL}             # Set in CI/CD Settings → Variables
    DBACKUP_API_KEY: \${DBACKUP_API_KEY}     # Set as masked variable
    JOB_ID: "${jobId}"
    # DBACKUP_SKIP_TLS_VERIFY: "1"          # Uncomment if using self-signed certificates
    # DBACKUP_TIMEOUT: "7200"               # Seconds to wait for the run, one hour by default
  script:
    - /backup/execute.sh`;

const azure = ({ jobId }: TriggerTarget) => `# azure-pipelines.yml
trigger: none

schedules:
  - cron: "0 2 * * *"  # Daily at 2:00 AM UTC
    displayName: Daily backup
    branches:
      include:
        - main
    always: true

stages:
  - stage: Backup
    jobs:
      - job: TriggerBackup
        displayName: Trigger dbackup job
        container: skyfay/dbackup:ci
        steps:
          - script: /backup/execute.sh
            displayName: Trigger and wait for backup
            env:
              DBACKUP_URL: $(DBACKUP_URL)          # Defined as a pipeline variable
              DBACKUP_API_KEY: $(DBACKUP_API_KEY)  # Defined as a secret pipeline variable
              JOB_ID: "${jobId}"
              # DBACKUP_SKIP_TLS_VERIFY: "1"        # Uncomment if using self-signed certificates
              # DBACKUP_TIMEOUT: "7200"             # Seconds to wait for the run, one hour by default`;

const ansible = ({ baseUrl, jobId, apiKey }: TriggerTarget) => `# backup-playbook.yml
- name: Run the DBackup job and wait for it
  hosts: localhost
  vars:
    dbackup_url: "${baseUrl}"
    dbackup_api_key: "${apiKey}"  # Better kept in Ansible Vault
    job_id: "${jobId}"

  tasks:
    - name: Start the job
      ansible.builtin.uri:
        url: "{{ dbackup_url }}/api/jobs/{{ job_id }}/run"
        method: POST
        headers:
          Authorization: "Bearer {{ dbackup_api_key }}"
        status_code: 200
      register: run

    - name: Wait until the run is done
      ansible.builtin.uri:
        url: "{{ dbackup_url }}/api/executions/{{ run.json.executionId }}"
        headers:
          Authorization: "Bearer {{ dbackup_api_key }}"
      register: poll
      until: poll.json.data.status in ['Success', 'Partial', 'Failed', 'Cancelled']
      retries: 360
      delay: 10

    - name: Fail unless the backup succeeded
      ansible.builtin.fail:
        msg: "Backup {{ poll.json.data.status }}: {{ poll.json.data.error | default('see the run in DBackup', true) }}"
      when: poll.json.data.status != 'Success'`;

export const PIPELINE_EXAMPLES: TriggerExample[] = [
    {
        id: "github",
        group: "pipeline",
        label: "GitHub Actions",
        description: "Runs the job every night and on demand. Add the two secrets under Settings → Secrets and variables → Actions.",
        files: [{ name: ".github/workflows/backup.yml", language: "yaml", code: github }],
        secrets: true,
    },
    {
        id: "gitlab",
        group: "pipeline",
        label: "GitLab CI",
        description: "Runs the job from a pipeline schedule and on demand. Add the two variables under Settings → CI/CD → Variables and mark the key as masked.",
        files: [{ name: ".gitlab-ci.yml", language: "yaml", code: gitlab }],
        secrets: true,
    },
    {
        id: "azure",
        group: "pipeline",
        label: "Azure DevOps",
        description: "Runs the job every night. Add the two variables under Pipelines → Edit → Variables and mark the key as secret.",
        files: [{ name: "azure-pipelines.yml", language: "yaml", code: azure }],
        secrets: true,
    },
    {
        id: "ansible",
        group: "pipeline",
        label: "Ansible",
        description: "Starts the job, waits up to an hour for its run and fails the play unless the backup succeeded.",
        files: [{ name: "backup-playbook.yml", language: "yaml", code: ansible }],
    },
];
