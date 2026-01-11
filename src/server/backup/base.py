from abc import ABC, abstractmethod
import os
import datetime

class BackupStrategy(ABC):
    """
    Abstract Base Class for all backup strategies.
    """

    # Common backup directory for all strategies
    BACKUP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'backups'))

    def ensure_backup_dir(self):
        """Ensures the backup directory exists."""
        if not os.path.exists(self.BACKUP_DIR):
            os.makedirs(self.BACKUP_DIR)
        return self.BACKUP_DIR

    @abstractmethod
    def backup(self, db_config):
        """
        Executes the backup.

        :param db_config: Object or dict containing: host, port, user, password, db_name
        :return: (success: bool, filepath: str, message: str)
        """
        pass

    def get_timestamp(self):
        return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
