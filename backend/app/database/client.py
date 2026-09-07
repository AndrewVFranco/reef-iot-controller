from influxdb import InfluxDBClient
from app.config import get_settings
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

_client: InfluxDBClient = None

def get_client() -> InfluxDBClient:
    global _client
    if _client is None:
        _client = InfluxDBClient(
            host=settings.influx_host,
            port=settings.influx_port,
            username=settings.influx_username,
            password=settings.influx_password,
            database=settings.influx_database
        )
    return _client

def init_db():
    client = get_client()
    databases = [db['name'] for db in client.get_list_database()]
    if settings.influx_database not in databases:
        client.create_database(settings.influx_database)
        logger.info(f"Created database {settings.influx_database}")
    else:
        logger.info(f"Connected to InfluxDB: {settings.influx_database}")

def write_points(points: list) -> bool:
    try:
        get_client().write_points(points)
        return True
    except Exception as e:
        logger.error(f"InfluxDB write error: {e}")
        return False

def query(query_str: str) -> list:
    try:
        result = get_client().query(query_str)
        return list(result.get_points())
    except Exception as e:
        logger.error(f"InfluxDB query error: {e}")
        return []
