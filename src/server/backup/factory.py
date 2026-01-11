from .mysql import MySQLBackup
# from .postgres import PostgresBackup  # Future implementation
# from .mongo import MongoBackup        # Future implementation

class BackupFactory:
    @staticmethod
    def get_backup_strategy(db_type):
        if db_type == 'mysql':
            return MySQLBackup()
        elif db_type == 'postgresql':
            raise NotImplementedError("PostgreSQL Backup noch nicht implementiert.")
        elif db_type == 'mongodb':
            raise NotImplementedError("MongoDB Backup noch nicht implementiert.")
        else:
            raise ValueError(f"Unbekannter Datenbank-Typ: {db_type}")
