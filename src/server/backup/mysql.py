import subprocess
import os
from .base import BackupStrategy

class MySQLBackup(BackupStrategy):
    def backup(self, db_config):
        self.ensure_backup_dir()

        # Access attributes from the db_config object (SQLAlchemy model)
        host = db_config.db_host
        port = db_config.db_port
        user = db_config.db_user
        password = db_config.db_password
        db_name = db_config.db_name # This might be comma separated if multiple DBs, but let's assume single for now or first one

        # TODO: Handle multiple databases if db_name contains commas, for now take the first or assume single
        target_db = db_name.split(',')[0].strip() if ',' in db_name else db_name

        timestamp = self.get_timestamp()

        # Determine filename
        filename = f"backup_mysql_{target_db}_{timestamp}.sql"
        filepath = os.path.join(self.BACKUP_DIR, filename)

        # Build command
        cmd = [
            "mariadb-dump",
            f"-h{host}",
            f"-P{port}",
            f"-u{user}",
            f"--result-file={filepath}",
            "--single-transaction",
            target_db
        ]

        env = os.environ.copy()
        env['MYSQL_PWD'] = password

        try:
            result = subprocess.run(
                cmd,
                env=env,
                capture_output=True,
                text=True,
                check=True
            )
            return True, filepath, "Backup erfolgreich erstellt."
        except subprocess.CalledProcessError as e:
            error_msg = f"Fehler beim Erstellen des Backups: {e.stderr}"
            return False, None, error_msg
        except Exception as e:
            return False, None, str(e)
