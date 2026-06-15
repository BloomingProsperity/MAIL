# Kaifa Recovery And Validation Runbook

## Current Access Symptom

`kaifa` points to `ubuntu@3.112.56.50`. If SSH returns:

```text
Permission denied (publickey,password,keyboard-interactive).
```

but `root@3.112.56.50` prints the Ubuntu cloud-image message asking to log in
as `ubuntu`, the instance is reachable and the private key is recognized, but
`/home/ubuntu/.ssh/authorized_keys` is missing or no longer trusts the key.

## Restore SSH Access

Use the cloud console, EC2 Instance Connect, SSM Session Manager, or a rescue
volume mount. Restore the public key generated from the local private key:

```powershell
ssh-keygen -y -f C:\Users\h\Downloads\kaifa.pem
```

On the instance or mounted volume:

```bash
sudo mkdir -p /home/ubuntu/.ssh
sudo editor /home/ubuntu/.ssh/authorized_keys
sudo chown -R ubuntu:ubuntu /home/ubuntu/.ssh
sudo chmod 700 /home/ubuntu/.ssh
sudo chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Then verify:

```bash
ssh kaifa 'echo KAIFA_ALIVE'
```

## Safe Validation Workspace

Do not clear broad home directories. Validate each slice in a fresh directory
under `/tmp` or a timestamped `/home/ubuntu/emailhub-*` path only.

Preferred flow from Windows:

```powershell
$name = "emailhub-validation-$(Get-Date -Format yyyyMMddHHmmss)"
$archive = Join-Path $env:TEMP "$name.tar.gz"
tar.exe --exclude='.git' --exclude='node_modules' --exclude='target' --exclude='dist' -czf $archive .
scp $archive "kaifa:/tmp/$name.tar.gz"
ssh kaifa "set -e; mkdir -p /tmp/$name; tar -xzf /tmp/$name.tar.gz -C /tmp/$name; cd /tmp/$name; npm ci; npm test; npm run test:backend; npm run build:backend; npm run lint; npm run build; docker compose -f infra/docker-compose.yml config >/tmp/$name-compose.txt"
```

Keep remote shell variables inside single quotes or expand them locally before
building the command. Never run `rm -rf /home/ubuntu/$name` unless `$name` is
known non-empty on the remote side and the resolved path has been printed.
