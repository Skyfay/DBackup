# FTP / FTPS (File Transfer Protocol)

Store backups on any FTP server with optional TLS encryption.

## Overview

FTP is one of the most widely supported file transfer protocols. With FTPS (FTP over TLS), transfers are encrypted. Benefits:

- 🌐 Universally supported by hosting providers
- 🔒 Optional TLS encryption (FTPS)
- 📁 Simple file management
- ⚡ No CLI dependencies required

::: warning Prefer FTPS
Plain FTP transfers data (including credentials) unencrypted. Always enable TLS when possible.
:::

## Configuration

| Field | Description | Default |
| :--- | :--- | :--- |
| **Name** | Friendly name | Required |
| **Host** | FTP server hostname or IP | Required |
| **Port** | FTP port | `21` |
| **Username** | FTP username | `anonymous` |
| **Password** | FTP password | Optional |
| **Encryption** | Enable TLS (FTPS) | `Off` |
| **Path Prefix** | Remote directory | Optional |

## Encryption (TLS)

When TLS is enabled, DBackup uses **Explicit FTPS** (AUTH TLS):

1. Connects on the standard FTP port (21)
2. Upgrades the connection to TLS before sending credentials
3. All data is encrypted from that point on

This is the modern, recommended way to secure FTP connections.

::: tip
If your server uses **port 990** with Implicit FTPS (TLS from the start), this is a legacy protocol. Most modern FTP servers support Explicit FTPS on port 21.
:::

## Server Setup

### vsftpd (Linux)

```bash
# Install
sudo apt install vsftpd

# Create backup user
sudo useradd -m -d /home/ftpbackup -s /usr/sbin/nologin ftpbackup
sudo passwd ftpbackup
sudo mkdir -p /home/ftpbackup/backups
sudo chown ftpbackup:ftpbackup /home/ftpbackup/backups

# Enable TLS in /etc/vsftpd.conf
ssl_enable=YES
allow_anon_ssl=NO
force_local_data_ssl=YES
force_local_logins_ssl=YES
rsa_cert_file=/etc/ssl/certs/vsftpd.pem
rsa_private_key_file=/etc/ssl/private/vsftpd.key

sudo systemctl restart vsftpd
```

### ProFTPD (Linux)

```bash
# Install
sudo apt install proftpd proftpd-mod-tls

# Configure TLS in /etc/proftpd/tls.conf
<IfModule mod_tls.c>
  TLSEngine on
  TLSLog /var/log/proftpd/tls.log
  TLSProtocol TLSv1.2 TLSv1.3
  TLSRSACertificateFile /etc/ssl/certs/proftpd.pem
  TLSRSACertificateKeyFile /etc/ssl/private/proftpd.key
</IfModule>

sudo systemctl restart proftpd
```

### Docker (Quick Test)

```yaml
services:
  ftp:
    image: fauria/vsftpd
    environment:
      - FTP_USER=backup
      - FTP_PASS=secret
      - PASV_ADDRESS=127.0.0.1
    ports:
      - "21:21"
      - "21100-21110:21100-21110"
    volumes:
      - ./ftp-data:/home/vsftpd
```

## Directory Structure

After backups, your FTP server will have:

```
/backups/
├── mysql-daily/
│   ├── backup_2024-01-15T12-00-00.sql.gz
│   ├── backup_2024-01-15T12-00-00.sql.gz.meta.json
│   └── ...
└── postgres-weekly/
    └── ...
```

## Troubleshooting

### Connection Refused

```
connect ECONNREFUSED
```

**Solutions**:
1. Verify FTP server is running
2. Check firewall allows port 21
3. Verify hostname/IP is correct

### TLS Handshake Failed

```
SSL routines:tls_validate_record_header:wrong version
```

**Solutions**:
1. Verify the server actually supports TLS
2. If using plain FTP, disable the TLS toggle
3. Check server TLS configuration

### Login Failed

```
Login authentication failed
```

**Solutions**:
1. Verify username and password
2. Check user has FTP access on the server
3. Verify user is not locked or disabled

### Passive Mode Issues

```
Connection timed out (data channel)
```

**Solutions**:
1. Check firewall allows passive ports (typically 21100-21110)
2. Verify `PASV_ADDRESS` is set correctly on the server
3. If behind NAT, ensure passive port range is forwarded

### Permission Denied

```
Permission denied
```

**Solutions**:
1. Check user owns the backup directory
2. Verify write permissions on the server
3. Check FTP server chroot configuration

## Performance

### Optimize for Large Backups

1. **Enable compression** in DBackup to reduce transfer size
2. **Use local network** — avoid transferring over the internet if possible
3. **Check passive mode** — misconfigured passive mode can cause slow transfers

### Network Considerations

- FTP uses separate control/data channels
- Passive mode requires additional port range
- Consider using SFTP instead for simpler firewall setup

## Security Best Practices

1. **Always enable TLS** — never use plain FTP for sensitive data
2. **Use strong passwords** — FTP lacks key-based auth
3. **Restrict user access** — chroot users to their home directory
4. **Firewall rules** — limit source IPs
5. **Disable anonymous access** in production
6. **Use SFTP instead** if SSH access is available (more secure)

## Comparison with Other Destinations

| Feature | FTP/FTPS | SFTP | S3 | Local |
| :--- | :--- | :--- | :--- | :--- |
| Setup complexity | Easy | Medium | Easy | Easiest |
| Encryption | Optional (TLS) | Always (SSH) | Always (HTTPS) | N/A |
| Auth methods | Password only | Password, Key, Agent | Access Key | N/A |
| Firewall complexity | High (passive ports) | Low (single port) | Low (HTTPS) | N/A |
| Widely supported | ✅ | ✅ | ✅ | ✅ |

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
